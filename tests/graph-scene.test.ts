/**
 * Issue 08 slice C: the canvas scene and camera (src/lib/graph-scene.ts).
 */
import type { CanvasModel } from "@/lib/knowledge";
import {
	CANVAS_SETTINGS,
	buildScene,
	clampScale,
	fitCamera,
	hslaColor,
	labelLineHeight,
	labelShow,
	nodeLabelOpacity,
	panCamera,
	pickNode,
	pinchCamera,
	pinchStep,
	PHONE_REGION_LABEL,
	regionLabelBoxes,
	placeRegionLabels,
	PINCH_QUIET_MS,
	tapAllowed,
	regionFill,
	regionLabelColor,
} from "@/lib/graph-scene";
import { LABEL_GAP, PICKING_PAD, ZOOM_EXTENT, labelAlpha, zoomRatioOf } from "@/lib/shared";

const measure = { label: (s: string) => s.length * 1.5, region: (s: string) => s.length * 7 };

function model(): CanvasModel {
	return {
		nodes: [
			{ id: "a", x: 0, y: 0, label: "Alpha", implication: false },
			{ id: "b", x: 100, y: 0, label: "Beta", implication: false },
			{ id: "c", x: 50, y: 80, label: "Gamma", implication: false },
			{ id: "arg_1", x: 50, y: 40, label: "", implication: true },
		],
		edges: [
			{ from: "a", to: "arg_1", head: false },
			{ from: "b", to: "arg_1", head: false },
			{ from: "arg_1", to: "c", head: true },
		],
		regions: [
			{ id: "r1", label: "Plato", hue: 10, members: ["a", "b"] },
			{ id: "r2", label: null, hue: 20, members: ["c"] },
		],
		bounds: { minX: 0, maxX: 100, minY: 0, maxY: 80 },
	};
}

