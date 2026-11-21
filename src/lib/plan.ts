/**
 * The lesson map and the phase for the phone (issue 04 slice B). The rules
 * are the desktop's:
 * - The phase labels are the desktop PhaseChip labels (fork
 *   components/phase-divider.tsx).
 * - The map is the latest successful plan tool result with tree nodes (fork
 *   latestTree, components/plan-block.tsx). A failed plan call, or a plan
 *   with no nodes, gives no map.
 * - The step statuses come from the shared derivePlanStatusesLh: the step
 *   of the latest tagged check is current, earlier steps are done, and the
 *   others are upcoming.
 * The phone shows the map as an indented list. The diagram comes in issue 05.
 */
import {
	derivePlanStatusesLh,
	derivedNodeStatus,
	type LhMessage,
	type Phase3,
	type PlanTree,
} from "./shared";

export const PHASE_LABEL: Record<Phase3, string> = {
	probe: "Probing",
	plan: "Planning",
	teach: "Teaching",
};

export type StepStatus = "current" | "done" | "upcoming";

export interface PlanStep {
	id: string;
	title: string;
	summary?: string;
	/** The indent: the length of the longest chain of prerequisites. */
	depth: number;
	status: StepStatus;
}

interface PartLike {
	type: string;
	state?: string;
	output?: unknown;
}

/** A tree with at least one node that has an id and a title, or null. */
export function treeOf(output: unknown): PlanTree | null {
	if (typeof output !== "object" || output === null) return null;
	const o = output as { ok?: unknown; tree?: unknown };
	if (o.ok === false) return null;
	const tree = o.tree as { nodes?: unknown; edges?: unknown; version?: unknown } | undefined;
	if (!tree || !Array.isArray(tree.nodes)) return null;
	const nodes = tree.nodes.filter(
		(n): n is PlanTree["nodes"][number] =>
			typeof n === "object" &&
			n !== null &&
			typeof (n as { id?: unknown }).id === "string" &&
			typeof (n as { title?: unknown }).title === "string",
	);
	if (nodes.length === 0) return null;
	const edges = (Array.isArray(tree.edges) ? tree.edges : []).filter(
		(e): e is PlanTree["edges"][number] =>
			typeof e === "object" &&
			e !== null &&
			typeof (e as { from?: unknown }).from === "string" &&
			typeof (e as { to?: unknown }).to === "string",
	);
	return { nodes, edges, version: typeof tree.version === "number" ? tree.version : 0 };
}

/** The tree of a plan tool part that succeeded, or null. */
export function planPartTree(part: PartLike): PlanTree | null {
	if (!part.type.startsWith("tool-plan_") || part.state !== "output-available") return null;
	return treeOf(part.output);
}

/** The latest plan tree in the view messages, or null. */
export function latestPlanTree(
	messages: readonly { parts: readonly PartLike[] }[],
): PlanTree | null {
	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]!.parts;
		for (let p = parts.length - 1; p >= 0; p--) {
			const tree = planPartTree(parts[p]!);
			if (tree) return tree;
		}
	}
	return null;
}

/**
 * The steps in prerequisite order (a stable topological order), each with
 * its indent and status. Steps in a cycle (a bad tree) come last at indent 0.
 */
export function planSteps(tree: PlanTree, nativeMessages: readonly LhMessage[]): PlanStep[] {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const parents = new Map<string, string[]>();
	for (const e of tree.edges) {
		if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
		parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
	}
	const depth = new Map<string, number>();
	const order: PlanTree["nodes"] = [];
	let progress = true;
	while (progress) {
		progress = false;
		for (const n of tree.nodes) {
			if (depth.has(n.id)) continue;
			const ps = parents.get(n.id) ?? [];
			if (!ps.every((p) => depth.has(p))) continue;
			depth.set(n.id, ps.length ? Math.max(...ps.map((p) => depth.get(p)!)) + 1 : 0);
			order.push(n);
			progress = true;
		}
	}
	for (const n of tree.nodes)
		if (!depth.has(n.id)) {
			depth.set(n.id, 0);
			order.push(n);
		}
	const statuses = derivePlanStatusesLh(tree, nativeMessages);
	return order.map((n) => {
		const s = derivedNodeStatus(statuses, n.id);
		return {
			id: n.id,
			title: n.title,
			...(typeof n.summary === "string" && n.summary ? { summary: n.summary } : {}),
			depth: depth.get(n.id)!,
			status: s === "visited" ? "done" : s,
		};
	});
}
