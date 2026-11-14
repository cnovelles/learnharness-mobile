/**
 * The lesson map (issue 04 slice B): the latest plan tree, the step order
 * and indent, and the statuses from the shared derivePlanStatusesLh.
 */
import { latestPlanTree, planSteps, treeOf } from "@/lib/plan";
import type { LhMessage, PlanTree } from "@/lib/shared";

const TREE: PlanTree = {
	nodes: [
		{ id: "bulges", title: "Two bulges", summary: "Why there are two." },
		{ id: "pull", title: "Uneven pull" },
		{ id: "sun", title: "The Sun's part" },
	],
	edges: [
		{ from: "pull", to: "bulges" },
		{ from: "bulges", to: "sun" },
	],
	version: 1,
};

const planPart = (output: unknown, state = "output-available") => ({
	type: "tool-plan_init",
	state,
	output,
});

const check = (id: string, nodeId: string) =>
	({
		role: "assistant",
		id,
		content: [
			{
				type: "toolCall",
				id: `c_${id}`,
				name: "quiz",
				arguments: { question: "Q", options: [], correctAnswer: "a", nodeId },
			},
		],
		stopReason: "toolUse",
		timestamp: 1,
	}) as unknown as LhMessage;

describe("latestPlanTree", () => {
	it("takes the latest successful plan", () => {
		const newer = { ...TREE, nodes: [TREE.nodes[0]!], version: 2 };
		expect(
			latestPlanTree([
				{ parts: [planPart({ ok: true, tree: TREE })] },
				{ parts: [planPart({ ok: true, tree: newer })] },
			])?.version,
		).toBe(2);
	});

	it("error state: a later failed plan keeps the earlier map", () => {
		expect(
			latestPlanTree([
				{ parts: [planPart({ ok: true, tree: TREE })] },
				{ parts: [planPart({ ok: false, error: "bad" })] },
				{ parts: [planPart(undefined, "output-error")] },
			])?.version,
		).toBe(1);
	});

	it.each([
		["a failed call", planPart(undefined, "output-error")],
		["ok false", planPart({ ok: false, tree: TREE })],
		["no nodes", planPart({ ok: true, tree: { nodes: [], edges: [] } })],
		["nodes that are not nodes", planPart({ ok: true, tree: { nodes: ["x", { id: 1 }] } })],
		["no tree", planPart({ ok: true })],
		["a call that still runs", planPart(undefined, "input-available")],
	])("error state: %s gives no map", (_n, part) => {
		expect(latestPlanTree([{ parts: [part] }])).toBeNull();
	});

	it("drops bad edges and keeps the good nodes", () => {
		expect(
			treeOf({ ok: true, tree: { nodes: [{ id: "a", title: "A" }, null], edges: [{ from: 1 }] } }),
		).toEqual({ nodes: [{ id: "a", title: "A" }], edges: [], version: 0 });
	});
});

describe("planSteps", () => {
	it("orders the steps by prerequisite and indents them", () => {
		const steps = planSteps(TREE, []);
		expect(steps.map((s) => [s.id, s.depth])).toEqual([
			["pull", 0],
			["bulges", 1],
			["sun", 2],
		]);
		expect(steps[1]).toMatchObject({ summary: "Why there are two." });
	});

	it("before the first check, every step is upcoming", () => {
		expect(planSteps(TREE, []).map((s) => s.status)).toEqual(["upcoming", "upcoming", "upcoming"]);
	});

	it("the step of the latest check is current; earlier steps are done", () => {
		const steps = planSteps(TREE, [check("a1", "pull"), check("a2", "bulges")]);
		expect(Object.fromEntries(steps.map((s) => [s.id, s.status]))).toEqual({
			pull: "done",
			bulges: "current",
			sun: "upcoming",
		});
	});

	it("error state: a check for a step that is not in the plan moves nothing", () => {
		const steps = planSteps(TREE, [check("a1", "pull"), check("a2", "gone")]);
		expect(steps.find((s) => s.id === "pull")?.status).toBe("current");
	});

	it("error state: a cycle in the tree still lists every step once", () => {
		const cyclic: PlanTree = {
			...TREE,
			edges: [
				{ from: "pull", to: "bulges" },
				{ from: "bulges", to: "pull" },
				{ from: "sun", to: "sun" },
				{ from: "ghost", to: "sun" },
			],
		};
		const steps = planSteps(cyclic, []);
		expect(steps.map((s) => s.id).sort()).toEqual(["bulges", "pull", "sun"]);
		expect(steps.every((s) => s.depth === 0)).toBe(true);
	});
});
