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
	nodeLabelOpacity,
	panCamera,
	pickNode,
	pinchCamera,
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

	it("long region labels wrap at the desktop width and line cap", () => {
		const m = model();
		m.regions[0]!.label = "a very long session title that does not fit in one region label line";
		const lines = buildScene(m, null, measure).anchors[0]!.lines!;
		expect(lines.length).toBeLessThanOrEqual(3);
		for (const line of lines) expect(measure.region(line)).toBeLessThanOrEqual(220);
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
			splat: null,
			pickable: [],
		});
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
