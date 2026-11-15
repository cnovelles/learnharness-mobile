/**
 * The plan graph (issue 05 slice E, user decisions 2026-11-15), drawn with
 * react-native-svg from the shared desktop layout (src/lib/plan-graph.ts).
 *
 * - `PlanGraph` draws one graph. With no `statusOf` it is the one-color
 *   transcript block, as on the desktop. With `statusOf` it uses the
 *   desktop status colors: visited and current in the strong line ink, the
 *   current step with a faint yellow glow, upcoming in gray (also each
 *   arrow that touches an upcoming step).
 * - `PlanBlock` is the transcript row: the graph at full width, a tap opens
 *   the Plan sheet. A wide graph scrolls sideways. When the layout fails it
 *   shows the text card (error state 14).
 * - `PlanSheetGraph` is the graph at the top of the Plan sheet, with pinch
 *   zoom and drag. The SVG keeps the size of its frame and shows a window
 *   of the graph (its viewBox), so the text stays sharp at each zoom.
 */
import { useId, useLayoutEffect, useMemo, useState } from "react";
import { GestureDetector, usePanGesture, usePinchGesture } from "react-native-gesture-handler";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
	useColorScheme,
	type LayoutChangeEvent,
} from "react-native";
import Svg, {
	Defs,
	FeGaussianBlur,
	Filter,
	G,
	Marker,
	Path,
	Rect,
	Text as SvgText,
} from "react-native-svg";

import type { StepStatus } from "@/lib/plan";
import {
	NODE_FONT,
	canPan,
	fitViewport,
	graphScale,
	graphStatus,
	panViewport,
	pinchViewport,
	planGraph,
	viewWindow,
	type GraphStatus,
	type GraphViewport,
	type PlanGraphData,
} from "@/lib/plan-graph";
import {
	ARROW_HEAD,
	GLOW_BLUR,
	GLOW_MARGIN,
	GLOW_REACH,
	GRAPH_PAD,
	HEAD_H,
	HEAD_W,
	STROKE_W,
	type PlanTree,
} from "@/lib/shared";
import { SPACE } from "./spacing";
import { FONT, TYPE, usePalette, type Palette } from "./ui";

/** The faint yellow of the current step (desktop `fill-yellow-400/25`). */
const GLOW_COLOR = "#facc15";
const GLOW_OPACITY = 0.25;

interface Colors {
	strong: string;
	dim: string;
	text: string;
	muted: string;
	boxFill: string;
	visitedFill: string;
}

/** The desktop's color roles in the phone palette. */
function graphColors(c: Palette): Colors {
	return {
		// The desktop's line-strong is the foreground ink in both modes.
		strong: c.text,
		dim: c.line,
		text: c.text,
		muted: c.muted,
		boxFill: c.panel,
		visitedFill: c.bg,
	};
}

