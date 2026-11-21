/**
 * The Graph tab data (issue 08, slice B): the checked reads, the load with
 * its optional parts, and the canvas, search, node sheet and chain models.
 * Each error state of docs/ISSUES.md issue 08 that this slice owns has a test
 * here (the golden test compares the models with the desktop on real data).
 */
import {
	parseGraphCosts,
	parseGraphSnapshot,
	parseGraphStatus,
	readGraphSnapshot,
} from "@/lib/graph-api";
import {
	KNOWLEDGE_EMPTY,
	KNOWLEDGE_NOT_LOADED,
	KNOWLEDGE_OLD_MAC,
	NO_MATCHING_CHAINS,
	NO_MATCHING_NODES,
	NO_SESSIONS_RECORDED,
	canvasModel,
	canvasPositions,
	CLOSED_CHAINS,
	UNFILED_SECTION,
	canvasSearch,
	chainLines,
	chainList,
	chainSections,
	chainSheet,
	chainSortLabel,
	isChainEntryOpen,
	toggleChainEntry,
	describeKnowledgeError,
	graphTabView,
	KNOWLEDGE_LOADING,
	KNOWLEDGE_OFFLINE,
	KNOWLEDGE_STALE,
	isEmptyKnowledge,
	loadKnowledge,
	nodeSheet,
	sourceRowDetail,
} from "@/lib/knowledge";
import { NotPairedError } from "@/lib/mac-fetch";
import { SessionApiError } from "@/lib/sessions";
import { describeError } from "@/lib/user-error";
import type { GraphSnapshot, SourceDirectory } from "@/lib/shared";

import { node, snapshot } from "./helpers/graph-snapshot";

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Mac: one answer (or a thrown error) for each graph path. */
function fakeMac(answers: Record<string, () => Response>): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const answer = answers[String(input)];
		if (!answer) throw new Error(`unexpected ${String(input)}`);
		return answer();
	}) as typeof fetch;
}

const COSTS = {
	totalDollars: 0.02,
	unpricedRuns: 0,
	stages: {
		extraction: { dollars: 0.01, unpricedRuns: 0, runs: 1, tokens: { inputTokens: 10 } },
		audit: { dollars: 0.01, unpricedRuns: 0, runs: 1, tokens: {} },
	},
	runs: [],
};
const DIRECTORY: SourceDirectory = {
	organization: {
		version: 1,
		folders: [{ id: "f1", name: "Math", parentId: null, createdAt: "2026-11-01T00:00:00.000Z" }],
		placements: { chat_a: { folderId: "f1" } },
	},
	sources: [
		{
			id: "chat_a",
			kind: "chat",
			chatKind: "teach",
			label: "Eigenvalues",
			createdAt: "2026-11-10T00:00:00.000Z",
		},
	],
};

function goodMac(overrides: Record<string, () => Response> = {}): typeof fetch {
	return fakeMac({
		"/api/graph": () => json(snapshot()),
		"/api/graph/sources": () => json(DIRECTORY),
		"/api/graph/costs": () => json(COSTS),
		"/api/graph/status": () =>
			json({
				runs: [
					{ id: "chat_a", chatId: "chat_a", title: "Eigenvalues", phase: "auditing", startedAt: 1 },
				],
			}),
		...overrides,
	});
}

describe("the checked graph reads", () => {
	it("keep a valid snapshot as it is", () => {
		expect(parseGraphSnapshot(snapshot())).toEqual(snapshot());
	});

	it("refuse a body with a missing list (state 3)", () => {
		const body: Partial<GraphSnapshot> = snapshot();
		delete body.edges;
		expect(() => parseGraphSnapshot(body)).toThrow(SessionApiError);
		expect(() => parseGraphSnapshot("<html>")).toThrow(SessionApiError);
		expect(() => parseGraphSnapshot({ ...snapshot(), positions: [] })).toThrow(SessionApiError);
	});

	it("drop bad items and keep the good ones", () => {
		const body = snapshot() as unknown as Record<string, unknown>;
		body.nodes = [...(body.nodes as unknown[]), { id: 3 }, null];
		body.edges = [...(body.edges as unknown[]), { from: "n_a" }];
		body.chains = [
			...(body.chains as unknown[]),
			{ id: "arg_2", premises: [], conclusion: "n_c", createdAt: "x" },
		];
		body.positions = { n_a: { x: 0, y: 0 }, n_b: { x: "1", y: 2 }, n_c: { x: Infinity, y: 0 } };
		const parsed = parseGraphSnapshot(JSON.parse(JSON.stringify(body)));
		expect(parsed.nodes.map((n) => n.id)).toEqual(["n_a", "n_b", "n_c", "n_d", "arg_1"]);
		expect(parsed.edges).toHaveLength(3);
		expect(parsed.chains.map((c) => c.id)).toEqual(["arg_1"]);
		// JSON has no Infinity: it arrives as null and is dropped.
		expect(parsed.positions).toEqual({ n_a: { x: 0, y: 0 } });
	});

	it("check the costs and the status bodies (state 3)", () => {
		expect(parseGraphCosts(COSTS).stages.extraction.tokens.inputTokens).toBe(10);
		expect(() =>
			parseGraphCosts({ ...COSTS, stages: { extraction: COSTS.stages.extraction } }),
		).toThrow(SessionApiError);
		expect(() => parseGraphStatus({})).toThrow(SessionApiError);
		expect(parseGraphStatus({ runs: [{ id: "x" }] })).toEqual([]);
	});

	it("send a refusal as a SessionApiError with its status", async () => {
		const mac = fakeMac({
			"/api/graph": () => json({ error: "Forbidden by the phone gateway." }, 403),
		});
		await expect(readGraphSnapshot(mac)).rejects.toMatchObject({ status: 403 });
	});
});

