/**
 * The graph pipeline cost on the Graph tab (issue 08 slice F, decision 4A):
 * the cost number under "Chains", the cost sheet (the desktop
 * `GraphCostPanel`) and one pill for each run in progress.
 *
 * The rules:
 * - The phone never computes dollars. The Mac folds the costs
 *   (`GET /api/graph/costs`), and the labels come from the fork's
 *   `src/core/graph-cost-format.ts`, the same code as the desktop.
 * - The cost number shows only when the Mac has a recent run, as the desktop.
 * - State 11: when the costs call fails, there is no cost number and no
 *   sheet; when the status call fails, there are no run pills. The graph
 *   still shows.
 */
import type { PipelineRun } from "./graph-api";
import {
	displayCostTotals,
	graphCostStageRows,
	graphUsageLabel,
	pipelineRunSeconds,
	recentRunCostLabel,
	runTimeAgo,
	stageCostLabel,
	stageTokensLabel,
	stageUnpricedCount,
	type GraphCostSummary,
} from "./shared";

/** The sheet title (the desktop panel header). */
export const COST_SHEET_TITLE = "Graph pipeline costs";

/** The cost number, or null when it does not show (no costs, no runs). */
export function costNumber(costs: GraphCostSummary | null): string | null {
	if (!costs || costs.runs.length === 0) return null;
	return graphUsageLabel(costs);
}

export interface CostSheetStage {
	label: string;
	cost: string;
	/** "+1 unpriced", or null. */
	unpriced: string | null;
	tokens: string;
}

export interface CostSheetRun {
	key: string;
	age: string;
	title: string;
	/** "+13n" (the merged nodes), or null. */
	merged: string | null;
	cost: string;
}

export interface CostSheetModel {
	total: string;
	/** "· 2 unpriced", or null. */
	unpriced: string | null;
	stages: CostSheetStage[];
	runs: CostSheetRun[];
}

/** The cost sheet: the desktop panel rows, as text. */
export function costSheet(costs: GraphCostSummary, now: number = Date.now()): CostSheetModel {
	const { unpricedRuns } = displayCostTotals(costs);
	return {
		total: graphUsageLabel(costs),
		unpriced: unpricedRuns > 0 ? `· ${unpricedRuns} unpriced` : null,
		stages: graphCostStageRows(costs).map(([label, stage]) => {
			const count = stageUnpricedCount(stage);
			return {
				label,
				cost: stageCostLabel(stage),
				unpriced: count === null ? null : `+${count} unpriced`,
				tokens: stageTokensLabel(stage),
			};
		}),
		runs: costs.runs.map((run, i) => ({
			key: `${run.startedAt}-${i}`,
			age: runTimeAgo(run.startedAt, now),
			title: run.title,
			merged: run.merged ? `+${run.merged.nodes}n` : null,
			cost: recentRunCostLabel(run),
		})),
	};
}

export interface RunPill {
	id: string;
	/** "Extracting" (the desktop shows the phase with a capital letter). */
	phase: string;
	title: string;
	/** "12s". */
	seconds: string;
	/** What VoiceOver reads. */
	label: string;
}

/** One pill for each run in progress; none when the status call failed. */
export function runPills(runs: PipelineRun[] | null, now: number = Date.now()): RunPill[] {
	return (runs ?? []).map((run) => {
		const phase = run.phase.charAt(0).toUpperCase() + run.phase.slice(1);
		const seconds = `${pipelineRunSeconds(run.startedAt, now)}s`;
		return {
			id: run.id,
			phase,
			title: run.title,
			seconds,
			label: `${phase} ${run.title}, ${seconds}`,
		};
	});
}
