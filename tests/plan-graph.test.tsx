/**
 * Issue 05 slice E: the plan graph (docs/ISSUES.md, issue 05). The one-color
 * block in the transcript, the graph with statuses in the Plan sheet, the
 * scale for the phone width, and error state 14.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { PlanBlock, PlanGraph, PlanSheetGraph } from "@/components/plan-graph";
import { PlanSheet } from "@/components/plan-sheet";
import type { PlanStep, StepStatus } from "@/lib/plan";
import {
	MAX_SCALE,
	MAX_ZOOM,
	MIN_SCALE,
	canPan,
	fitViewport,
	panViewport,
	pinchViewport,
	viewWindow,
	graphScale,
	graphStatus,
	planGraph,
	type PlanGraphData,
} from "@/lib/plan-graph";
import { GLOW_REACH, GRAPH_PAD, LINE_H, type PlanTree } from "@/lib/shared";

// Error state 14: a test can make the shared layout throw.
let mockLayoutThrows = false;
jest.mock("@/lib/shared", () => {
	const actual = jest.requireActual("@/lib/shared");
	return {
		...actual,
		blockLayout: (...args: unknown[]) => {
			if (mockLayoutThrows) throw new Error("dagre failed");
			return actual.blockLayout(...args);
		},
	};
});
afterEach(() => {
	mockLayoutThrows = false;
});

const tree = (nodes: [string, string][], edges: [string, string][]): PlanTree => ({
	version: 1,
	nodes: nodes.map(([id, title]) => ({ id, title })) as PlanTree["nodes"],
	edges: edges.map(([from, to]) => ({ from, to })) as PlanTree["edges"],
});

const TIDES = tree(
	[
		["gravity", "Gravity and distance"],
		["pull", "Uneven pull"],
		["turn", "Earth turns"],
		["bulges", "Two bulges"],
		["tides", "Two tides a day"],
	],
	[
		["gravity", "pull"],
		["gravity", "turn"],
		["pull", "bulges"],
		["bulges", "tides"],
		["turn", "tides"],
	],
);

const STATUSES = new Map<string, StepStatus>([
	["gravity", "done"],
	["pull", "done"],
	["bulges", "current"],
	["turn", "upcoming"],
	["tides", "upcoming"],
]);

function graph(t: PlanTree, pad?: number): PlanGraphData {
	const data = planGraph(t, pad);
	if (!data) throw new Error("no graph");
	return data;
}

/** Sends a layout event with this width to the view with this test id. */
async function layout(testID: string, width: number) {
	await fireEvent(screen.getByTestId(testID), "layout", {
		nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
	});
}