describe("buildScene", () => {
	it("draws discs, labels and taps for propositions only", () => {
		const scene = buildScene(model(), null, measure);
		expect(scene.discs).toEqual([0, 0, 100, 0, 50, 80]);
		expect(scene.pickable.map((n) => n.id)).toEqual(["a", "b", "c"]);
		expect(scene.labels.map((l) => [l.id, l.lines])).toEqual([
			["a", ["Alpha"]],
			["b", ["Beta"]],
			["c", ["Gamma"]],
		]);
		expect(scene.labels[0]!.top).toBe(CANVAS_SETTINGS.nodeSize + LABEL_GAP);
	});

	it("lines into the implication node are headless, the line out of it has a head", () => {
		const scene = buildScene(model(), null, measure);
		expect(scene.glyphs.shafts).toHaveLength(12);
		expect(scene.glyphs.heads).toHaveLength(6);
		// The headless shafts end at the implication node's center.
		expect(scene.glyphs.shafts.slice(2, 4)).toEqual([50, 40]);
	});

	it("regions: one anchor per region with a visible member; unlabeled regions draw no label", () => {
		const scene = buildScene(model(), null, measure);
		expect(scene.anchors.map((a) => [a.id, a.cx, a.cy, a.lines])).toEqual([
			["r1", 50, 0, ["Plato"]],
			["r2", 50, 80, null],
		]);
		expect(scene.splat?.layers).toHaveLength(2);
	});

	it("long region labels wrap at the phone width (140 pt) and the desktop line cap", () => {
		const m = model();
		m.regions[0]!.label = "a very long session title that does not fit in one region label line";
		const anchor = buildScene(m, null, measure).anchors[0]!;
		const lines = anchor.lines!;
		expect(lines.length).toBeLessThanOrEqual(PHONE_REGION_LABEL.maxLines);
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(measure.region(line)).toBeLessThanOrEqual(140);
		// The box: the widest line, and one line height (11 pt x 1.3) for each line.
		expect(anchor.w).toBe(Math.max(...lines.map(measure.region)));
		expect(anchor.h).toBeCloseTo(lines.length * 11 * 1.3);
	});

	it("the label order puts the larger region first and skips unlabeled regions", () => {
		const scene = buildScene(model(), null, measure);
		expect(scene.anchors.map((a) => a.weight)).toEqual([2, 1]);
		expect(scene.labelOrder).toEqual([0]);
	});

	it("search: hidden nodes have no disc, label, tap, edge or region", () => {
		const scene = buildScene(model(), new Set(["a", "b"]), measure);
		expect(scene.discs).toEqual([0, 0, 100, 0]);
		expect(scene.glyphs.shafts).toEqual([]);
		expect(scene.anchors.map((a) => a.id)).toEqual(["r1"]);
		const none = buildScene(model(), new Set(), measure);
		expect(none.discs).toEqual([]);
		expect(none.splat).toBeNull();
	});

	it("an empty model gives an empty scene", () => {
		const scene = buildScene({ nodes: [], edges: [], regions: [], bounds: null }, null, measure);
		expect(scene).toEqual({
			discs: [],
			glyphs: { shafts: [], heads: [] },
			labels: [],
			anchors: [],
			labelOrder: [],
			splat: null,
			pickable: [],
		});
	});

	it("region labels: a label that overlaps a larger region's label is hidden", () => {
		// Three boxes (cx, cy, w, h) in world units; w and h are screen points.
		const boxes = [0, 0, 60, 14, 20, 0, 60, 14, 200, 0, 60, 14];
		const order = [0, 1, 2];
		const shown = (o: number[], k: number) =>
			placeRegionLabels(boxes, o, { x: 0, y: 0, k }, 0, 0).shown;
		// At k = 1, box 1 is 20 pt from box 0 and overlaps it; box 2 is clear.
		expect(shown(order, 1)).toEqual([true, false, true]);
		// Zoomed in 4x, box 1 is 80 pt away: all show.
		expect(shown(order, 4)).toEqual([true, true, true]);
		// The order decides which of two labels stays.
		expect(shown([1, 0, 2], 1)).toEqual([false, true, true]);
		// A label not in the order (no text) never shows.
		expect(shown([0], 1)).toEqual([true, false, false]);
	});

	it("region labels keep the clearance between two shown boxes", () => {
		const w = 60;
		const clear = w + PHONE_REGION_LABEL.clearance;
		const shown = (x: number) =>
			placeRegionLabels([0, 0, w, 10, x, 0, w, 10], [0, 1], { x: 0, y: 0, k: 1 }, 0, 0).shown;
		expect(shown(clear - 0.1)).toEqual([true, false]);
		expect(shown(clear)).toEqual([true, true]);
	});

	it("a label near the canvas edge moves inside it (the cut label on the SE)", () => {
		// A 140 pt label at screen x = 320 in a 343 pt canvas: its right end
		// would be at 390. It moves left to end 8 pt from the edge.
		const p = placeRegionLabels([320, 100, 140, 14], [0], { x: 0, y: 0, k: 1 }, 343, 400);
		expect(p.shown).toEqual([true]);
		expect(320 + p.dx[0]! + 70).toBe(343 - PHONE_REGION_LABEL.inset);
		expect(p.dy[0]).toBe(0);
		// The camera counts: the same world point, moved 100 pt left, needs no move.
		expect(
			placeRegionLabels([320, 100, 140, 14], [0], { x: -100, y: 0, k: 1 }, 343, 400).dx,
		).toEqual([0]);
	});

	it("a label of a region outside the canvas does not move into it", () => {
		const p = placeRegionLabels([500, 100, 140, 14], [0], { x: 0, y: 0, k: 1 }, 343, 400);
		expect(p.dx).toEqual([0]);
	});

	it("a label wider than the canvas is centered in it", () => {
		const p = placeRegionLabels([50, 100, 400, 14], [0], { x: 0, y: 0, k: 1 }, 343, 400);
		expect(50 + p.dx[0]!).toBe(343 / 2);
	});

	it("the overlap rule uses the moved boxes", () => {
		// Box 0 sits at the right edge; box 1 is 160 pt to its left. Box 0
		// moves left onto box 1, so box 1 is hidden.
		const boxes = [330, 100, 140, 14, 170, 100, 60, 14];
		expect(placeRegionLabels(boxes, [0, 1], { x: 0, y: 0, k: 1 }, 343, 400).shown).toEqual([
			true,
			false,
		]);
		expect(placeRegionLabels(boxes, [0, 1], { x: 0, y: 0, k: 1 }, 0, 0).shown).toEqual([
			true,
			true,
		]);
	});

	it("the label boxes come from the scene anchors", () => {
		const scene = buildScene(model(), null, measure);
		expect(regionLabelBoxes(scene.anchors)).toEqual([
			50,
			0,
			measure.region("Plato"),
			11 * 1.3,
			50,
			80,
			0,
			0,
		]);
	});

	it("the label line height is the desktop one", () => {
		expect(labelLineHeight()).toBeCloseTo(3 * 1.3);
	});
});

