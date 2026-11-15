/**
 * The plan graph geometry (issue 05 slice E). The placement is the
 * desktop's: the shared `blockLayout` (dagre), `wrapTitle` and `edgePathD`
 * from the fork's components/plan-layout.ts. This file only turns those
 * numbers into boxes, text lines and edge paths for react-native-svg, and
 * picks the scale for the phone width.
 *
 * Error state 14: a layout that throws gives null (the caller shows the
 * list or the text card), an edge to a missing step is not drawn, and a
 * cycle draws each step one time.
 */
import type { StepStatus } from "./plan";
import {
	GRAPH_PAD,
	LINE_H,
	NODE_H,
	NODE_W_MIN,
	TEXT_CAP_SCALE,
	blockLayout,
	edgePathD,
	wrapTitle,
	type PlanTree,
} from "./shared";

/** The node title size in graph units. The shared width estimate is fitted
 *  to this size (fork plan-layout.ts, `estimateLineWidth`). */
export const NODE_FONT = 11;
/** The smallest node text on the phone, in points. A graph that must go
 *  smaller to fit scrolls sideways instead (user decision 2026-11-15). */
export const MIN_NODE_TEXT = 10;
/** The scale range: never larger than the desktop's cap (the reading text
 *  size), never smaller than the minimum text size. */
export const MAX_SCALE = TEXT_CAP_SCALE;
export const MIN_SCALE = MIN_NODE_TEXT / NODE_FONT;

export interface GraphBox {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	lines: string[];
	/** The baseline of each line, from the top of the box. */
	baselines: number[];
}

export interface GraphEdge {
	from: string;
	to: string;
	d: string;
}

export interface PlanGraphData {
	boxes: GraphBox[];
	edges: GraphEdge[];
	/** The visible area in graph units, with the padding. */
	view: { x: number; y: number; w: number; h: number };
}

/** The status of a step in the graph. The transcript block has none. */
export type GraphStatus = "visited" | "current" | "upcoming";

export function graphStatus(status: StepStatus): GraphStatus {
	return status === "done" ? "visited" : status;
}

/**
 * The boxes and edge paths of a plan, or null when the layout throws.
 * `pad` keeps the outer strokes inside the view (`GRAPH_PAD`), or also
 * the glow of the current step (`GLOW_REACH`, the Plan sheet).
 */
export function planGraph(tree: PlanTree, pad: number = GRAPH_PAD): PlanGraphData | null {
	// One box for each step id: a repeated id keeps its first title.
	const seen = new Set<string>();
	const nodes = tree.nodes.filter((n) => !seen.has(n.id) && seen.add(n.id));
	if (nodes.length === 0) return null;
	const edgeKeys = new Set<string>();
	const edges = tree.edges.filter((e) => {
		const key = `${e.from}->${e.to}`;
		if (e.from === e.to || edgeKeys.has(key)) return false;
		edgeKeys.add(key);
		return true;
	});
	let layout: ReturnType<typeof blockLayout>;
	try {
		layout = blockLayout(nodes, edges);
	} catch {
		return null;
	}
	const boxes: GraphBox[] = nodes.map((n) => {
		const lines = wrapTitle(n.title);
		const h = layout.nodeH.get(n.id) ?? NODE_H;
		// The desktop's text position (plan-block.tsx): centered lines.
		const y0 = (h - lines.length * LINE_H) / 2 + 10;
		return {
			id: n.id,
			x: layout.x.get(n.id) ?? 0,
			y: layout.y.get(n.id) ?? 0,
			w: layout.nodeW.get(n.id) ?? NODE_W_MIN,
			h,
			lines,
			baselines: lines.map((_, i) => y0 + i * LINE_H),
		};
	});
	const byId = new Map(boxes.map((b) => [b.id, b] as const));
	const paths: GraphEdge[] = [];
	for (const e of edges) {
		// An edge to a missing step has no route: it is not drawn.
		const pts = layout.edgePts.get(`${e.from}->${e.to}`);
		const target = byId.get(e.to);
		if (!pts || !target || !byId.has(e.from)) continue;
		paths.push({
			from: e.from,
			to: e.to,
			d: edgePathD(pts, { x: target.x, y: target.y, w: target.w, h: target.h }),
		});
	}
	const values = [layout.width, layout.height];
	if (!values.every((v) => Number.isFinite(v) && v > 0)) return null;
	const ox = (layout as { originX?: number }).originX ?? 0;
	const oy = (layout as { originY?: number }).originY ?? 0;
	return {
		boxes,
		edges: paths,
		view: { x: ox - pad, y: oy - pad, w: layout.width + 2 * pad, h: layout.height + 2 * pad },
	};
}

