/**
 * Issue 08 slice B golden test: the Graph tab model against the desktop.
 * The helper script reads the fork's golden data through the fork's server
 * code (the real `GET /api/graph`, `/sources` and `/costs` bodies) and runs
 * the desktop code on them. This test sends the same bodies through the
 * phone's checks and models, and expects the same counts, order, labels,
 * dates, positions, search results and node rows.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { parseGraphCosts, parseGraphSnapshot, readSourceDirectory } from "@/lib/graph-api";
import {
	canvasModel,
	canvasPositions,
	canvasSearch,
	chainList,
	isEmptyKnowledge,
	nodeSheet,
	sourceRowDetail,
	type Knowledge,
} from "@/lib/knowledge";
import {
	UNLABELED_SOURCE,
	propositionSessionHref,
	type ChainSort,
	type GraphSnapshot,
	type SourceDirectory,
} from "@/lib/shared";

const FORK = path.resolve(__dirname, "../../learnharness");

interface DesktopGroup {
	key: string;
	label: string | null;
	kind: string | null;
	chains: string[];
	nodeIds: string[];
	newestCreatedAt: string;
}
interface Golden {
	snapshot: GraphSnapshot;
	directory: SourceDirectory;
	costs: unknown;
	desktop: {
		gapIds: string[];
		seededPositions: Record<string, { x: number; y: number }>;
		chainRows: {
			query: string;
			sort: ChainSort;
			folders: boolean;
			chainCount: number;
			groups: DesktopGroup[];
		}[];
		search: { query: string; visibleIds: string[] }[];
		cards: { nodeId: string; rows: ({ file: string } | { href: string; title: string })[] }[];
	};
}

let golden: Golden;
let knowledge: Knowledge;

beforeAll(async () => {
	const stdout = execFileSync(
		path.join(FORK, "node_modules/.bin/tsx"),
		[path.join(__dirname, "helpers/fork-knowledge.mts"), FORK],
		{ cwd: FORK, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	golden = JSON.parse(stdout) as Golden;
	const directory = await readSourceDirectory(
		(async () =>
			new Response(JSON.stringify(golden.directory), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch,
	);
	knowledge = {
		snapshot: parseGraphSnapshot(golden.snapshot),
		directory,
		costs: parseGraphCosts(golden.costs),
		runs: [],
	};
}, 120_000);

describe("the Graph tab model on the golden data", () => {
	it("the checks keep every item of the real bodies", () => {
		expect(golden.snapshot.nodes.length).toBeGreaterThan(300);
		expect(golden.snapshot.chains.length).toBeGreaterThan(150);
		expect(knowledge.snapshot).toEqual(golden.snapshot);
		expect(knowledge.directory).toEqual(golden.directory);
		expect(knowledge.costs).toEqual(golden.costs);
		expect(isEmptyKnowledge(knowledge.snapshot)).toBe(false);
	});

	it("the canvas uses the Mac's saved positions", () => {
		const model = canvasModel(knowledge.snapshot);
		expect(model.nodes).toHaveLength(golden.snapshot.nodes.length);
		for (const n of model.nodes)
			expect({ x: n.x, y: n.y }).toEqual(golden.snapshot.positions![n.id]);
		expect(model.edges).toHaveLength(golden.snapshot.edges.length);
		expect(model.regions.map((r) => [r.id, r.label])).toEqual(
			golden.snapshot.clusters.map((c) => [c.id, c.label]),
		);
		// Implication nodes and the headless lines into them, as the desktop draw.
		const imp = model.nodes.filter((n) => n.implication);
		expect(imp.length).toBeGreaterThan(0);
		for (const e of model.edges) expect(e.head).toBe(!e.to.startsWith("arg_"));
	});

	it("nodes with no saved position get the desktop seed positions (state 12)", () => {
		const positions = { ...golden.snapshot.positions };
		for (const id of golden.desktop.gapIds) delete positions[id];
		const phone = canvasPositions({ nodes: knowledge.snapshot.nodes, positions });
		expect(Object.fromEntries(phone)).toEqual(golden.desktop.seededPositions);
	});

	it("the canvas search gives the desktop result", () => {
		for (const { query, visibleIds } of golden.desktop.search) {
			const search = canvasSearch(knowledge.snapshot, query);
			expect([...search.visibleIds]).toEqual(visibleIds);
		}
		expect(canvasSearch(knowledge.snapshot, "zz-no-match-zz").empty).toBe("No matching nodes.");
	});

	it("the chain rows have the desktop groups, order, labels and dates", () => {
		expect(golden.desktop.chainRows.length).toBe(13);
		for (const c of golden.desktop.chainRows) {
			const list = chainList(
				{ snapshot: knowledge.snapshot, directory: c.folders ? knowledge.directory : null },
				c.query,
				c.sort,
			);
			const phone = list.sources.map(({ group: g }) => ({
				key: g.key,
				label: g.label,
				kind: g.kind,
				chains: g.chains.map((x) => x.id),
				nodeIds: g.nodeIds,
				newestCreatedAt: g.newestCreatedAt,
			}));
			expect({ case: c.query + JSON.stringify(c.sort) + c.folders, groups: phone }).toEqual({
				case: c.query + JSON.stringify(c.sort) + c.folders,
				groups: c.groups,
			});
			expect(list.header).toBe(
				`${c.chainCount} chains · ${golden.snapshot.propositions.length} nodes`,
			);
			for (const row of list.sources) {
				expect(row.name).toBe(row.group.label ?? UNLABELED_SOURCE);
				expect(row.detail).toBe(sourceRowDetail(row.group));
			}
		}
		// The notes sources keep their file names (the fork's own golden check).
		const notes = chainList(knowledge, "")
			.sources.filter((s) => s.group.kind === "notes")
			.map((s) => s.name);
		expect(notes).toEqual([
			"learn computer",
			"learn database",
			"learning libertarianism",
			"learning software architecture",
		]);
		expect(chainList(knowledge, "zz-no-match-zz").empty).toBe("No matching chains.");
	});

	it("the node sheet has the desktop card rows", () => {
		expect(golden.desktop.cards.length).toBeGreaterThan(0);
		for (const card of golden.desktop.cards) {
			const sheet = nodeSheet(knowledge.snapshot, card.nodeId);
			if (card.nodeId.startsWith("arg_")) {
				expect(sheet).toBeNull();
				continue;
			}
			expect(sheet).not.toBeNull();
			const rows = sheet!.rows.map((r) => {
				if (r.kind === "file") return { file: r.path };
				if (r.kind === "session") {
					const node = knowledge.snapshot.nodes.find((n) => n.id === card.nodeId)!;
					return { href: propositionSessionHref(node, r.chatId), title: r.title };
				}
				return { missing: r.sourceId };
			});
			expect(rows).toEqual(card.rows);
		}
	});
});
