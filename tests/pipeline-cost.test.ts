/**
 * Issue 08 slice F: the pipeline cost model of the Graph tab (the cost
 * number, the cost sheet and the run pills). The labels come from the fork's
 * src/core/graph-cost-format.ts; the golden test compares them with the
 * desktop on the fork's golden data (tests/knowledge-golden.test.ts).
 */
import type { PipelineRun } from "@/lib/graph-api";
import { costNumber, costSheet, runPills } from "@/lib/pipeline-cost";
import type { GraphCostSummary, StageCost } from "@/lib/shared";

const NOW = Date.UTC(2026, 10, 23, 12);
const tokens = (input: number, output: number): StageCost["tokens"] => ({
	inputTokens: input,
	outputTokens: output,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	reasoningTokens: 0,
});

function costs(over: Partial<GraphCostSummary> = {}): GraphCostSummary {
	return {
		totalDollars: 0.0233,
		unpricedRuns: 0,
		stages: {
			extraction: { dollars: 0.0135, unpricedRuns: 0, runs: 8, tokens: tokens(71193, 80854) },
			audit: { dollars: 0.0098, unpricedRuns: 0, runs: 8, tokens: tokens(111675, 42617) },
		},
		runs: [
			{
				startedAt: NOW - 12 * 60_000,
				at: "2026-11-23T11:50:00.000Z",
				durationMs: 1000,
				kind: "extraction",
				title: "learning libertarianism.md",
				dollars: 0.0023,
				tokens: tokens(18437, 12134),
				merged: { nodes: 13, chains: 10 },
			},
			{
				startedAt: NOW - 3 * 3_600_000,
				at: "2026-11-23T09:00:00.000Z",
				durationMs: 1000,
				kind: "extraction",
				title: "Teach: databases",
				dollars: null,
				tokens: tokens(10, 10),
				subscriptionRuns: 1,
				subscriptionProviders: ["ChatGPT"],
			},
		],
		...over,
	};
}

describe("the cost number", () => {
	it("shows the desktop total at 2 decimals", () => {
		expect(costNumber(costs())).toBe("$0.02");
	});

	it("does not show without recent runs, as the desktop", () => {
		expect(costNumber(costs({ runs: [] }))).toBeNull();
	});

	it("state 11: does not show when the costs call failed", () => {
		expect(costNumber(null)).toBeNull();
	});

	it("state 8: shows a dash, never $0.00, when no run has a price", () => {
		const c = costs();
		c.stages.extraction = { ...c.stages.extraction, unpricedRuns: 8 };
		c.stages.audit = { ...c.stages.audit, unpricedRuns: 8 };
		expect(costNumber(c)).toBe("—");
	});
});

describe("the cost sheet", () => {
	it("has the desktop panel rows: the total, the stages and the recent runs", () => {
		const sheet = costSheet(costs(), NOW);
		expect(sheet.total).toBe("$0.02");
		expect(sheet.unpriced).toBeNull();
		expect(sheet.stages).toEqual([
			{ label: "Extraction", cost: "$0.013", unpriced: null, tokens: "71.2k in / 80.9k out" },
			{ label: "Audit", cost: "$0.010", unpriced: null, tokens: "111.7k in / 42.6k out" },
		]);
		expect(sheet.runs.map(({ age, title, merged, cost }) => [age, title, merged, cost])).toEqual([
			["12m", "learning libertarianism.md", "+13n", "$0.002"],
			["3h", "Teach: databases", null, "ChatGPT +1 unpriced"],
		]);
	});

	it("counts the unpriced runs in the total and on the stage row", () => {
		const c = costs();
		c.stages.extraction = { ...c.stages.extraction, runs: 9, unpricedRuns: 1 };
		const sheet = costSheet(c, NOW);
		expect(sheet.unpriced).toBe("· 1 unpriced");
		expect(sheet.stages[0]).toMatchObject({ cost: "$0.013", unpriced: "+1 unpriced" });
	});

	it("gives each run a separate key, also for two runs that start together", () => {
		const c = costs();
		c.runs = [c.runs[0]!, { ...c.runs[0]! }];
		const keys = costSheet(c, NOW).runs.map((r) => r.key);
		expect(new Set(keys).size).toBe(2);
	});
});

describe("the run pills", () => {
	const run = (over: Partial<PipelineRun> = {}): PipelineRun => ({
		id: "chat_a",
		chatId: "chat_a",
		title: "Eigenvalues",
		phase: "extracting",
		startedAt: NOW - 12_400,
		...over,
	});

	it("show the phase with a capital letter, the title and the seconds", () => {
		expect(runPills([run()], NOW)).toEqual([
			{
				id: "chat_a",
				phase: "Extracting",
				title: "Eigenvalues",
				seconds: "12s",
				label: "Extracting Eigenvalues, 12s",
			},
		]);
	});

	it("never show a time below 0 s", () => {
		expect(runPills([run({ startedAt: NOW + 5000 })], NOW)[0]!.seconds).toBe("0s");
	});

	it("state 11: show nothing when the status call failed", () => {
		expect(runPills(null, NOW)).toEqual([]);
	});
});
