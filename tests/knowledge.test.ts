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
	canvasSearch,
	chainList,
	describeKnowledgeError,
	isEmptyKnowledge,
	loadKnowledge,
	nodeSheet,
	sourceRowDetail,
} from "@/lib/knowledge";
import { NotPairedError } from "@/lib/mac-fetch";
import { SessionApiError } from "@/lib/sessions";
import { describeError } from "@/lib/user-error";
import type { GraphNode, GraphSnapshot, SourceDirectory } from "@/lib/shared";

const node = (id: string, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({
	id,
	name,
	statement: `${name} is true.`,
	aliases: [],
	createdAt: "2026-11-10T10:00:00.000Z",
	provenance: [{ chatId: "chat_a", messageId: "" }],
	...extra,
});

/** A small graph: a ⟹ c from a and b (an implication node), and d with no source. */
function snapshot(): GraphSnapshot {
	const a = node("n_a", "Alpha", { provenance: [{ chatId: "chat_a", messageId: "m1" }] });
	const b = node("n_b", "Beta", {
		provenance: [
			{ chatId: "chat_a", messageId: "" },
			{ chatId: "src_notes", messageId: "" },
		],
	});
	const c = node("n_c", "Gamma", { createdAt: "2026-11-12T10:00:00.000Z" });
	const d = node("n_d", "Delta", { provenance: [{ chatId: "chat_gone", messageId: "m9" }] });
	const imp = node("arg_1", "⟹", { statement: "Alpha, Beta → Gamma" });
	return {
		nodes: [a, b, c, d, imp],
		propositions: [a, b, c, d],
		edges: [
			{ from: "n_a", to: "arg_1" },
			{ from: "n_b", to: "arg_1" },
			{ from: "arg_1", to: "n_c" },
		],
		logicalEdges: [
			{ from: "n_a", to: "n_c" },
			{ from: "n_b", to: "n_c" },
		],
		impLinks: [{ id: "arg_1", premises: ["n_a", "n_b"], conclusion: "n_c" }],
		chains: [
			{
				id: "arg_1",
				premises: ["n_a", "n_b"],
				conclusion: "n_c",
				provenance: [{ chatId: "chat_a", messageId: "" }],
				createdAt: "2026-11-12T10:00:00.000Z",
			},
		],
		sessions: { chat_a: "Eigenvalues" },
		fileSources: { src_notes: "notes/linear algebra.md" },
		nodeSessions: {
			n_a: ["chat_a"],
			n_b: ["chat_a", "src_notes"],
			n_c: ["chat_a"],
			n_d: ["chat_gone"],
		},
		clusters: [{ id: "chat_a", label: "Eigenvalues", members: ["n_a", "n_b", "n_c"] }],
		positions: {
			n_a: { x: 0, y: 0 },
			n_b: { x: 100, y: 0 },
			n_c: { x: 50, y: 100 },
			n_d: { x: 200, y: 50 },
			arg_1: { x: 50, y: 40 },
		},
	};
}

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