describe("the knowledge error messages", () => {
	it("state 2: an older Mac refuses the graph route", () => {
		expect(describeKnowledgeError(new SessionApiError("Forbidden", 403))).toBe(KNOWLEDGE_OLD_MAC);
	});

	it("state 3: a body that is not valid, or a server failure, never shows raw text", () => {
		expect(
			describeKnowledgeError(new SessionApiError("The Mac sent a graph that is not valid.")),
		).toBe(KNOWLEDGE_NOT_LOADED);
		expect(describeKnowledgeError(new SyntaxError("Unexpected token < in JSON"))).toBe(
			KNOWLEDGE_NOT_LOADED,
		);
		const raw = new SessionApiError("ENOENT: nodes.jsonl", 500, { error: "ENOENT: nodes.jsonl" });
		expect(describeKnowledgeError(raw)).toBe(KNOWLEDGE_NOT_LOADED);
		expect(describeKnowledgeError(raw)).not.toContain("ENOENT");
	});

	it("state 1: the network and pairing errors keep their usual text", () => {
		const network = new TypeError("Network request failed");
		expect(describeKnowledgeError(network)).toBe(describeError(network));
		expect(describeKnowledgeError(new NotPairedError())).toBe(describeError(new NotPairedError()));
		const unpaired = new SessionApiError("Unauthorized", 401);
		expect(describeKnowledgeError(unpaired)).toBe(describeError(unpaired));
	});
});

describe("loadKnowledge", () => {
	it("loads the graph, the folders, the costs and the runs", async () => {
		const k = await loadKnowledge(goodMac());
		expect(k.snapshot.propositions).toHaveLength(4);
		expect(k.directory?.organization.folders).toHaveLength(1);
		expect(k.costs?.stages.audit.runs).toBe(1);
		expect(k.runs).toEqual([
			{ id: "chat_a", chatId: "chat_a", title: "Eigenvalues", phase: "auditing", startedAt: 1 },
		]);
	});

	it("state 6: the folders fail, the graph still loads", async () => {
		const k = await loadKnowledge(
			goodMac({ "/api/graph/sources": () => json({ error: "x" }, 500) }),
		);
		expect(k.directory).toBeNull();
		expect(k.snapshot.nodes).toHaveLength(5);
	});

	it("state 11: the costs or the status fail, the graph still loads", async () => {
		const k = await loadKnowledge(
			goodMac({
				"/api/graph/costs": () => json({ nope: 1 }),
				"/api/graph/status": () => json({}, 403),
			}),
		);
		expect(k.costs).toBeNull();
		expect(k.runs).toBeNull();
		expect(k.snapshot.nodes).toHaveLength(5);
	});

	it("states 2 and 3: a failed graph read throws, with the right message", async () => {
		await expect(
			loadKnowledge(goodMac({ "/api/graph": () => json({ error: "Forbidden" }, 403) })).catch(
				(e: unknown) => describeKnowledgeError(e),
			),
		).resolves.toBe(KNOWLEDGE_OLD_MAC);
		await expect(
			loadKnowledge(goodMac({ "/api/graph": () => new Response("<html>", { status: 200 }) })).catch(
				(e: unknown) => describeKnowledgeError(e),
			),
		).resolves.toBe(KNOWLEDGE_NOT_LOADED);
	});

	it("state 4: an empty graph", async () => {
		const empty = {
			...snapshot(),
			nodes: [],
			propositions: [],
			edges: [],
			chains: [],
			clusters: [],
		};
		const k = await loadKnowledge(goodMac({ "/api/graph": () => json(empty) }));
		expect(isEmptyKnowledge(k.snapshot)).toBe(true);
		expect(KNOWLEDGE_EMPTY).toBe("Start a session to begin learning.");
		expect(canvasModel(k.snapshot).bounds).toBeNull();
	});
});

