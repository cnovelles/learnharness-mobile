/**
 * The Graph tab canvas scene and camera (issue 08 slice C, D-016). Pure code
 * with no Skia import, so Jest tests it. `src/components/graph-canvas.tsx`
 * draws the scene with Skia.
 *
 * - The draw numbers are the desktop's: the fork's default render settings
 *   (`DEFAULT_RENDER_SETTINGS`, checked by tests/knowledge-golden.test.ts)
 *   and the shared draw helpers in fork `src/core/graph-canvas-geometry.ts`
 *   (edge glyphs, label wrap, region anchors and the region splat).
 * - The camera is the desktop transform: screen = world × k + (x, y). Fit
 *   zoom has a 40 px padding, and k stays in the desktop zoom limits.
 * - The functions with a `"worklet"` line run on the UI thread during a pan
 *   or a pinch. They call only other worklets (a fork function is not a
 *   worklet), so `nodeLabelOpacity` repeats the desktop `labelAlpha` rule;
 *   a test checks that both give the same values.
 */
import {
	FIT_PADDING,
	LABEL_GAP,
	LABEL_LINE_HEIGHT,
	LABELS_FADE_RATIO,
	PICKING_PAD,
	REGION_LABEL_MAX_LINES,
	REGION_LABEL_MAX_WIDTH,
	ZOOM_EXTENT,
	edgeGlyphs,
	fitTransform,
	isImpNodeId,
	labelWrapWidth,
	pickNearest,
	regionAnchors,
	regionSplat,
	wrapLabel,
	wrapRegionLabel,
	type EdgeGlyphs,
	type RegionAnchor,
	type RegionSplat,
} from "./shared";
import type { CanvasModel } from "./knowledge";

/**
 * The fork's default render settings (`DEFAULT_RENDER_SETTINGS`, the
 * fields that a reader draws with). Sizes are world units, except
 * `clusterLabelSize` (screen points). The phone has no settings panel.
 */
export const CANVAS_SETTINGS = {
	nodeSize: 2,
	edgeWidth: 1,
	arrowLength: 2,
	labelZoom: 0.5,
	labelSize: 3,
	clusterLabels: true,
	clusterLabelSize: 14,
	regions: { dilation: 20, blur: 40, bitmap: 256, edgeAlpha: 0.2, enabled: true },
} as const;

export type CanvasSettings = typeof CANVAS_SETTINGS;

/** The text measure of the label fonts: the width of a string. */
export interface SceneMeasure {
	/** The node label font, at `labelSize` world units. */
	label: (text: string) => number;
	/** The region label font, at `clusterLabelSize` points. */
	region: (text: string) => number;
}

export interface SceneLabel {
	id: string;
	x: number;
	/** The top of the first line, world units (the desktop `textBaseline: top`). */
	top: number;
	lines: string[];
}

export interface SceneAnchor extends RegionAnchor {
	/** The wrapped label; null for an unlabeled region (no label draws). */
	lines: string[] | null;
}

export interface Scene {
	/** The node discs: x, y for each visible proposition. */
	discs: number[];
	glyphs: EdgeGlyphs;
	labels: SceneLabel[];
	anchors: SceneAnchor[];
	/** The region bitmap plan; null with no visible region or regions off. */
	splat: RegionSplat | null;
	/** The nodes that a tap can pick (visible propositions). */
	pickable: { id: string; x: number; y: number }[];
}

/**
 * The scene of one geometry build (the desktop `buildGeometry` and
 * `buildRegions`). `visible` is the search result (null: all nodes).
 * Implication nodes have no disc, no label and no tap.
 */
export function buildScene(
	model: CanvasModel,
	visible: ReadonlySet<string> | null,
	measure: SceneMeasure,
	settings: CanvasSettings = CANVAS_SETTINGS,
): Scene {
	const isVisible = (id: string) => !visible || visible.has(id);
	const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
	const nodeR = settings.nodeSize;
	const discs: number[] = [];
	const labels: SceneLabel[] = [];
	const pickable: Scene["pickable"] = [];
	const wrapWidth = labelWrapWidth(settings.labelSize);
	for (const n of model.nodes) {
		if (!isVisible(n.id) || isImpNodeId(n.id)) continue;
		discs.push(n.x, n.y);
		pickable.push({ id: n.id, x: n.x, y: n.y });
		labels.push({
			id: n.id,
			x: n.x,
			top: n.y + nodeR + LABEL_GAP,
			lines: wrapLabel(n.label, wrapWidth, measure.label),
		});
	}
	const glyphs = edgeGlyphs(model.edges, nodeById, isVisible, nodeR, settings.arrowLength);
	const anchors = regionAnchors(model.regions, nodeById, isVisible).map((a) => ({
		...a,
		lines: a.label
			? wrapRegionLabel(a.label, REGION_LABEL_MAX_WIDTH, REGION_LABEL_MAX_LINES, measure.region)
			: null,
	}));
	const splat =
		settings.regions.enabled && anchors.length > 0
			? regionSplat(model.regions, model.edges, nodeById, isVisible, settings.regions)
			: null;
	return { discs, glyphs, labels, anchors, splat, pickable };
}

