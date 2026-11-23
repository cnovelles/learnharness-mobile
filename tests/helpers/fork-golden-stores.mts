/**
 * ESM (.mts) for top-level await. Run with tsx from the fork folder (see
 * tests/store/golden-store.test.ts). It copies the fork's golden data to a
 * temporary folder and reads it through the desktop's own fs stores
 * (`src/store/*.ts`) and the upstream `projectView` and `getGraph`. It
 * prints the results as JSON; the phone test expects the same results from
 * the SQLite adapters. The real data folder is never read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fork = process.argv[2]!;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phone-store-"));
fs.cpSync(path.join(fork, "tests/fixtures/golden-data"), tmp, { recursive: true });
// The data folder seam: set before any import that reads the config.
process.env.LH_DATA_DIR = tmp;

try {
	const { chatStore } = await import(path.join(fork, "src/store/chats.ts"));
	const { graphStore } = await import(path.join(fork, "src/store/graph.ts"));
	const { jobStore } = await import(path.join(fork, "src/store/jobs.ts"));
	const { settingsStore } = await import(path.join(fork, "src/store/settings.ts"));
	const { projectView } = await import(path.join(fork, "src/core/view.ts"));
	const { getGraph } = await import(path.join(fork, "src/core/graph.ts"));

	const list = chatStore.listChats();
	const records: Record<string, unknown> = {};
	const views: Record<string, unknown> = {};
	const jobs: Record<string, unknown> = {};
	for (const { id } of list) {
		const record = chatStore.getChat(id);
		records[id] = record;
		views[id] = projectView(record.messages);
		jobs[id] = jobStore.listJobs(id);
	}
	const graph = getGraph(graphStore);
	const out = {
		list,
		records,
		views,
		jobs,
		settings: settingsStore.readSettings(),
		ledgers: {
			nodes: graphStore.readNodes(),
			chains: graphStore.readChains(),
			checkpoints: graphStore.readCheckpoints(),
			coverage: graphStore.readCoverage(),
			sources: graphStore.readSources(),
			positions: graphStore.readPositions(),
		},
		// Maps do not go through JSON: print them as entry lists.
		graph: JSON.parse(
			JSON.stringify(graph, (_key, value: unknown) =>
				value instanceof Map ? [...value.entries()] : value,
			),
		),
	};
	process.stdout.write(JSON.stringify(out));
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