describe("the camera", () => {
	it("fit centers the box with the desktop padding", () => {
		const cam = fitCamera({ minX: 0, maxX: 100, minY: 0, maxY: 80 }, 375, 600);
		expect(cam.k).toBeCloseTo((375 - 80) / 100);
		expect(cam.x + 50 * cam.k).toBeCloseTo(375 / 2);
		expect(cam.y + 40 * cam.k).toBeCloseTo(300);
	});

	it("fit of one node (state 17: one node at the origin) stays in the zoom limits", () => {
		const cam = fitCamera({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 375, 600);
		expect(cam).toEqual({ x: 187.5, y: 300, k: ZOOM_EXTENT[1] });
	});

	it("fit with no node or no size is the identity at the center", () => {
		expect(fitCamera(null, 375, 600)).toEqual({ x: 187.5, y: 300, k: 1 });
		expect(fitCamera({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, 0, 0)).toEqual({ x: 0, y: 0, k: 1 });
	});

	it("pan moves the camera; the scale stays", () => {
		expect(panCamera({ x: 1, y: 2, k: 3 }, 10, -5)).toEqual({ x: 11, y: -3, k: 3 });
	});

	it("pinch keeps the world point under the fingers", () => {
		const cam = { x: 10, y: 20, k: 2 };
		const next = pinchCamera(cam, 1.5, 100, 100, 100, 100);
		expect(next.k).toBe(3);
		// World (45, 40) was under (100, 100) and stays there.
		expect(45 * next.k + next.x).toBeCloseTo(100);
		expect(40 * next.k + next.y).toBeCloseTo(100);
	});

	it("pinch follows fingers that move", () => {
		const next = pinchCamera({ x: 0, y: 0, k: 1 }, 1, 50, 50, 70, 40);
		expect(next).toEqual({ x: 20, y: -10, k: 1 });
	});

	it("pinch stops at the desktop zoom limits", () => {
		expect(pinchCamera({ x: 0, y: 0, k: 39 }, 2, 0, 0, 0, 0).k).toBe(40);
		expect(pinchCamera({ x: 0, y: 0, k: 0.03 }, 0.1, 0, 0, 0, 0).k).toBe(0.02);
		expect(clampScale(5)).toBe(5);
	});

	it("a pinch step scales about the fingers' center", () => {
		const cam = { x: 10, y: 20, k: 2 };
		const step = pinchStep(cam, { x: 100, y: 100, pointers: 2 }, 1.5, 100, 100, 2);
		expect(step.cam).toEqual(pinchCamera(cam, 1.5, 100, 100, 100, 100));
		expect(step.focus).toEqual({ x: 100, y: 100, pointers: 2 });
	});

	it("the first pinch step only sets the center", () => {
		const cam = { x: 10, y: 20, k: 2 };
		const step = pinchStep(cam, null, 1.2, 80, 90, 2);
		expect(step.cam).toBe(cam);
		expect(step.focus).toEqual({ x: 80, y: 90, pointers: 2 });
	});

	it("a lifted finger does not move the graph (the jump to the side)", () => {
		const cam = { x: 10, y: 20, k: 2 };
		// Two fingers at 100 and 300: center 200. One lifts: the center jumps to 300.
		const lift = pinchStep(cam, { x: 200, y: 150, pointers: 2 }, 1, 300, 150, 1);
		expect(lift.cam).toBe(cam);
		expect(lift.focus).toEqual({ x: 300, y: 150, pointers: 1 });
		// One finger that moves does not pan or zoom in the pinch.
		expect(pinchStep(cam, lift.focus, 1.1, 320, 160, 1).cam).toBe(cam);
	});

	it("a finger that touches again starts the center again", () => {
		const cam = { x: 10, y: 20, k: 2 };
		const back = pinchStep(cam, { x: 300, y: 150, pointers: 1 }, 1, 200, 150, 2);
		expect(back.cam).toBe(cam);
		const next = pinchStep(cam, back.focus, 1, 210, 150, 2);
		expect(next.cam).toEqual({ x: 20, y: 20, k: 2 });
	});

	it("a tap during or just after a pinch does not count (a fit by the pinch fingers)", () => {
		expect(tapAllowed(false, -Infinity, 1000)).toBe(true);
		expect(tapAllowed(true, -Infinity, 1000)).toBe(false);
		expect(tapAllowed(false, 1000, 1000 + PINCH_QUIET_MS - 1)).toBe(false);
		expect(tapAllowed(false, 1000, 1000 + PINCH_QUIET_MS)).toBe(true);
	});

	it("the label opacity is the desktop labelAlpha rule", () => {
		const kFit = 2;
		for (const k of [0.5, 1, 2, 3, 3.5, 4, 5, 6, 8, 20]) {
			expect(nodeLabelOpacity(kFit, k, CANVAS_SETTINGS.labelZoom)).toBeCloseTo(
				labelAlpha(zoomRatioOf(kFit, k), CANVAS_SETTINGS.labelZoom),
				10,
			);
		}
		// At fit zoom only the region labels show; zoomed in 2x, only the node labels.
		expect(nodeLabelOpacity(kFit, kFit, CANVAS_SETTINGS.labelZoom)).toBe(0);
		expect(nodeLabelOpacity(kFit, kFit * 2, CANVAS_SETTINGS.labelZoom)).toBe(1);
	});

	it("the node labels draw only while they show, with a layer only while they fade", () => {
		const kFit = 2;
		const at = (k: number) => labelShow(nodeLabelOpacity(kFit, k, CANVAS_SETTINGS.labelZoom));
		expect(at(kFit)).toBe("off");
		expect(at(kFit * 2)).toBe("on");
		const fading = [3, 3.25, 3.5, 3.75].map(at);
		expect(fading).toContain("fade");
		expect(labelShow(0)).toBe("off");
		expect(labelShow(0.4)).toBe("fade");
		expect(labelShow(1)).toBe("on");
	});

	it("a tap picks the nearest proposition within the disc and the pad", () => {
		const scene = buildScene(model(), null, measure);
		const cam = { x: 10, y: 10, k: 2 };
		expect(pickNode(scene, cam, 10 + 100 * 2 + 5, 10, CANVAS_SETTINGS)).toBe("b");
		// The implication node at (50, 40) is never picked.
		expect(pickNode(scene, cam, 10 + 50 * 2, 10 + 40 * 2)).toBeNull();
		const far = CANVAS_SETTINGS.nodeSize * cam.k + PICKING_PAD + 1;
		expect(pickNode(scene, cam, 10 + far, 10)).toBeNull();
	});

	it("a node hidden by search cannot be picked", () => {
		const scene = buildScene(model(), new Set(["b"]), measure);
		expect(pickNode(scene, { x: 0, y: 0, k: 1 }, 0, 0)).toBeNull();
	});
});

describe("the region colors", () => {
	it("convert CSS hsla to RGBA", () => {
		expect(hslaColor(0, 100, 50, 1)).toEqual([1, 0, 0, 1]);
		expect(hslaColor(120, 100, 25, 0.5)).toEqual([0, 0.5, 0, 0.5]);
		const [r, g, b] = hslaColor(240, 50, 50, 1);
		expect([r, g, b].map((v) => Math.round(v * 255))).toEqual([64, 64, 191]);
	});
	it("use the desktop saturation, lightness and alpha", () => {
		expect(regionFill(200, 60)).toEqual(hslaColor(200, 65, 60, 1));
		expect(regionLabelColor(200, 78)).toEqual(hslaColor(200, 55, 78, 0.85));
	});
});