/** The distance between two label lines, world units. */
export function labelLineHeight(settings: CanvasSettings = CANVAS_SETTINGS): number {
	return settings.labelSize * LABEL_LINE_HEIGHT;
}

// ─── The camera ─────────────────────────────────────────────────────────────

/** The desktop camera transform: screen = world × k + (x, y). */
export interface Camera {
	x: number;
	y: number;
	k: number;
}

/** Keep a scale in the desktop zoom limits. */
export function clampScale(k: number): number {
	"worklet";
	return Math.min(Math.max(k, ZOOM_EXTENT[0]), ZOOM_EXTENT[1]);
}

/** The fit camera: all nodes in a w × h view with the desktop padding. */
export function fitCamera(bounds: CanvasModel["bounds"], w: number, h: number): Camera {
	if (!bounds || w <= 0 || h <= 0) return { x: w / 2, y: h / 2, k: 1 };
	const t = fitTransform(bounds, w, h, FIT_PADDING);
	const k = clampScale(t.k);
	// A clamped scale keeps the box center in the view center.
	const cx = (bounds.minX + bounds.maxX) / 2;
	const cy = (bounds.minY + bounds.maxY) / 2;
	return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
}

/** Move the camera with one finger. */
export function panCamera(cam: Camera, dx: number, dy: number): Camera {
	"worklet";
	return { x: cam.x + dx, y: cam.y + dy, k: cam.k };
}

/**
 * One pinch step: scale by `scaleChange` about the fingers' center. The
 * world point under the old center goes to the new center, so the graph
 * follows two fingers that move as well as spread.
 */
export function pinchCamera(
	cam: Camera,
	scaleChange: number,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
): Camera {
	"worklet";
	const k = clampScale(cam.k * scaleChange);
	const wx = (fromX - cam.x) / cam.k;
	const wy = (fromY - cam.y) / cam.k;
	return { x: toX - wx * k, y: toY - wy * k, k };
}

/**
 * The node label opacity at a camera scale (the desktop `labelAlpha` on
 * `zoomRatioOf(kFit, k)`): 1 when zoomed in past the gate, then a fade to
 * 0. The region labels use 1 minus this. `gate` is `labelZoom`; it is an
 * argument because a worklet does not capture a default value.
 */
export function nodeLabelOpacity(kFit: number, k: number, gate: number): number {
	"worklet";
	const ratio = kFit / k;
	const v = 1 - (ratio - gate) / (gate * LABELS_FADE_RATIO);
	return Math.min(Math.max(v, 0), 1);
}

/** The node under a tap at screen point (px, py), or null (the desktop `pickAt`). */
export function pickNode(
	scene: Pick<Scene, "pickable">,
	cam: Camera,
	px: number,
	py: number,
	settings: CanvasSettings = CANVAS_SETTINGS,
): string | null {
	const projected = scene.pickable.map((n) => ({
		id: n.id,
		x: n.x * cam.k + cam.x,
		y: n.y * cam.k + cam.y,
	}));
	const hit = pickNearest(projected, px, py, settings.nodeSize * cam.k + PICKING_PAD);
	return hit ? hit.id : null;
}

// ─── Colors ─────────────────────────────────────────────────────────────────

/**
 * A CSS `hsla(h, s%, l%, a)` color as RGBA in 0..1 (a Skia color). The
 * desktop paints the regions and their labels with hsla strings.
 */
export function hslaColor(
	h: number,
	s: number,
	l: number,
	a: number,
): [number, number, number, number] {
	const sat = s / 100;
	const light = l / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const m = sat * Math.min(light, 1 - light);
	const f = (n: number) => light - m * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
	return [f(0), f(8), f(4), a];
}

/** The region fill (desktop `hsla(hue, 65%, ring%, 1)`). */
export function regionFill(hue: number, ring: number) {
	return hslaColor(hue, 65, ring, 1);
}

/** The region label color (desktop `hsla(hue, 55%, label%, 0.85)`). */
export function regionLabelColor(hue: number, label: number) {
	return hslaColor(hue, 55, label, 0.85);
}