/** An SVG id from React's `useId` (which has colons). */
function svgId(raw: string): string {
	return `pg${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
}

export function PlanGraph({
	data,
	scale,
	statusOf,
	frame,
	testID,
}: {
	data: PlanGraphData;
	scale: number;
	/** The step statuses (the Plan sheet). None: the one-color block. */
	statusOf?: (id: string) => GraphStatus;
	/** A fixed frame that shows one window of the graph (pinch zoom and
	 *  drag). None: the whole graph at `scale`. */
	frame?: { w: number; h: number; window: { x: number; y: number; w: number; h: number } };
	testID?: string;
}) {
	const colors = graphColors(usePalette());
	const scheme = useColorScheme() ?? "light";
	const id = svgId(useId());
	const { view } = data;
	const mono = !statusOf;
	const status = (stepId: string): GraphStatus => statusOf?.(stepId) ?? "visited";
	const glowId = mono ? null : (data.boxes.find((b) => status(b.id) === "current")?.id ?? null);
	return (
		<Svg
			// react-native-svg keeps the old fill of a Rect and a Text in a G
			// when only the color changes: a new mode or a new status draws a
			// new SVG (error state 16).
			key={`${scheme}:${mono ? "" : data.boxes.map((b) => status(b.id)).join(",")}`}
			width={frame ? frame.w : view.w * scale}
			height={frame ? frame.h : view.h * scale}
			viewBox={
				frame
					? `${frame.window.x} ${frame.window.y} ${frame.window.w} ${frame.window.h}`
					: `${view.x} ${view.y} ${view.w} ${view.h}`
			}
			testID={testID}
		>
			<Defs>
				{(["strong", "dim"] as const).map((tone) => (
					<Marker
						key={tone}
						id={`${id}-${tone}`}
						viewBox="0 0 50.2 104"
						refX={27.2}
						refY={52}
						markerWidth={HEAD_W}
						markerHeight={HEAD_H}
						markerUnits="userSpaceOnUse"
						orient="auto"
					>
						<Path d={ARROW_HEAD} fill={colors[tone]} />
					</Marker>
				))}
				<Filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
					<FeGaussianBlur stdDeviation={GLOW_BLUR} />
				</Filter>
			</Defs>
			{data.edges.map((e) => {
				const dim = !mono && (status(e.from) === "upcoming" || status(e.to) === "upcoming");
				return (
					<Path
						key={`${e.from}->${e.to}`}
						d={e.d}
						fill="none"
						stroke={dim ? colors.dim : colors.strong}
						strokeWidth={STROKE_W}
						markerEnd={`url(#${id}-${dim ? "dim" : "strong"})`}
						testID={`plan-edge-${e.from}-${e.to}`}
					/>
				);
			})}
			{data.boxes.map((b) => {
				const s = status(b.id);
				const upcoming = !mono && s === "upcoming";
				return (
					<G key={b.id} x={b.x} y={b.y} testID={`plan-node-${b.id}`}>
						<Rect
							width={b.w}
							height={b.h}
							fill={mono || upcoming ? colors.boxFill : colors.visitedFill}
							stroke={upcoming ? colors.dim : colors.strong}
							strokeWidth={STROKE_W}
						/>
						{b.id === glowId ? (
							<Rect
								x={-GLOW_MARGIN}
								y={-GLOW_MARGIN}
								width={b.w + 2 * GLOW_MARGIN}
								height={b.h + 2 * GLOW_MARGIN}
								fill={GLOW_COLOR}
								fillOpacity={GLOW_OPACITY}
								filter={`url(#${id}-glow)`}
								testID="plan-glow"
							/>
						) : null}
						{b.lines.map((line, i) => (
							<SvgText
								key={i}
								x={b.w / 2}
								y={b.baselines[i]}
								textAnchor="middle"
								fontSize={NODE_FONT}
								fontWeight={!mono && s === "current" ? "600" : "400"}
								fill={upcoming ? colors.muted : colors.text}
							>
								{line}
							</SvgText>
						))}
					</G>
				);
			})}
		</Svg>
	);
}

/** The width of a view, from its layout. */
function useWidth(): [number, (e: LayoutChangeEvent) => void] {
	const [width, setWidth] = useState(0);
	return [
		width,
		(e) => {
			const w = e.nativeEvent.layout.width;
			if (Number.isFinite(w) && w > 0 && Math.abs(w - width) >= 1) setWidth(w);
		},
	];
}

/** The transcript row for a plan: the one-color graph, or the text card. */
export function PlanBlock({
	id,
	tree,
	label,
	onOpen,
	fallback,
}: {
	id: string;
	tree: PlanTree;
	/** The VoiceOver label ("Lesson plan, 2 steps. Open the plan."). */
	label: string;
	onOpen: () => void;
	/** The text card, for a layout that fails. */
	fallback: React.ReactNode;
}) {
	const data = useMemo(() => planGraph(tree, GRAPH_PAD), [tree]);
	const [width, onLayout] = useWidth();
	if (!data) return <>{fallback}</>;
	// Hidden until the width is known, so the graph does not jump.
	const scale = graphScale(data.view.w, width);
	return (
		<View onLayout={onLayout} style={{ opacity: width > 0 ? 1 : 0 }} testID={`plan-block-${id}`}>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.center}
			>
				{/* The press target sits inside the scroll view, so a sideways
				    drag still scrolls (issue 05 slice B). */}
				<Pressable
					onPress={onOpen}
					accessibilityRole="button"
					accessibilityLabel={label}
					testID={`plan-${id}`}
				>
					<PlanGraph data={data} scale={scale} testID={`plan-svg-${id}`} />
				</Pressable>
			</ScrollView>
		</View>
	);
}

/** The tallest Plan sheet graph frame, in points. A taller graph is
 *  dragged up and down inside it. */
const MAX_FRAME_H = 400;

interface GestureState {
	view: { x: number; y: number; w: number; h: number };
	frame: { w: number; h: number };
	base: number;
	current: GraphViewport | null;
}

type Point = { x: number; y: number };

/**
 * The pinch and drag of the Plan sheet graph, for react-native-gesture-handler
 * (native recognizers: a JS PanResponder loses its touches to the sheet's
 * scroll view). The callbacks run on the JS thread and read the latest render
 * through `sync` (called in a layout effect). `onActive` tells the sheet to
 * stop its own scroll while a pinch or drag runs.
 */
