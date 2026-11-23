/**
 * The session stats golden test (issue 08 slice E): the fork's recorded
 * teach chat (25 turns, 1 compaction) through the fork's server code (the
 * real Pi pricing and the model catalog, tests/helpers/fork-session-stats.mts)
 * and the desktop stats bar steps, against the phone's own path: the record
 * read, the catalog and settings reads, `SessionModel`'s measured context,
 * and `sessionStats`. The phone values must equal the desktop values.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { usageOf } from "@/lib/sessions";
import {
	NO_CONTEXT,
	NO_LIMIT,
	readModelLimits,
	readStrongModel,
	sessionModelId,
	sessionStats,
	stepsLabel,
} from "@/lib/session-stats";
import { SessionModel, cliContextWindowOf, type LhMessage } from "@/lib/shared";

const FORK = path.resolve(__dirname, "../../learnharness");
const CHAT = "chat_mv27rrra_feff23b6";

interface DesktopStats {
	model: string;
	limit: number | null;
	contextTokens: number | null;
	context: string;
	cost: string;
	cacheHitRate: string | null;
	unpriced: number;
	turns: { label: string; steps: number; cost: string }[];
}
interface Golden {
	record: { messages: LhMessage[]; turns: unknown[] } & Record<string, unknown>;
	catalog: { models: unknown[] };
	withLimit: { models: unknown[] };
	settings: unknown;
	atEnd: DesktopStats;
	atEndWithLimit: DesktopStats;
	atCompaction: DesktopStats;
	compactions: number;
}

let golden: Golden;

beforeAll(() => {
	const stdout = execFileSync(
		path.join(FORK, "node_modules/.bin/tsx"),
		[path.join(__dirname, "helpers/fork-session-stats.mts"), FORK, CHAT],
		{ cwd: FORK, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	golden = JSON.parse(stdout) as Golden;
}, 120_000);

const answer = (body: unknown) =>
	(async () =>
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;

/** The phone path, step by step as the session screen. */
async function phoneStats(messages: LhMessage[], catalog: unknown) {
	const usage = usageOf(golden.record);
	const limits = await readModelLimits(answer(catalog));
	const strong = await readStrongModel(answer({ settings: golden.settings }));
	const model = new SessionModel({ chatId: CHAT, initialMessages: messages, fetch: answer({}) });
	return sessionStats({
		turns: usage.turns,
		pricing: usage.pricing,
		contextTokens: model.getState().contextTokens,
		model: sessionModelId(usage.settings, strong),
		limits,
		cliWindow: cliContextWindowOf(messages),
	});
}

function expectSame(phone: Awaited<ReturnType<typeof phoneStats>>, desktop: DesktopStats) {
	expect(phone.context).toBe(desktop.context);
	expect(phone.cost).toBe(desktop.cost);
	expect(phone.cacheHitRate).toBe(desktop.cacheHitRate);
	expect(phone.unpriced).toBe(desktop.unpriced);
	expect(phone.turns.map((t) => ({ label: t.label, steps: t.steps, cost: t.cost }))).toEqual(
		desktop.turns,
	);
}

describe("session stats golden (slice E)", () => {
	it("uses the recorded teach chat: 25 turns and 1 compaction, all priced", () => {
		expect(golden.record.turns).toHaveLength(25);
		expect(golden.compactions).toBe(1);
		expect(golden.atEnd.unpriced).toBe(0);
		expect(golden.atEnd.cost).toMatch(/^\$0\.\d{4}$/);
	});

	it("shows the desktop values at the end of the chat, with a known limit", async () => {
		const phone = await phoneStats(golden.record.messages, golden.withLimit);
		expectSame(phone, golden.atEndWithLimit);
		expect(phone.context).toBe("36.9k / 131.1k");
		expect(phone.notes).toEqual([]);
		expect(phone.turns[0]).toMatchObject({ steps: 3 });
		expect(stepsLabel(phone.turns[1]!.steps)).toBe("1 step");
	});

	it("shows only the tokens when the catalog has no entry for the model (state 9)", async () => {
		const phone = await phoneStats(golden.record.messages, golden.catalog);
		expectSame(phone, golden.atEnd);
		expect(phone.context).toBe("36.9k");
		expect(phone.notes).toEqual([NO_LIMIT]);
	});

	it("shows ? right after the compaction (state 10)", async () => {
		const marker = golden.record.messages.findLastIndex(
			(m) => m.role === "custom" && (m as { customType?: string }).customType === "compaction",
		);
		const phone = await phoneStats(golden.record.messages.slice(0, marker + 1), golden.withLimit);
		expectSame(phone, golden.atCompaction);
		expect(phone.context).toBe("? / 131.1k");
		expect(phone.notes).toEqual([NO_CONTEXT]);
	});
});