describe("the canvas model", () => {
	it("uses the saved positions and the desktop head rule", () => {
		const model = canvasModel(snapshot());
		expect(model.nodes.find((n) => n.id === "n_d")).toMatchObject({
			x: 200,
			y: 50,
			label: "Delta",
		});
		expect(model.nodes.find((n) => n.id === "arg_1")?.implication).toBe(true);
		expect(model.edges.map((e) => e.head)).toEqual([false, false, true]);
		expect(model.bounds).toEqual({ minX: 0, maxX: 200, minY: 0, maxY: 100 });
		expect(model.regions).toEqual([
			{
				id: "chat_a",
				label: "Eigenvalues",
				hue: expect.any(Number),
				members: ["n_a", "n_b", "n_c"],
			},
		]);
	});

	it("drops a line or a region member to a node that is not in the graph", () => {
		const s = snapshot();
		s.edges.push({ from: "n_a", to: "n_missing" });
		s.clusters[0]!.members.push("n_missing");
		const model = canvasModel(s);
		expect(model.edges).toHaveLength(3);
		expect(model.regions[0]!.members).toEqual(["n_a", "n_b", "n_c"]);
	});

	it("state 12: a node with no saved position gets a seed position off the others", () => {
		const s = snapshot();
		delete s.positions!.n_d;
		const p = canvasPositions(s).get("n_d")!;
		expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
		expect(canvasPositions(s).get("n_d")).toEqual(p);
		expect(canvasPositions(s).get("n_a")).toEqual({ x: 0, y: 0 });
	});

	it("state 17: with no saved position at all, the nodes go on the seed ring", () => {
		const s = snapshot();
		delete s.positions;
		const positions = canvasPositions(s);
		expect(positions.size).toBe(5);
		expect(positions.get("n_a")).toEqual({ x: 0, y: 0 });
		for (const id of ["n_b", "n_c", "n_d", "arg_1"])
			expect(Math.hypot(positions.get(id)!.x, positions.get(id)!.y)).toBeCloseTo(48);
	});
});

describe("the canvas search", () => {
	it("has no count with no query", () => {
		const search = canvasSearch(snapshot(), "  ");
		expect(search.visibleIds.size).toBe(5);
		expect(search.countText).toBeNull();
		expect(search.empty).toBeNull();
	});

	it("matches the name and the statement, and counts the propositions only", () => {
		const search = canvasSearch(snapshot(), "gamma");
		expect([...search.visibleIds]).toEqual(["n_c", "arg_1"]);
		expect(search.countText).toBe("1 of 4 nodes");
	});

	it("state 13: no match", () => {
		const search = canvasSearch(snapshot(), "zebra");
		expect(search.countText).toBe("0 of 4 nodes");
		expect(search.empty).toBe(NO_MATCHING_NODES);
	});
});

describe("the node sheet", () => {
	it("opens a session at the node's message", () => {
		expect(nodeSheet(snapshot(), "n_a")).toEqual({
			id: "n_a",
			name: "Alpha",
			statement: "Alpha is true.",
			rows: [{ kind: "session", chatId: "chat_a", title: "Eigenvalues", messageId: "m1" }],
			empty: null,
		});
	});

	it("state 15: no message in the record opens the session at its normal position", () => {
		expect(nodeSheet(snapshot(), "n_b")!.rows).toEqual([
			{ kind: "session", chatId: "chat_a", title: "Eigenvalues", messageId: null },
			{ kind: "file", sourceId: "src_notes", path: "notes/linear algebra.md" },
		]);
	});

	it("state 16: a session that is gone shows unlabeled", () => {
		expect(nodeSheet(snapshot(), "n_d")!.rows).toEqual([
			{ kind: "missing", sourceId: "chat_gone", label: "unlabeled" },
		]);
	});

	it("state 14: a node with no session", () => {
		const s = snapshot();
		delete s.nodeSessions.n_c;
		expect(nodeSheet(s, "n_c")).toMatchObject({ rows: [], empty: NO_SESSIONS_RECORDED });
	});

	it("gives no sheet for an implication node or an unknown id", () => {
		expect(nodeSheet(snapshot(), "arg_1")).toBeNull();
		expect(nodeSheet(snapshot(), "n_zzz")).toBeNull();
	});
});

