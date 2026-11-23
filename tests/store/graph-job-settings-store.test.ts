/**
 * Issue 09: the GraphStore, JobStore and SettingsStore adapters on a real
 * SQLite, with the rules of the desktop's fs adapters
 * (`../learnharness/src/store/graph.ts`, `jobs.ts`, `settings.ts`).
 */
import { CURRENT_GRAPH_FORMAT_VERSION, type GraphNode } from "@/lib/shared";
import { NewerGraphFormatError } from "@/store/graph-store";

import { makeTestStore } from "../helpers/local-store";

const node = (id: string, name = id): GraphNode =>
	({ id, name, statement: `${name}.`, aliases: [], createdAt: "t", provenance: [] }) as GraphNode;
const chain = (id: string) => ({
	id,
	premises: ["a"],
	conclusion: "b",
	provenance: [{ chatId: "c", messageId: "m" }],
	createdAt: "t",
});

let store: ReturnType<typeof makeTestStore>;
beforeEach(() => {
	store = makeTestStore();
});
afterEach(() => store.close());

describe("GraphStore on SQLite", () => {
	it("keeps append order and repeated node lines", () => {
		store.graph.appendNode(node("b"));
		store.graph.appendNode(node("a"));
		store.graph.appendNode(node("b", "b again"));
		expect(store.graph.readNodes().map((n) => n.name)).toEqual(["b", "a", "b again"]);
	});

	it("reads chains, checkpoints and coverage in append order", () => {
		store.graph.appendChain(chain("c1") as never);
		store.graph.appendChain(chain("c2") as never);
		store.graph.appendCheckpoint({ chatId: "c", foldedAt: "t" } as never);
		store.graph.appendCoverage({ chatId: "c", fp: "f", tokens: 3, foldedAt: "t" } as never);
		expect(store.graph.readChains().map((c) => c.id)).toEqual(["c1", "c2"]);
		expect(store.graph.readCheckpoints()).toHaveLength(1);
		expect(store.graph.readCoverage()).toHaveLength(1);
	});

	it("skips a line with a bad shape or bad JSON", () => {
		store.graph.appendNode(node("a"));
		store.db.run("INSERT INTO graph_nodes (id, json) VALUES ('x', '{\"id\":\"x\"}')");
		store.db.run("INSERT INTO graph_nodes (id, json) VALUES ('y', 'not json')");
		store.db.run('INSERT INTO graph_chains (json) VALUES (\'{"id":"c","premises":[]}\')');
		expect(store.graph.readNodes().map((n) => n.id)).toEqual(["a"]);
		expect(store.graph.readChains()).toEqual([]);
	});

	it("keeps a source's usage log on upsert, and appends usage once", () => {
		const source = { id: "s1", filePath: "/a.md", importedAt: "t" };
		store.graph.upsertSource(source as never);
		store.graph.appendSourceUsage("s1", { startedAt: "r1" } as never);
		store.graph.appendSourceUsage("s1", { startedAt: "r1" } as never);
		store.graph.upsertSource({ ...source, filePath: "/b.md" } as never);
		expect(store.graph.readSources()).toEqual([
			{ id: "s1", filePath: "/b.md", importedAt: "t", extractions: [{ startedAt: "r1" }] },
		]);
		store.graph.appendSourceUsage("none", { startedAt: "r1" } as never);
	});

	it("deletes only the sources that exist and counts them", () => {
		store.graph.upsertSource({ id: "s1", filePath: "/a", importedAt: "t" } as never);
		expect(store.graph.deleteSources(new Set())).toBe(0);
		expect(store.graph.deleteSources(new Set(["s1", "s2"]))).toBe(1);
		expect(store.graph.readSources()).toEqual([]);
	});

	it("replaces the whole positions map", () => {
		store.graph.writePositions({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
		store.graph.writePositions({ a: { x: 5, y: 6 } });
		expect(store.graph.readPositions()).toEqual({ a: { x: 5, y: 6 } });
	});

	it("rewrites only the given ledgers, in one step", () => {
		store.graph.appendNode(node("a"));
		store.graph.appendNode(node("b"));
		store.graph.appendChain(chain("c1") as never);
		store.graph.rewriteLedgers({ nodes: [node("b")] });
		expect(store.graph.readNodes().map((n) => n.id)).toEqual(["b"]);
		expect(store.graph.readChains().map((c) => c.id)).toEqual(["c1"]);
		store.graph.rewriteLedgers({ chains: [] });
		expect(store.graph.readChains()).toEqual([]);
	});

	it("refuses to read graph data from a newer build", () => {
		store.graph.appendNode(node("a"));
		store.db.run(
			"UPDATE meta SET value = ? WHERE key = 'graph_format'",
			String(CURRENT_GRAPH_FORMAT_VERSION + 1),
		);
		expect(() => store.graph.readNodes()).toThrow(NewerGraphFormatError);
	});
});

describe("JobStore on SQLite", () => {
	it("creates a running job and finds it by tool call", () => {
		const job = store.jobs.createJob({ kind: "research", chatId: "c1", toolCallId: "t1" } as never);
		expect(job).toMatchObject({ status: "running", activity: "starting", chatId: "c1" });
		expect(store.jobs.getJob(job.id)).toEqual(job);
		expect(store.jobs.findJobByToolCallId("c1", "t1")).toEqual(job);
		expect(store.jobs.findJobByToolCallId("c1", "t2")).toBeNull();
	});

	it("merges a patch but never changes the identity", () => {
		const job = store.jobs.createJob({ kind: "research", chatId: "c1", toolCallId: "t1" } as never);
		const next = store.jobs.updateJob(job.id, {
			activity: "reading",
			chatId: "other",
		} as never)!;
		expect(next.activity).toBe("reading");
		expect(next.chatId).toBe("c1");
		expect(next.updatedAt > job.updatedAt).toBe(true);
		expect(store.jobs.updateJob(job.id, { updatedAt: "2000" })!.updatedAt).toBe("2000");
		expect(store.jobs.updateJob("job_none", {})).toBeNull();
	});

	it("lists a chat's jobs newest first and deletes them", () => {
		const a = store.jobs.createJob({ kind: "research", chatId: "c1", toolCallId: "t1" } as never);
		const b = store.jobs.createJob({ kind: "demo", chatId: "c1", toolCallId: "t2" } as never);
		store.jobs.createJob({ kind: "demo", chatId: "c2", toolCallId: "t3" } as never);
		expect(store.jobs.listJobs("c1").map((j) => j.id)).toEqual([b.id, a.id]);
		expect(store.jobs.deleteJobsForChat("c1")).toBe(2);
		expect(store.jobs.listJobs("c1")).toEqual([]);
		expect(store.jobs.listJobs("c2")).toHaveLength(1);
	});
});

describe("SettingsStore on SQLite", () => {
	it("reads null before the first write", () => {
		expect(store.settings.readSettings()).toBeNull();
	});

	it("writes and reads the sanitized record", () => {
		store.settings.writeSettings({ version: 1 } as never);
		expect(store.settings.readSettings()).toEqual(expect.objectContaining({ version: 1 }));
	});

	it("refuses a record that is not an object", () => {
		expect(() => store.settings.writeSettings("x" as never)).toThrow("must be a JSON object");
	});

	it("reads a broken stored record as null", () => {
		store.db.run("INSERT INTO settings (key, json) VALUES ('user', 'not json')");
		expect(store.settings.readSettings()).toBeNull();
	});
});
