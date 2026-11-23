/**
 * The session stats model (issue 08 slice E): the line and sheet strings,
 * error states 8, 9 and 10, the Claude Code and plan cases, and the checks
 * of the record, catalog and settings bodies.
 */
import { usageOf } from "@/lib/sessions";
import {
	NO_CONTEXT,
	NO_LIMIT,
	NO_PRICE,
	chatSettingsOf,
	pricingOf,
	readModelLimits,
	readStrongModel,
	sessionModelId,
	sessionStats,
	stepsLabel,
	turnsOf,
	type StatsInput,
} from "@/lib/session-stats";
import type { TurnUsage } from "@/lib/shared";

type CallUsage = TurnUsage["steps"][number];
const step = (over: Partial<CallUsage> = {}): CallUsage => ({
	inputTokens: 100,
	outputTokens: 10,
	cacheReadTokens: undefined,
	cacheWriteTokens: undefined,
	reasoningTokens: undefined,
	...over,
});

const turn = (
	id: string,
	model = "openrouter:deepseek/deepseek-v4.1-flash",
	steps = 1,
): TurnUsage => ({
	id,
	messageId: `m_${id}`,
	at: "2026-11-23T10:00:00.000Z",
	model,
	steps: Array.from({ length: steps }, () => step()),
});

const base = (over: Partial<StatsInput> = {}): StatsInput => ({
	turns: [turn("t1", undefined, 3), turn("t2")],
	pricing: { cost: 0.0123, unpriced: 0, turnCosts: { t1: 0.0011, t2: 0.0112 } },
	contextTokens: 38_000,
	model: "openrouter:deepseek/deepseek-v4.1-flash",
	limits: new Map([["openrouter:deepseek/deepseek-v4.1-flash", 200_000]]),
	cliWindow: null,
	...over,
});