describe("the chain list", () => {
	it("has the desktop header, the folder order and two-line rows", () => {
		const list = chainList({ snapshot: snapshot(), directory: DIRECTORY }, "");
		// Delta has no chain: the desktop shows it as its own chain, born in a gone session.
		expect(list.header).toBe("2 chains · 4 nodes");
		expect(list.sources.map((s) => [s.name, s.detail, s.unlabeled])).toEqual([
			["Eigenvalues", "3 props · 2026-11-12", false],
			["unlabeled", "1 prop · 2026-11-10", true],
		]);
		expect(list.folders.level(null).map((i) => [i.kind, i.name, i.count])).toEqual([
			["folder", "Math", 3],
			["source", "\uffff", 1],
		]);
		expect(list.folders.level("f1").map((i) => i.name)).toEqual(["Eigenvalues"]);
		expect(list.empty).toBeNull();
	});

	it("state 5: the search finds nothing", () => {
		const list = chainList({ snapshot: snapshot(), directory: null }, "zebra");
		expect(list.sources).toEqual([]);
		expect(list.empty).toBe(NO_MATCHING_CHAINS);
	});

	it("state 6: with no folders, the groups use the session titles", () => {
		const list = chainList({ snapshot: snapshot(), directory: null }, "");
		expect(list.sources.map((s) => s.name)).toEqual(["Eigenvalues", "unlabeled"]);
		expect(list.folders.level(null).map((i) => i.kind)).toEqual(["source", "source"]);
	});

	it("state 7: a source whose chat is gone shows unlabeled", () => {
		const s = snapshot();
		s.sessions = {};
		const list = chainList({ snapshot: s, directory: null }, "");
		expect(list.sources[0]).toMatchObject({ name: "unlabeled", unlabeled: true });
	});

	it("writes one prop, and no date when the source has none", () => {
		expect(sourceRowDetail({ nodeIds: ["n_a"], newestCreatedAt: "" })).toBe("1 prop");
	});
});

