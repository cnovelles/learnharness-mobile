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

/**
 * The scale of the transcript plan block: always fit the width (issue 05,
 * wide content, decision 3), never larger than `MAX_SCALE`. Small text is
 * read in the full-screen viewer.
 */
export function fitScale(width: number, available: number): number {
	if (!(width > 0) || !(available > 0)) return 1;
	return Math.min(MAX_SCALE, available / width);
}

// ─── Pinch zoom and drag ─────────────────────────────────────────────────────
// The math moved to src/lib/zoom-viewport.ts (the full-screen viewer uses it
// too). These names stay here for the Plan sheet.
export {
	MAX_ZOOM,
	canPan,
	clampViewport,
	fitViewport,
	panViewport,
	pinchViewport,
	viewWindow,
	type GraphViewport,
} from "./zoom-viewport";