/**
 * The scale for a graph `width` units wide in `available` points: fit the
 * width, but stay between `MIN_SCALE` and `MAX_SCALE`. Under `MIN_SCALE`
 * the graph is wider than the space: the transcript block scrolls
 * sideways, and the Plan sheet graph can be dragged.
 */
export function graphScale(width: number, available: number): number {
	if (!(width > 0) || !(available > 0)) return 1;
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, available / width));
}

// ─── Pinch zoom and drag in the Plan sheet ───────────────────────────────────
//
// The rules are the desktop popup's (fork components/pan-zoom.ts): fully
// zoomed out is the fit, a drag stops at the edges, and a pinch zooms
// around the point between the fingers. The phone does not scale a picture:
// the SVG keeps the size of its frame and shows a window of the graph (its
// viewBox), so the text stays sharp at each zoom.

/** The largest zoom (the desktop's ZOOM_MAX). */
export const MAX_ZOOM = 4;

/** The zoom (1 is the fit) and the top-left corner of the window, in
 *  graph units. */
export interface GraphViewport {
	zoom: number;
	x: number;
	y: number;
}

type Box = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };

/** The window of the graph that a frame shows at this zoom. */
export function viewWindow(frame: Size, base: number, vp: GraphViewport): Box {
	const k = base * vp.zoom;
	return { x: vp.x, y: vp.y, w: frame.w / k, h: frame.h / k };
}

/** One axis: center the window when it is larger than the graph, else
 *  keep it inside the graph. */
function clampAxis(start: number, size: number, origin: number, extent: number): number {
	if (size >= extent) return origin - (size - extent) / 2;
	return Math.min(Math.max(start, origin), origin + extent - size);
}

/** The viewport with the zoom in range and the window inside the graph. */
export function clampViewport(
	view: Box,
	frame: Size,
	base: number,
	vp: GraphViewport,
): GraphViewport {
	const zoom = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(vp.zoom) ? vp.zoom : 1));
	const w = viewWindow(frame, base, { ...vp, zoom });
	return {
		zoom,
		x: clampAxis(Number.isFinite(vp.x) ? vp.x : view.x, w.w, view.x, view.w),
		y: clampAxis(Number.isFinite(vp.y) ? vp.y : view.y, w.h, view.y, view.h),
	};
}

/** The start: the fit, at the top left of the graph (centered if it fits). */
export function fitViewport(view: Box, frame: Size, base: number): GraphViewport {
	return clampViewport(view, frame, base, { zoom: 1, x: view.x, y: view.y });
}

/** A drag of `dx`, `dy` points: the graph moves with the finger. */
export function panViewport(
	view: Box,
	frame: Size,
	base: number,
	vp: GraphViewport,
	dx: number,
	dy: number,
): GraphViewport {
	const k = base * vp.zoom;
	return clampViewport(view, frame, base, { ...vp, x: vp.x - dx / k, y: vp.y - dy / k });
}

/** A pinch by `factor` that starts at `focus` and ends at `to` (points in
 *  the frame; the fingers can also move): the graph point that was under
 *  `focus` is now under `to`. */
export function pinchViewport(
	view: Box,
	frame: Size,
	base: number,
	vp: GraphViewport,
	factor: number,
	focus: { x: number; y: number },
	to: { x: number; y: number } = focus,
): GraphViewport {
	if (!(factor > 0) || !Number.isFinite(factor)) return vp;
	const zoom = Math.min(MAX_ZOOM, Math.max(1, vp.zoom * factor));
	const k0 = base * vp.zoom;
	const k1 = base * zoom;
	const px = vp.x + focus.x / k0;
	const py = vp.y + focus.y / k0;
	return clampViewport(view, frame, base, { zoom, x: px - to.x / k1, y: py - to.y / k1 });
}

/** True when a one-finger drag can move the graph: it is zoomed in, or it
 *  is larger than the frame at the fit. */
export function canPan(view: Box, frame: Size, base: number, vp: GraphViewport): boolean {
	const w = viewWindow(frame, base, vp);
	return w.w < view.w - 0.5 || w.h < view.h - 0.5;
}