function createGraphGesture(
	setVp: (vp: GraphViewport) => void,
	onActive: (active: boolean) => void,
) {
	let live: GestureState | null = null;
	let pinchStart: { vp: GraphViewport; focus: Point | null } | null = null;
	let panStart: GraphViewport | null = null;
	return {
		sync: (state: GestureState | null) => {
			live = state;
		},
		pinchBegin: () => {
			if (!live?.current) return;
			pinchStart = { vp: live.current, focus: null };
			onActive(true);
		},
		pinchUpdate: (e: { scale: number; focalX: number; focalY: number }) => {
			if (!live || !pinchStart) return;
			const to = { x: e.focalX, y: e.focalY };
			// The first update gives the point where the fingers started.
			pinchStart.focus ??= to;
			setVp(
				pinchViewport(
					live.view,
					live.frame,
					live.base,
					pinchStart.vp,
					e.scale,
					pinchStart.focus,
					to,
				),
			);
		},
		pinchEnd: () => {
			pinchStart = null;
			onActive(false);
		},
		panBegin: () => {
			if (!live?.current) return;
			panStart = live.current;
			onActive(true);
		},
		panUpdate: (e: { translationX: number; translationY: number }) => {
			// A pinch moves the graph itself.
			if (!live || !panStart || pinchStart) return;
			setVp(
				panViewport(live.view, live.frame, live.base, panStart, e.translationX, e.translationY),
			);
		},
		panEnd: () => {
			panStart = null;
			onActive(false);
		},
	};
}

/** The graph at the top of the Plan sheet, with the step statuses, pinch
 *  zoom and drag (user decision 2026-11-15). */
export function PlanSheetGraph({
	tree,
	statuses,
	onActive,
}: {
	tree: PlanTree;
	statuses: ReadonlyMap<string, StepStatus>;
	/** True while a pinch or drag runs (the sheet stops its scroll). */
	onActive?: (active: boolean) => void;
}) {
	const c = usePalette();
	const data = useMemo(() => planGraph(tree, GLOW_REACH), [tree]);
	const [width, onLayout] = useWidth();
	const [vp, setVp] = useState<GraphViewport | null>(null);
	const [g] = useState(() => createGraphGesture(setVp, (active) => onActive?.(active)));

	const base = data ? graphScale(data.view.w, width) : 1;
	const frame = data
		? { w: width, h: Math.min(MAX_FRAME_H, Math.ceil(data.view.h * base)) }
		: { w: 0, h: 0 };
	const current = data && width > 0 ? (vp ?? fitViewport(data.view, frame, base)) : null;
	useLayoutEffect(() => {
		g.sync(data ? { view: data.view, frame, base, current } : null);
	});
	const pannable = !!(data && current && canPan(data.view, frame, base, current));
	// One finger drags only when there is something to move; else the
	// sheet's list scrolls.
	const pan = usePanGesture({
		runOnJS: true,
		disableReanimated: true,
		enabled: pannable,
		maxPointers: 1,
		onBegin: g.panBegin,
		onUpdate: g.panUpdate,
		onFinalize: g.panEnd,
	});
	// Two detectors with a relation (not a composed gesture, which needs
	// Reanimated's event composition).
	const pinch = usePinchGesture({
		runOnJS: true,
		disableReanimated: true,
		simultaneousWith: pan,
		onBegin: g.pinchBegin,
		onUpdate: g.pinchUpdate,
		onFinalize: g.pinchEnd,
	});

	// Error state 14: no graph, the list still shows.
	if (!data) return null;
	const statusOf = (id: string): GraphStatus => graphStatus(statuses.get(id) ?? "upcoming");
	return (
		<View
			onLayout={onLayout}
			style={[
				styles.sheetGraph,
				{ borderColor: c.line, backgroundColor: c.panel, opacity: width > 0 ? 1 : 0 },
			]}
			testID="plan-graph"
		>
			<GestureDetector gesture={pan}>
				<View>
					<GestureDetector gesture={pinch}>
						<View
							style={[styles.frame, { height: frame.h }]}
							accessible
							accessibilityLabel={`Plan diagram, ${data.boxes.length} steps. The list below has each step and its status.`}
							testID="plan-graph-frame"
						>
							{current ? (
								<PlanGraph
									data={data}
									scale={base}
									statusOf={statusOf}
									frame={{ ...frame, window: viewWindow(frame, base, current) }}
									testID="plan-graph-svg"
								/>
							) : null}
						</View>
					</GestureDetector>
				</View>
			</GestureDetector>
			<Text style={[styles.hint, { color: c.muted }]}>Pinch to zoom. Drag to move.</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	center: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
	/** The desktop plan viewport: rounded-xl border. */
	sheetGraph: {
		borderWidth: 1,
		borderRadius: 16,
		paddingBottom: SPACE.sm,
		gap: SPACE.xs,
		overflow: "hidden",
	},
	frame: { overflow: "hidden" },
	hint: { ...TYPE.xs, fontFamily: FONT.ui, textAlign: "center" },
});
