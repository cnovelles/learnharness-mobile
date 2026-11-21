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
	REGION_LABEL_LINE_HEIGHT,
	REGION_LABEL_MAX_LINES,
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

/**
 * The region labels on the phone (user choice 2026-11-21, option D): a
 * smaller size and wrap width than the desktop (14 pt, 220 pt), because at
 * fit zoom on a 375 pt screen the desktop labels overlap. A label stays
 * inside the canvas, and a label that overlaps a label of a larger region
 * is hidden (`placeRegionLabels`).
 */
export const PHONE_REGION_LABEL = {
	/** Screen points. */
	size: 11,
	/** The wrap width, screen points. */
	maxWidth: 140,
	maxLines: REGION_LABEL_MAX_LINES,
	/** The space between two shown labels, screen points. */
	clearance: 4,
	/** The space between a label and the canvas edge, screen points. */
	inset: 8,
} as const;

/** Where the region labels draw: shown or hidden, and a move in screen points. */
export interface RegionLabelPlacement {
	shown: boolean[];
	dx: number[];
	dy: number[];
}

/** The text measure of the label fonts: the width of a string. */
export interface SceneMeasure {
	/** The node label font, at `labelSize` world units. */
	label: (text: string) => number;
	/** The region label font, at `PHONE_REGION_LABEL.size` points. */
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
	/** The label box on screen, points (0 with no label). */
	w: number;
	h: number;
	/** The number of visible members: a larger region keeps its label first. */
	weight: number;
}

export interface Scene {
	/** The node discs: x, y for each visible proposition. */
	discs: number[];
	glyphs: EdgeGlyphs;
	labels: SceneLabel[];
	anchors: SceneAnchor[];
	/** The anchor indexes with a label, largest region first (ties: anchor order). */
	labelOrder: number[];
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
	const weights = new Map(
		model.regions.map((r) => [r.id, r.members.filter((id) => isVisible(id)).length]),
	);
	const lineH = PHONE_REGION_LABEL.size * REGION_LABEL_LINE_HEIGHT;
	const anchors: SceneAnchor[] = regionAnchors(model.regions, nodeById, isVisible).map((a) => {
		const lines = a.label
			? wrapRegionLabel(
					a.label,
					PHONE_REGION_LABEL.maxWidth,
					PHONE_REGION_LABEL.maxLines,
					measure.region,
				)
			: null;
		return {
			...a,
			lines,
			w: lines ? Math.max(...lines.map((l) => measure.region(l))) : 0,
			h: lines ? lines.length * lineH : 0,
			weight: weights.get(a.id) ?? 0,
		};
	});
	const labelOrder = anchors
		.map((a, i) => i)
		.filter((i) => anchors[i]!.lines)
		.sort((i, j) => anchors[j]!.weight - anchors[i]!.weight || i - j);
	const splat =
		settings.regions.enabled && anchors.length > 0
			? regionSplat(model.regions, model.edges, nodeById, isVisible, settings.regions)
			: null;
	return { discs, glyphs, labels, anchors, labelOrder, splat, pickable };
}

/** The label boxes of a scene for `placeRegionLabels`: cx, cy, w, h for each anchor. */
export function regionLabelBoxes(anchors: readonly SceneAnchor[]): number[] {
	return anchors.flatMap((a) => [a.cx, a.cy, a.w, a.h]);
}

/** Move a box center c (half size half) into [inset, size - inset]; centered when too big. */
function clampCenter(c: number, half: number, size: number, inset: number): number {
	"worklet";
	if (2 * (half + inset) >= size) return size / 2;
	return Math.min(Math.max(c, inset + half), size - inset - half);
}

/**
 * Where the region labels draw for the camera and a w × h canvas (points).
 * Each box (centered on its region, a constant size on screen) whose region
 * center is in the canvas moves inside the canvas edge. Then, in `order`
 * (largest region first), a label shows when its box does not overlap a box
 * that already shows. With no size (0), boxes do not move. Runs on the UI
 * thread on each frame; a graph has tens of regions.
 */
export function placeRegionLabels(
	boxes: readonly number[],
	order: readonly number[],
	cam: Camera,
	w: number,
	h: number,
): RegionLabelPlacement {
	"worklet";
	const n = boxes.length / 4;
	const shown: boolean[] = new Array(n).fill(false);
	const dx: number[] = new Array(n).fill(0);
	const dy: number[] = new Array(n).fill(0);
	const placed: number[] = [];
	const gap = PHONE_REGION_LABEL.clearance;
	const inset = PHONE_REGION_LABEL.inset;
	for (const i of order) {
		const hw = boxes[4 * i + 2]! / 2;
		const hh = boxes[4 * i + 3]! / 2;
		const sx = boxes[4 * i]! * cam.k + cam.x;
		const sy = boxes[4 * i + 1]! * cam.k + cam.y;
		const inside = w > 0 && h > 0 && sx >= 0 && sx <= w && sy >= 0 && sy <= h;
		const x = inside ? clampCenter(sx, hw, w, inset) : sx;
		const y = inside ? clampCenter(sy, hh, h, inset) : sy;
		let free = true;
		for (let p = 0; p < placed.length; p += 4) {
			if (
				Math.abs(x - placed[p]!) < hw + placed[p + 2]! + gap &&
				Math.abs(y - placed[p + 1]!) < hh + placed[p + 3]! + gap
			) {
				free = false;
				break;
			}
		}
		if (!free) continue;
		shown[i] = true;
		dx[i] = x - sx;
		dy[i] = y - sy;
		placed.push(x, y, hw, hh);
	}
	return { shown, dx, dy };
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

/** The fingers' center of the last pinch step, and the number of fingers. */
export interface PinchFocus {
	x: number;
	y: number;
	pointers: number;
}

/**
 * One pinch event: the next camera and the next focus. When the number of
 * fingers changes (a finger lifts or touches), the center jumps to the
 * other fingers: the step then keeps the camera and starts again from the
 * new center, so the graph does not jump. With fewer than 2 fingers the
 * camera stays.
 */
export function pinchStep(
	cam: Camera,
	focus: PinchFocus | null,
	scaleChange: number,
	x: number,
	y: number,
	pointers: number,
): { cam: Camera; focus: PinchFocus } {
	"worklet";
	const next = { x, y, pointers };
	if (!focus || focus.pointers !== pointers || pointers < 2) return { cam, focus: next };
	return { cam: pinchCamera(cam, scaleChange, focus.x, focus.y, x, y), focus: next };
}

/**
 * The quiet time after a pinch step, ms. The fingers of a pinch touch and
 * lift too, and two of them can look like a double tap (a fit) or a tap
 * (a node sheet).
 */
export const PINCH_QUIET_MS = 400;

/** The longest distance between the two taps of a double tap, points. */
export const DOUBLE_TAP_MAX_DISTANCE = 30;

/** A tap counts only when no pinch runs and the last pinch step is old enough. */
export function tapAllowed(pinching: boolean, pinchAt: number, now: number): boolean {
	"worklet";
	return !pinching && now - pinchAt >= PINCH_QUIET_MS;
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

/**
 * How a label layer draws at an opacity: not at all, through a fade layer,
 * or plain. Skia draws a picture with no paint, so a group opacity does not
 * reach a picture: the canvas uses a layer paint only while the labels fade.
 */
export type LabelShow = "off" | "fade" | "on";

export function labelShow(alpha: number): LabelShow {
	"worklet";
	return alpha <= 0 ? "off" : alpha >= 1 ? "on" : "fade";
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
