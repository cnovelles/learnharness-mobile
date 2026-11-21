/**
 * The shared plan layout (issue 05 slice 0): the phone runs the fork's
 * DOM-free dagre layout, the same one the desktop draws.
 */
import { blockLayout, edgePathD, wrapTitle } from "@/lib/shared";

const NODES = [
	{ id: "pull", title: "Uneven pull" },
	{ id: "bulges", title: "Two bulges" },
	{ id: "sun", title: "The Sun's part" },
];

describe("blockLayout", () => {
	it("places each node and routes each edge, top to bottom", () => {
		const layout = blockLayout(NODES, [
			{ from: "pull", to: "bulges" },
			{ from: "bulges", to: "sun" },
		]);
		for (const n of NODES) {
			expect(layout.x.has(n.id)).toBe(true);
			expect(layout.y.has(n.id)).toBe(true);
		}
		expect(layout.y.get("pull")!).toBeLessThan(layout.y.get("bulges")!);
		expect(layout.y.get("bulges")!).toBeLessThan(layout.y.get("sun")!);
		expect([...layout.edgePts.keys()].sort()).toEqual(["bulges->sun", "pull->bulges"]);
		expect(layout.width).toBeGreaterThan(0);
		expect(layout.height).toBeGreaterThan(0);
	});

	it("drops an edge to a node that is not in the plan", () => {
		const layout = blockLayout(NODES, [
			{ from: "pull", to: "bulges" },
			{ from: "bulges", to: "ghost" },
		]);
		expect([...layout.edgePts.keys()]).toEqual(["pull->bulges"]);
		expect(layout.x.has("ghost")).toBe(false);
	});

	it("places each node one time when the edges make a cycle", () => {
		const layout = blockLayout(NODES, [
			{ from: "pull", to: "bulges" },
			{ from: "bulges", to: "pull" },
		]);
		expect(layout.x.size).toBe(NODES.length);
	});

	it("gives an empty plan no size", () => {
		const layout = blockLayout([], []);
		expect(layout.width).toBe(0);
		expect(layout.x.size).toBe(0);
	});
});

describe("edgePathD and wrapTitle", () => {
	it("draws an edge path from the layout points", () => {
		const layout = blockLayout(NODES.slice(0, 2), [{ from: "pull", to: "bulges" }]);
		const d = edgePathD(layout.edgePts.get("pull->bulges")!);
		expect(d.startsWith("M")).toBe(true);
	});

	it("wraps a long title and keeps every word", () => {
		const title = "How the Moon's uneven pull makes two tidal bulges on Earth";
		const lines = wrapTitle(title);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(" ")).toBe(title);
	});
});