describe("the Chains screen model (slice D)", () => {
	/** Folders: Math (with the subfolder Linear), and Physics (empty). */
	const NESTED: SourceDirectory = {
		organization: {
			version: 1,
			folders: [
				{ id: "f1", name: "Math", parentId: null, createdAt: "2026-11-01T00:00:00.000Z" },
				{ id: "f2", name: "Linear", parentId: "f1", createdAt: "2026-11-02T00:00:00.000Z" },
				{ id: "f3", name: "Physics", parentId: null, createdAt: "2026-11-03T00:00:00.000Z" },
			],
			placements: { chat_a: { folderId: "f2" } },
		},
		sources: DIRECTORY.sources,
	};

	it("writes the sort button text with the order", () => {
		expect(chainSortLabel({ col: "name", dir: 1 })).toBe("Name ↑");
		expect(chainSortLabel({ col: "props", dir: -1 })).toBe("Props ↓");
		expect(chainSortLabel({ col: "created", dir: 1 })).toBe("Created ↑");
	});

	it("with no folders (state 6), one section with no label holds all sources", () => {
		const sections = chainSections(chainList({ snapshot: snapshot(), directory: null }, ""));
		expect(sections).toHaveLength(1);
		expect(sections[0]!.label).toBeNull();
		expect(sections[0]!.entries.map((e) => e.kind === "source" && e.row.name)).toEqual([
			"Eigenvalues",
			"unlabeled",
		]);
	});

	it("gives each top folder a section, a subfolder a row, and the unfiled sources last", () => {
		const sections = chainSections(chainList({ snapshot: snapshot(), directory: NESTED }, ""));
		expect(sections.map((s) => s.label)).toEqual(["Math", "Physics", UNFILED_SECTION]);
		const [math, physics, unfiled] = sections;
		expect(math!.entries).toMatchObject([
			{ kind: "folder", key: "f2", name: "Linear", detail: "3 props · 2026-11-02" },
		]);
		const linear = math!.entries[0]!;
		expect(linear.kind === "folder" && linear.entries.map((e) => e.key)).toEqual(["chat_a"]);
		expect(physics!.entries).toEqual([]);
		expect(unfiled!.entries.map((e) => e.kind === "source" && e.row.name)).toEqual(["unlabeled"]);
	});

	it("during a search, shows only the folders with a match", () => {
		const sections = chainSections(chainList({ snapshot: snapshot(), directory: NESTED }, "alpha"));
		expect(sections.map((s) => s.label)).toEqual(["Math"]);
	});

	it("opens only the tapped entries with no search; a search opens all but the closed ones", () => {
		let state = CLOSED_CHAINS;
		expect(isChainEntryOpen(state, "source:chat_a", "")).toBe(false);
		state = toggleChainEntry(state, "source:chat_a", "");
		expect(isChainEntryOpen(state, "source:chat_a", "")).toBe(true);
		// A search opens all the sources.
		expect(isChainEntryOpen(state, "source:chat_gone", "al")).toBe(true);
		state = toggleChainEntry(state, "source:chat_gone", "al");
		expect(isChainEntryOpen(state, "source:chat_gone", "al")).toBe(false);
		// A new search forgets the closed ones; the open set without a search stays.
		expect(isChainEntryOpen(state, "source:chat_gone", "alp")).toBe(true);
		expect(isChainEntryOpen(state, "source:chat_a", "")).toBe(true);
		state = toggleChainEntry(state, "source:chat_a", "");
		expect(isChainEntryOpen(state, "source:chat_a", "")).toBe(false);
	});

	it("draws a chain line as the desktop chips: the premises, then the conclusion", () => {
		const list = chainList({ snapshot: snapshot(), directory: null }, "");
		const lines = chainLines(snapshot(), list.sources[0]!.group);
		expect(lines).toEqual([
			{
				id: "arg_1",
				members: [
					{ id: "n_a", name: "Alpha" },
					{ id: "n_b", name: "Beta" },
					{ id: "n_c", name: "Gamma" },
				],
				text: "Alpha, Beta → Gamma",
			},
		]);
	});

	it("the chain sheet opens the birth session at the conclusion's message", () => {
		const s = snapshot();
		s.propositions[2]!.provenance = [{ chatId: "chat_a", messageId: "m3" }];
		const list = chainList({ snapshot: s, directory: null }, "");
		const sheet = chainSheet(s, list.sources[0]!.group, "arg_1");
		expect(sheet?.statements.map((x) => [x.name, x.statement])).toEqual([
			["Alpha", "Alpha is true."],
			["Beta", "Beta is true."],
			["Gamma", "Gamma is true."],
		]);
		expect(sheet?.open).toEqual({ chatId: "chat_a", messageId: "m3", title: "Eigenvalues" });
		expect(chainSheet(s, list.sources[0]!.group, "no_such_chain")).toBeNull();
	});

	it("the chain sheet of a notes source or an unlabeled source has no session", () => {
		const s = snapshot();
		const e = node("n_e", "Epsilon", { provenance: [{ chatId: "src_notes", messageId: "" }] });
		s.nodes.push(e);
		s.propositions.push(e);
		const list = chainList({ snapshot: s, directory: null }, "");
		const notes = list.sources.find((r) => r.group.kind === "notes")!;
		expect(notes.name).toBe("linear algebra");
		expect(chainSheet(s, notes.group, "n_e")?.open).toBeNull();
		const gone = list.sources.find((r) => r.unlabeled)!;
		expect(chainSheet(s, gone.group, "n_d")?.open).toBeNull();
	});
});

describe("graphTabView (slice C)", () => {
	const loaded = () => ({ snapshot: snapshot(), directory: null, costs: null, runs: null });
	it("with no graph: loading when connected, a connect note when not", () => {
		expect(graphTabView(null, null, true)).toEqual({ kind: "note", text: KNOWLEDGE_LOADING });
		expect(graphTabView(null, null, false)).toEqual({ kind: "note", text: KNOWLEDGE_OFFLINE });
	});
	it("a failed first read shows its message", () => {
		expect(graphTabView(null, KNOWLEDGE_OLD_MAC, true)).toEqual({
			kind: "error",
			text: KNOWLEDGE_OLD_MAC,
		});
	});
	it("a loaded graph stays; a later failure or a lost Mac marks it not up to date (state 1)", () => {
		const k = loaded();
		expect(graphTabView(k, null, true)).toEqual({ kind: "graph", knowledge: k, stale: null });
		expect(graphTabView(k, KNOWLEDGE_NOT_LOADED, true)).toMatchObject({ stale: KNOWLEDGE_STALE });
		expect(graphTabView(k, null, false)).toMatchObject({ stale: KNOWLEDGE_STALE });
	});
	it("an empty graph is the empty state (state 4)", () => {
		const k = loaded();
		k.snapshot.propositions = [];
		expect(graphTabView(k, null, true)).toEqual({ kind: "empty" });
	});
});