describe("planGraph", () => {
	it("gives one box for each step and one path for each edge", async () => {
		const data = graph(TIDES);
		expect(data.boxes.map((b) => b.id).sort()).toEqual(
			["bulges", "gravity", "pull", "tides", "turn"].sort(),
		);
		expect(data.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(
			["bulges->tides", "gravity->pull", "gravity->turn", "pull->bulges", "turn->tides"].sort(),
		);
		for (const e of data.edges) expect(e.d).toMatch(/^M/);
		// Top to bottom: a prerequisite is above the step that needs it.
		const y = new Map(data.boxes.map((b) => [b.id, b.y]));
		expect(y.get("gravity")!).toBeLessThan(y.get("pull")!);
		expect(y.get("bulges")!).toBeLessThan(y.get("tides")!);
	});

	it("wraps a long title and puts one baseline on each line", async () => {
		const data = graph(tree([["a", "How the Moon and the Sun pull together at spring tide"]], []));
		const box = data.boxes[0]!;
		expect(box.lines.length).toBeGreaterThan(1);
		expect(box.baselines).toHaveLength(box.lines.length);
		expect(box.baselines[1]! - box.baselines[0]!).toBe(LINE_H);
	});

	it("pads the view: more for the sheet, where the glow must fit", async () => {
		const block = graph(TIDES, GRAPH_PAD);
		const sheet = graph(TIDES, GLOW_REACH);
		expect(sheet.view.w - block.view.w).toBe(2 * (GLOW_REACH - GRAPH_PAD));
		expect(block.view.x).toBe(-GRAPH_PAD);
	});

	describe("error state 14", () => {
		it("draws no edge to a step that is not in the plan", async () => {
			const data = graph(tree([["a", "One"]], [["a", "ghost"]]));
			expect(data.boxes).toHaveLength(1);
			expect(data.edges).toHaveLength(0);
		});

		it("draws each step of a cycle one time", async () => {
			const data = graph(
				tree(
					[
						["a", "One"],
						["b", "Two"],
					],
					[
						["a", "b"],
						["b", "a"],
					],
				),
			);
			expect(data.boxes.map((b) => b.id).sort()).toEqual(["a", "b"]);
			expect(data.edges.length).toBeLessThanOrEqual(2);
		});

		it("keeps the first of a repeated step id, and drops self and repeated edges", async () => {
			const data = graph(
				tree(
					[
						["a", "First"],
						["a", "Second"],
						["b", "Two"],
					],
					[
						["a", "a"],
						["a", "b"],
						["a", "b"],
					],
				),
			);
			expect(data.boxes.map((b) => b.lines.join(" "))).toEqual(["First", "Two"]);
			expect(data.edges).toHaveLength(1);
		});

		it("gives null for a plan with no steps", async () => {
			expect(planGraph(tree([], []))).toBeNull();
		});

		it("gives null when the layout throws", async () => {
			mockLayoutThrows = true;
			{
				expect(planGraph(TIDES)).toBeNull();
			}
		});
	});
});

describe("graphScale", () => {
	it("fits the width, but never above the desktop text cap", async () => {
		expect(graphScale(100, 1000)).toBe(MAX_SCALE);
		expect(graphScale(300, 330)).toBeCloseTo(1.1);
	});

	it("never goes under the minimum text size: a wide graph scrolls sideways", async () => {
		expect(graphScale(2000, 343)).toBe(MIN_SCALE);
		expect(2000 * MIN_SCALE).toBeGreaterThan(343);
	});

	it("uses 1 before the width is known", async () => {
		expect(graphScale(300, 0)).toBe(1);
		expect(graphScale(Number.NaN, 300)).toBe(1);
	});
});

describe("PlanGraph", () => {
	it("draws the one-color block: no glow, every arrow strong", async () => {
		await render(<PlanGraph data={graph(TIDES)} scale={1} />);
		expect(screen.queryByTestId("plan-glow")).toBeNull();
		const strokes = new Set(
			graph(TIDES).edges.map((e) =>
				JSON.stringify(screen.getByTestId(`plan-edge-${e.from}-${e.to}`).props.stroke),
			),
		);
		expect(strokes.size).toBe(1);
		expect(screen.getByTestId("plan-node-gravity")).toBeTruthy();
	});

	it("draws the statuses: a glow on the current step, gray arrows at upcoming steps", async () => {
		const data = graph(TIDES, GLOW_REACH);
		await render(
			<PlanGraph
				data={data}
				scale={1}
				statusOf={(id) => graphStatus(STATUSES.get(id) ?? "upcoming")}
			/>,
		);
		expect(screen.getAllByTestId("plan-glow")).toHaveLength(1);
		const stroke = (from: string, to: string) =>
			JSON.stringify(screen.getByTestId(`plan-edge-${from}-${to}`).props.stroke);
		// Both ends visited or current: strong. One end upcoming: gray.
		expect(stroke("gravity", "pull")).toBe(stroke("pull", "bulges"));
		expect(stroke("gravity", "turn")).not.toBe(stroke("gravity", "pull"));
		expect(stroke("bulges", "tides")).toBe(stroke("gravity", "turn"));
	});

	it("draws again with the dark colors when the mode changes (error state 16)", async () => {
		const scheme = jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("light");
		// The box of a step: its first child is the Rect with the fill.
		const boxFill = () =>
			JSON.stringify(
				(
					screen.getByTestId("plan-node-gravity").props.children as { props: { fill: unknown } }[]
				)[0]?.props.fill,
			);
		await render(<PlanGraph data={graph(TIDES)} scale={1} />);
		const light = boxFill();
		scheme.mockReturnValue("dark");
		await render(<PlanGraph data={graph(TIDES)} scale={1} />);
		expect(boxFill()).not.toBe(light);
		scheme.mockRestore();
	});

	it("draws no glow when no step is current", async () => {
		await render(<PlanGraph data={graph(TIDES)} scale={1} statusOf={() => "visited"} />);
		expect(screen.queryByTestId("plan-glow")).toBeNull();
	});
});

describe("PlanBlock (the transcript row)", () => {
	it("draws the graph and opens the plan on a tap", async () => {
		const onOpen = jest.fn();
		await render(
			<PlanBlock
				id="p1"
				tree={TIDES}
				label="Lesson plan, 5 steps. Open the plan."
				onOpen={onOpen}
				fallback={<Text>card</Text>}
			/>,
		);
		await layout("plan-block-p1", 343);
		expect(screen.getByLabelText("Lesson plan, 5 steps. Open the plan.")).toBeTruthy();
		expect(screen.getByTestId("plan-node-tides")).toBeTruthy();
		expect(screen.queryByText("card")).toBeNull();
		await fireEvent.press(screen.getByTestId("plan-p1"));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("shows the text card when the layout fails (error state 14)", async () => {
		mockLayoutThrows = true;
		{
			await render(
				<PlanBlock
					id="p1"
					tree={TIDES}
					label="x"
					onOpen={jest.fn()}
					fallback={<Text>card</Text>}
				/>,
			);
			expect(screen.getByText("card")).toBeTruthy();
			expect(screen.queryByTestId("plan-block-p1")).toBeNull();
		}
	});

	it("keeps a wide graph at the minimum text size, wider than the screen", async () => {
		const wide = tree(
			[
				["root", "Start"],
				...Array.from({ length: 10 }, (_, i): [string, string] => [`s${i}`, `Step ${i + 1}`]),
			],
			Array.from({ length: 10 }, (_, i): [string, string] => ["root", `s${i}`]),
		);
		await render(<PlanBlock id="w" tree={wide} label="x" onOpen={jest.fn()} fallback={null} />);
		await layout("plan-block-w", 343);
		const data = graph(wide);
		expect(data.view.w * MIN_SCALE).toBeGreaterThan(343);
		const svg = screen.getByTestId("plan-svg-w");
		expect(Number(svg.props.width ?? svg.props.bbWidth)).toBeCloseTo(data.view.w * MIN_SCALE);
	});
});

describe("PlanSheet with the graph", () => {
	const steps: PlanStep[] = [
		{ id: "gravity", title: "Gravity and distance", depth: 0, status: "done" },
		{ id: "pull", title: "Uneven pull", depth: 1, status: "done" },
		{ id: "turn", title: "Earth turns", depth: 1, status: "upcoming" },
		{ id: "bulges", title: "Two bulges", depth: 2, status: "current" },
		{ id: "tides", title: "Two tides a day", depth: 3, status: "upcoming" },
	];

	it("shows the graph with the statuses above the list, with pinch zoom", async () => {
		await render(<PlanSheet visible steps={steps} tree={TIDES} onClose={jest.fn()} />);
		expect(screen.getByTestId("plan-graph")).toBeTruthy();
		// The frame shows the whole graph at the start (the fit).
		await layout("plan-graph", 343);
		const data = graph(TIDES, GLOW_REACH);
		const svg = screen.getByTestId("plan-graph-svg");
		// react-native-svg passes the viewBox as minX, minY, vbWidth and vbHeight.
		const { minX: x, minY: y, vbWidth: w } = svg.props as Record<string, number>;
		expect(w).toBeGreaterThanOrEqual(data.view.w - 0.01);
		expect(x).toBeLessThanOrEqual(data.view.x + 0.01);
		expect(y).toBeCloseTo(data.view.y);
		expect(screen.getByText("Pinch to zoom. Drag to move.")).toBeTruthy();
		expect(screen.getAllByTestId("plan-glow")).toHaveLength(1);
		expect(screen.getByTestId("plan-step-status-bulges")).toHaveTextContent("Now");
		expect(
			screen.getByLabelText("Plan diagram, 5 steps. The list below has each step and its status."),
		).toBeTruthy();
	});

	it("shows only the list when the layout fails (error state 14)", async () => {
		mockLayoutThrows = true;
		{
			await render(<PlanSheet visible steps={steps} tree={TIDES} onClose={jest.fn()} />);
			expect(screen.queryByTestId("plan-graph")).toBeNull();
			expect(screen.getByTestId("plan-step-status-bulges")).toHaveTextContent("Now");
		}
	});

	it("PlanSheetGraph treats a step with no status as upcoming", async () => {
		await render(
			<GestureHandlerRootView>
				<PlanSheetGraph tree={TIDES} statuses={new Map()} />
			</GestureHandlerRootView>,
		);
		expect(screen.queryByTestId("plan-glow")).toBeNull();
	});
});

describe("pinch zoom and drag (the desktop popup rules, as a viewBox window)", () => {
	const view = { x: 0, y: 0, w: 400, h: 200 };
	const frame = { w: 200, h: 100 };
	const base = 0.5; // the fit: 400 units in 200 points

	it("starts at the fit: the window is the whole graph", () => {
		const vp = fitViewport(view, frame, base);
		expect(vp.zoom).toBe(1);
		expect(viewWindow(frame, base, vp)).toEqual({ x: 0, y: 0, w: 400, h: 200 });
		expect(canPan(view, frame, base, vp)).toBe(false);
	});

	it("centers a graph that is smaller than the frame", () => {
		const vp = fitViewport({ x: 0, y: 0, w: 100, h: 200 }, frame, base);
		expect(vp.x).toBe(-150);
	});

	it("zooms around the point between the fingers", () => {
		const vp = pinchViewport(view, frame, base, fitViewport(view, frame, base), 2, {
			x: 100,
			y: 50,
		});
		expect(vp.zoom).toBe(2);
		// The graph point under the focus (200, 100) stays under it.
		const w = viewWindow(frame, base, vp);
		expect(w.x + 100 / (base * vp.zoom)).toBeCloseTo(200);
		expect(w.y + 50 / (base * vp.zoom)).toBeCloseTo(100);
		expect(canPan(view, frame, base, vp)).toBe(true);
	});

	it("stays between the fit and the largest zoom", () => {
		const start = fitViewport(view, frame, base);
		expect(pinchViewport(view, frame, base, start, 0.2, { x: 0, y: 0 }).zoom).toBe(1);
		expect(pinchViewport(view, frame, base, start, 100, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
		expect(pinchViewport(view, frame, base, start, Number.NaN, { x: 0, y: 0 })).toEqual(start);
	});

	it("drags with the finger, and stops at the edges of the graph", () => {
		const zoomed = pinchViewport(view, frame, base, fitViewport(view, frame, base), 2, {
			x: 0,
			y: 0,
		});
		const moved = panViewport(view, frame, base, zoomed, -50, 0);
		expect(moved.x).toBeCloseTo(zoomed.x + 50);
		const far = panViewport(view, frame, base, zoomed, -10000, -10000);
		const w = viewWindow(frame, base, far);
		expect(w.x + w.w).toBeCloseTo(400);
		expect(w.y + w.h).toBeCloseTo(200);
		const back = panViewport(view, frame, base, far, 10000, 10000);
		expect(back.x).toBe(0);
		expect(back.y).toBe(0);
	});

	it("lets a wide graph at the minimum text size be dragged at the fit", () => {
		const wide = { x: 0, y: 0, w: 1000, h: 100 };
		const vp = fitViewport(wide, { w: 343, h: 91 }, MIN_SCALE);
		expect(canPan(wide, { w: 343, h: 91 }, MIN_SCALE, vp)).toBe(true);
	});
});
