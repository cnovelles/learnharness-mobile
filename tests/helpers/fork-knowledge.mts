/**
 * ESM (.mts) for top-level await. Run with tsx from the fork folder (see
 * tests/knowledge-golden.test.ts). It copies the fork's golden data to a
 * temporary folder and reads it through the fork's server code: the same
 * bodies that `GET /api/graph`, `/api/graph/sources` and `/api/graph/costs`
 * send. Then it runs the desktop code on these bodies, step by step as the
 * desktop components do, and prints the results as JSON. The phone test
 * compares its own model with them. The real data folder is never read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fork = process.argv[2]!;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phone-knowledge-"));
fs.cpSync(path.join(fork, "tests/fixtures/golden-data"), tmp, { recursive: true });
// The data folder seam: set before any import that reads the config.
process.env.LH_DATA_DIR = tmp;

try {
	const { graphView, graphCosts } = await import(path.join(fork, "src/server/graph.ts"));
	const { sourceDirectory } = await import(path.join(fork, "src/server/source-organization.ts"));
	const { buildChainRows } = await import(path.join(fork, "src/core/chain-rows.ts"));
	const { isNodeVisible, seedMissingNodePositions } = await import(
		path.join(fork, "src/core/graph-view-model.ts")
	);
	const { propositionSessionHref } = await import(
		path.join(fork, "src/core/session-navigation.ts")
	);

	const snapshot = graphView();
	const directory = sourceDirectory.read();
	const costs = graphCosts();

	// The positions of graph-view.tsx (the layout effect), with every tenth
	// node out of the ledger, so the seed runs (error state 12).
	type Pt = { x: number; y: number };
	const gapIds: string[] = snapshot.nodes
		.filter((_: unknown, i: number) => i % 10 === 0)
		.map((n: { id: string }) => n.id);
	const gapLedger: Record<string, Pt> = { ...snapshot.positions };
	for (const id of gapIds) delete gapLedger[id];
	const seeded = new Map<string, Pt>();
	for (const node of snapshot.nodes) {
		const p = gapLedger[node.id];
		if (p) seeded.set(node.id, { x: p.x, y: p.y });
	}
	seedMissingNodePositions(snapshot.nodes, seeded);

	// The chain table (chain-table.tsx gets snapshot.propositions).
	type Group = {
		key: string;
		label: string | null;
		kind: string | null;
		chains: { id: string }[];
		nodeIds: string[];
		newestCreatedAt: string;
	};
	const chainCases: { query: string; sort: { col: string; dir: 1 | -1 }; folders: boolean }[] = [];
	for (const sort of [
		{ col: "name", dir: 1 },
		{ col: "name", dir: -1 },
		{ col: "props", dir: -1 },
		{ col: "created", dir: -1 },
	] as const)
		for (const query of ["", "database", "zz-no-match-zz"])
			chainCases.push({ query, sort, folders: true });
	chainCases.push({ query: "", sort: { col: "name", dir: 1 }, folders: false });
	const chainRows = chainCases.map((c) => {
		const rows = buildChainRows({
			nodes: snapshot.propositions,
			chains: snapshot.chains,
			sessions: snapshot.sessions,
			fileSources: snapshot.fileSources,
			directory: c.folders ? directory : undefined,
			query: c.query,
			sort: c.sort,
		});
		return {
			...c,
			chainCount: rows.chains.length,
			groups: rows.groups.map((g: Group) => ({
				key: g.key,
				label: g.label,
				kind: g.kind,
				chains: g.chains.map((x) => x.id),
				nodeIds: g.nodeIds,
				newestCreatedAt: g.newestCreatedAt,
			})),
		};
	});

	// The canvas search (graph-view.tsx visibleIds).
	const search = ["", "data", "Database", "zz-no-match-zz"].map((query) => ({
		query,
		visibleIds: snapshot.nodes
			.filter((n: { name: string; statement: string }) => isNodeVisible(n, query))
			.map((n: { id: string }) => n.id),
	}));

	// The node card rows (graph-view.tsx): a file path, or a session link.
	const cards = Object.entries(snapshot.nodeSessions as Record<string, string[]>).map(
		([nodeId, sourceIds]) => {
			const node = snapshot.nodes.find((n: { id: string }) => n.id === nodeId);
			return {
				nodeId,
				rows: sourceIds.map((id) =>
					snapshot.fileSources[id] !== undefined
						? { file: snapshot.fileSources[id] }
						: { href: propositionSessionHref(node, id), title: snapshot.sessions[id] ?? id },
				),
			};
		},
	);

	process.stdout.write(
		JSON.stringify({
			snapshot,
			directory,
			costs,
			desktop: {
				gapIds,
				seededPositions: Object.fromEntries(seeded),
				chainRows,
				search,
				cards,
			},
		}),
	);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
