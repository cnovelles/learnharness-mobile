/**
 * Issue 09 acceptance: the fork's golden data, loaded into the SQLite store,
 * reads the same as through the desktop's own fs stores, and projects the
 * same view as upstream `projectView`.
 *
 * The helper script (tests/helpers/fork-golden-stores.mts) reads a copy of
 * the golden data through the fork. This test reads the golden files (only
 * reads; nothing is written there), loads them into a new SQLite store, and
 * compares. The real data folder is never read.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getGraph } from "@lh/src/core/graph";
import { projectView, type ChatRecord, type JobRecord } from "@/lib/shared";

import { makeTestStore } from "../helpers/local-store";

jest.setTimeout(60_000);

const FORK = path.resolve(__dirname, "../../../learnharness");
const GOLDEN = path.join(FORK, "tests/fixtures/golden-data");

interface Desktop {
	list: unknown[];
	records: Record<string, ChatRecord>;
	views: Record<string, unknown>;
	jobs: Record<string, JobRecord[]>;
	settings: unknown;
	ledgers: Record<string, unknown>;
	graph: unknown;
}

function jsonl(file: string): unknown[] {
	return fs
		.readFileSync(path.join(GOLDEN, "graph", file), "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as unknown);
}

/** The same Map-to-entries step as the helper script, so both sides compare as JSON. */
function asJson(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (_key, v: unknown) => (v instanceof Map ? [...v.entries()] : v)),
	);
}

let desktop: Desktop;
let store: ReturnType<typeof makeTestStore>;

beforeAll(() => {
	desktop = JSON.parse(
		execFileSync(
			path.join(FORK, "node_modules/.bin/tsx"),
			[path.join(__dirname, "../helpers/fork-golden-stores.mts"), FORK],
			{ cwd: FORK, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
		),
	) as Desktop;

	store = makeTestStore();
	for (const name of fs.readdirSync(path.join(GOLDEN, "chats"))) {
		const record = JSON.parse(
			fs.readFileSync(path.join(GOLDEN, "chats", name), "utf8"),
		) as ChatRecord;
		expect(store.chats.importChat(record, "local")).toBe(true);
	}
	for (const name of fs.readdirSync(path.join(GOLDEN, "jobs"))) {
		store.jobs.importJob(
			JSON.parse(fs.readFileSync(path.join(GOLDEN, "jobs", name), "utf8")) as JobRecord,
		);
	}
	const graph = store.imports.graph;
	for (const line of jsonl("nodes.jsonl")) graph.appendNode(line as never);
	for (const line of jsonl("chains.jsonl")) graph.appendChain(line as never);
	for (const line of jsonl("sessions.jsonl")) graph.appendCheckpoint(line as never);
	for (const line of jsonl("coverage.jsonl")) graph.appendCoverage(line as never);
	const sources = JSON.parse(
		fs.readFileSync(path.join(GOLDEN, "graph/sources.json"), "utf8"),
	) as Record<string, never>;
	for (const source of Object.values(sources)) graph.upsertSource(source);
	const positions = JSON.parse(
		fs.readFileSync(path.join(GOLDEN, "graph/positions.json"), "utf8"),
	) as { positions: Record<string, { x: number; y: number }> };
	graph.writePositions(positions.positions);
	store.settings.writeSettings(
		JSON.parse(fs.readFileSync(path.join(GOLDEN, "settings.json"), "utf8")) as never,
	);
});
afterAll(() => store.close());

it("lists the sessions as the desktop's listChats does", () => {
	expect(desktop.list.length).toBeGreaterThanOrEqual(2);
	expect(store.chats.listChats()).toEqual(desktop.list);
});

it("reads each record as the desktop's getChat does", () => {
	for (const [id, record] of Object.entries(desktop.records)) {
		expect(store.chats.getChat(id)).toEqual(record);
	}
});

it("projects the same view as upstream projectView", () => {
	expect(Object.keys(desktop.views)).toHaveLength(desktop.list.length);
	for (const [id, view] of Object.entries(desktop.views)) {
		expect((view as unknown[]).length).toBeGreaterThan(0);
		expect(asJson(projectView(store.chats.getChat(id)!.messages))).toEqual(view);
	}
});

it("keeps one row for each golden message", () => {
	for (const [id, record] of Object.entries(desktop.records)) {
		expect(
			store.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", id)!.n,
		).toBe(record.messages.length);
	}
});

it("reads the jobs and the settings as the desktop does", () => {
	for (const [id, jobs] of Object.entries(desktop.jobs)) {
		expect(store.jobs.listJobs(id)).toEqual(jobs);
	}
	expect(store.settings.readSettings()).toEqual(desktop.settings);
});

it("reads the graph ledgers and derives the same graph as upstream getGraph", () => {
	expect((desktop.ledgers.nodes as unknown[]).length).toBeGreaterThan(200);
	expect((desktop.ledgers.chains as unknown[]).length).toBeGreaterThan(100);
	expect({
		nodes: store.graph.readNodes(),
		chains: store.graph.readChains(),
		checkpoints: store.graph.readCheckpoints(),
		coverage: store.graph.readCoverage(),
		sources: store.graph.readSources(),
		positions: store.graph.readPositions(),
	}).toEqual(desktop.ledgers);
	expect(asJson(getGraph(store.graph))).toEqual(desktop.graph);
});

it("adds no outbox rows for the import", () => {
	// Only the settings write went through a local port.
	expect(store.outbox.pending().map((e) => e.entity)).toEqual(["settings"]);
});
