/**
 * ESM (.mts) for top-level await. Run with tsx from the fork folder (see
 * tests/session-stats-golden.test.ts). It copies the fork's golden data to
 * a temporary folder and reads the recorded teach chat through the fork's
 * server code: the `pricing` that `GET /api/chats/:id` sends and the catalog
 * that `GET /api/models` sends. Then it runs the desktop stats bar steps
 * (fork components/stats-bar.tsx and src/core/session-stats.ts) on them and prints the results as JSON.
 * The phone test compares its own model with them. The real data folder is
 * never read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fork = process.argv[2]!;
const chatId = process.argv[3]!;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phone-stats-"));
fs.cpSync(path.join(fork, "tests/fixtures/golden-data"), tmp, { recursive: true });
// The data folder seam: set before any import that reads the config.
process.env.LH_DATA_DIR = tmp;

try {
	const { sessionCost } = await import(path.join(fork, "src/server/pricing.ts"));
	const { modelCatalog } = await import(path.join(fork, "src/server/index.ts"));
	const { measuredContextTokens } = await import(path.join(fork, "src/core/context-usage.ts"));
	const { cliContextWindowOf } = await import(path.join(fork, "src/core/native-messages.ts"));
	const { catalogLimits } = await import(path.join(fork, "src/core/usage-format.ts"));
	const { sessionStatsSummary } = await import(path.join(fork, "src/core/session-stats.ts"));

	const chat = JSON.parse(fs.readFileSync(path.join(tmp, "chats", `${chatId}.json`), "utf8"));
	const settings = JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf8"));
	const pricing = sessionCost(chat);
	const catalog = modelCatalog();

	// The stats bar (stats-bar.tsx): the catalog limits, then the core
	// summary. The model is the session's own setting, else the strong slot
	// (model-picker.tsx).
	const stats = (messages: unknown[], catalog: { models: unknown[] }) => {
		const m = chat.settings?.model ?? settings.models?.strong?.model;
		const model = m ? `${m.provider}:${m.id}` : undefined;
		const summary = sessionStatsSummary({
			turns: chat.turns ?? [],
			pricing,
			contextTokens: measuredContextTokens(messages),
			model,
			limits: catalogLimits(catalog),
			cliWindow: cliContextWindowOf(messages),
		});
		return {
			...summary,
			model,
			contextTokens: measuredContextTokens(messages),
			// The popover's rate text (stats-bar.tsx).
			cacheHitRate:
				summary.cacheHitRate === null ? null : `${(summary.cacheHitRate * 100).toFixed(1)}%`,
		};
	};
	// The golden data has no provider key, so its catalog is empty (state 9).
	// A second catalog has one entry for the session's model.
	const strong = settings.models.strong.model;
	const withLimit = {
		models: [{ provider: strong.provider, id: strong.id, contextWindow: 131072 }],
	};
	// The record as it ends, and the record when the compaction marker was last.
	const marker = chat.messages.findLastIndex(
		(m: { role: string; customType?: string }) =>
			m.role === "custom" && m.customType === "compaction",
	);
	process.stdout.write(
		JSON.stringify({
			record: { ...chat, pricing },
			catalog,
			settings,
			withLimit,
			atEnd: stats(chat.messages, catalog),
			atEndWithLimit: stats(chat.messages, withLimit),
			atCompaction: stats(chat.messages.slice(0, marker + 1), withLimit),
			compactions: chat.messages.filter(
				(m: { role: string; customType?: string }) =>
					m.role === "custom" && m.customType === "compaction",
			).length,
		}),
	);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
