/**
 * Pinch zoom, drag and double-tap in a frame (issue 05): the Plan sheet graph
 * and the full-screen viewer (wide content, slice C). Pure, so Jest can test it.
 *
 * Units: the content has a box `view` in its own units, and `base` points
 * for each unit at zoom 1 (the fit). A viewport is the zoom and the top-left
 * corner of the window, in content units.
 */
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

export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

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

/** The zoom of a double-tap from the fit. */
export const DOUBLE_TAP_ZOOM = 2.5;

/** A double-tap at `at` (a point in the frame): from the fit, zoom in to
 *  `DOUBLE_TAP_ZOOM` around that point; when zoomed in, back to the fit. */
export function doubleTapViewport(
	view: Box,
	frame: Size,
	base: number,
	vp: GraphViewport,
	at: { x: number; y: number },
): GraphViewport {
	if (vp.zoom > 1.01) return fitViewport(view, frame, base);
	return pinchViewport(view, frame, base, vp, DOUBLE_TAP_ZOOM / vp.zoom, at);
}