const answer = (body: unknown, status = 200) =>
	(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("sessionStats", () => {
	it("gives the desktop line and sheet strings", () => {
		const s = sessionStats(base());
		expect(s.context).toBe("38k / 200k");
		expect(s.cost).toBe("$0.0123");
		expect(s.costTitle).toBe("Total cost");
		expect(s.cacheHitRate).toBeNull();
		expect(s.unpriced).toBe(0);
		expect(s.notes).toEqual([]);
		expect(s.turns).toEqual([
			{ key: "m_t1-0", label: "#1 · deepseek-v4.1-flash · openrouter", steps: 3, cost: "$0.0011" },
			{ key: "m_t2-1", label: "#2 · deepseek-v4.1-flash · openrouter", steps: 1, cost: "$0.0112" },
		]);
	});

	it("shows dollars with two decimals from $1", () => {
		expect(sessionStats(base({ pricing: { cost: 1.5, unpriced: 0, turnCosts: {} } })).cost).toBe(
			"$1.50",
		);
	});

	it("error state 8: no turn has a price, so the cost is —, never $0.0000", () => {
		const s = sessionStats(
			base({ pricing: { cost: 0, unpriced: 2, turnCosts: { t1: null, t2: null } } }),
		);
		expect(s.cost).toBe("—");
		expect(s.unpriced).toBe(2);
		expect(s.notes).toEqual([NO_PRICE]);
		expect(s.turns.map((t) => t.cost)).toEqual(["—", "—"]);
	});

	it("error state 8: no pricing in the record counts every turn as unpriced", () => {
		const s = sessionStats(base({ pricing: undefined }));
		expect(s.cost).toBe("—");
		expect(s.unpriced).toBe(2);
	});

	it("a partly priced session shows the priced sum and the unpriced count", () => {
		const s = sessionStats(
			base({ pricing: { cost: 0.0011, unpriced: 1, turnCosts: { t1: 0.0011, t2: null } } }),
		);
		expect(s.cost).toBe("$0.0011");
		expect(s.unpriced).toBe(1);
		expect(s.notes).toEqual([]);
	});

	it("no turns yet: — with no note (there is nothing to price)", () => {
		const s = sessionStats(base({ turns: [], pricing: { cost: 0, unpriced: 0, turnCosts: {} } }));
		expect(s.cost).toBe("—");
		expect(s.notes).toEqual([]);
	});

	it("error state 9: an unknown limit shows only the tokens", () => {
		expect(sessionStats(base({ limits: undefined })).context).toBe("38k");
		expect(sessionStats(base({ limits: new Map() })).notes).toEqual([NO_LIMIT]);
		expect(sessionStats(base({ model: undefined })).context).toBe("38k");
	});

	it("error state 10: no measured context shows ?", () => {
		const s = sessionStats(base({ contextTokens: null }));
		expect(s.context).toBe("? / 200k");
		expect(s.notes).toEqual([NO_CONTEXT]);
		expect(sessionStats(base({ contextTokens: null, limits: undefined })).context).toBe("?");
	});

	it("gives the notes in the order 8, 9, 10", () => {
		const s = sessionStats(base({ pricing: undefined, limits: undefined, contextTokens: null }));
		expect(s.notes).toEqual([NO_PRICE, NO_LIMIT, NO_CONTEXT]);
	});

	it("a Claude Code model takes the limit from its own report and shows the note", () => {
		const model = "claude-code:sonnet";
		const s = sessionStats(
			base({
				model,
				turns: [turn("t1", model)],
				pricing: { cost: 0, unpriced: 1, turnCosts: { t1: null } },
				cliWindow: { model, tokens: 200_000 },
				limits: new Map(),
			}),
		);
		expect(s.context).toBe("38k / 200k");
		expect(s.cliNote).toBe(true);
		expect(s.cost).toBe("CLI");
		expect(s.turns[0]!.cost).toBe("CLI");
		expect(s.notes).toEqual([]);
		// A report from another model gives no limit.
		expect(
			sessionStats(base({ model, cliWindow: { model: "claude-code:opus", tokens: 1 } })).context,
		).toBe("38k");
	});

	it("a plan turn shows Usage, the plan name and the ChatGPT usage link", () => {
		const model = "chatgpt:gpt-5";
		const s = sessionStats(
			base({
				turns: [turn("t1"), turn("t2", model)],
				pricing: {
					cost: 0.0011,
					unpriced: 0,
					subscription: 1,
					subscriptionProviders: ["ChatGPT"],
					turnCosts: { t1: 0.0011, t2: null },
				},
			}),
		);
		expect(s.costTitle).toBe("Usage");
		expect(s.cost).toBe("$0.0011 + ChatGPT");
		expect(s.chatGptUsage).toBe(true);
		expect(s.turns[1]!.cost).toBe("ChatGPT");
	});

	it("shows the cache hit rate with one decimal", () => {
		const t: TurnUsage = { ...turn("t1"), steps: [step({ cacheReadTokens: 300 })] };
		expect(sessionStats(base({ turns: [t] })).cacheHitRate).toBe("75.0%");
	});
});

describe("stepsLabel and sessionModelId", () => {
	it("writes one step and many steps", () => {
		expect(stepsLabel(1)).toBe("1 step");
		expect(stepsLabel(0)).toBe("0 steps");
		expect(stepsLabel(3)).toBe("3 steps");
	});

	it("uses the session's own model, else the strong slot", () => {
		const own = { model: { provider: "a", id: "x" } };
		const strong = { model: { provider: "b", id: "y" } };
		expect(sessionModelId(own, strong)).toBe("a:x");
		expect(sessionModelId({}, strong)).toBe("b:y");
		expect(sessionModelId(undefined, undefined)).toBeUndefined();
	});
});

describe("the record body checks", () => {
	it("reads the usage log, the pricing and the model setting", () => {
		const usage = usageOf({
			turns: [turn("t1")],
			pricing: { cost: 0.1, unpriced: 0, turnCosts: { t1: 0.1 } },
			settings: { model: { provider: "a", id: "x" }, thinkingLevel: "low" },
		});
		expect(usage.turns).toHaveLength(1);
		expect(usage.pricing?.cost).toBe(0.1);
		expect(usage.settings).toEqual({ model: { provider: "a", id: "x" } });
	});

	it("drops a malformed usage log, a malformed pricing and a malformed model", () => {
		expect(turnsOf([{ id: "t1" }])).toEqual([]);
		expect(turnsOf("x")).toEqual([]);
		expect(pricingOf({ cost: "1", unpriced: 0, turnCosts: {} })).toBeUndefined();
		expect(pricingOf({ cost: -1, unpriced: 0, turnCosts: {} })).toBeUndefined();
		expect(pricingOf({ cost: 1, unpriced: 0 })).toBeUndefined();
		expect(pricingOf({ cost: 1, unpriced: 0, subscription: "x", turnCosts: {} })).toBeUndefined();
		expect(chatSettingsOf({ model: { provider: 1 } })).toEqual({});
		expect(chatSettingsOf(null)).toBeUndefined();
		expect(usageOf(null)).toEqual({ turns: [] });
	});
});

describe("the catalog and settings reads", () => {
	it("reads the catalog limits and skips bad entries", async () => {
		const limits = await readModelLimits(
			answer({
				models: [
					{ provider: "a", id: "x", contextWindow: 200_000 },
					{ provider: "a", id: "none", contextWindow: null },
					{ provider: "a", id: "bad", contextWindow: -1 },
					{ provider: "a", id: "float", contextWindow: 1.5 },
					{ id: "no-provider", contextWindow: 10 },
				],
			}),
		);
		expect([...limits!]).toEqual([["a:x", 200_000]]);
	});

	it("gives undefined when the catalog read fails or the body is not a catalog (state 9)", async () => {
		expect(await readModelLimits(answer({ error: "x" }, 500))).toBeUndefined();
		expect(await readModelLimits(answer({ models: "x" }))).toBeUndefined();
		const offline = (async () => {
			throw new TypeError("Network request failed");
		}) as unknown as typeof fetch;
		expect(await readModelLimits(offline)).toBeUndefined();
		expect(await readStrongModel(offline)).toBeUndefined();
	});

	it("reads the strong slot model from the settings", async () => {
		expect(
			await readStrongModel(
				answer({ settings: { models: { strong: { model: { provider: "b", id: "y" } } } } }),
			),
		).toEqual({ model: { provider: "b", id: "y" } });
		expect(await readStrongModel(answer({ settings: null }))).toBeUndefined();
		expect(await readStrongModel(answer({}, 403))).toBeUndefined();
	});
});
