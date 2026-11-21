/**
 * The full-screen viewer for wide content (issue 05, wide content, decision
 * 4): the expand button on a block, the viewer shell, and the native zoom
 * pane (code, tables and the plan graph). Mermaid and math use a WebView
 * pane with WebKit's own zoom (src/components/islands.tsx).
 *
 * The native pane draws its content again at each new zoom, so the text stays
 * sharp. While a pinch or a drag runs, a transform shows the change; when the
 * gesture ends, the content draws at the new size (slice C).
 *
 * Error states (docs/ISSUES.md, issue 05, "Wide content"): W7 (the screen
 * turns: back to the fit), W9 (the viewer keeps the content it opened with:
 * the caller passes a snapshot).
 */
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import {
	GestureDetector,
	GestureHandlerRootView,
	usePanGesture,
	usePinchGesture,
	useTapGesture,
} from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import {
	canPan,
	DOUBLE_TAP_MAX_DELAY_MS,
	doubleTapViewport,
	fitViewport,
	panViewport,
	pinchViewport,
	type Box,
	type GraphViewport,
	type Size,
} from "@/lib/zoom-viewport";
import { useViewerOrientation } from "./viewer-orientation";
import { FONT, Icon, TYPE, usePalette } from "./ui";
import { SPACE } from "./spacing";

/** The expand button: top right of a wide block. */
export function ExpandButton({
	onPress,
	what,
	testID = `md-expand-${what}`,
}: {
	onPress: () => void;
	/** "code", "table", "diagram", "formula" or "plan", for VoiceOver. */
	what: string;
	testID?: string;
}) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={`Open the ${what} full screen`}
			hitSlop={SPACE.sm}
			testID={testID}
			style={({ pressed }) => [
				styles.expand,
				{ backgroundColor: pressed ? c.hover : c.panel, borderColor: c.line },
			]}
		>
			<Icon name="arrow.up.left.and.arrow.down.right" size={13} color={c.muted} />
		</Pressable>
	);
}

/** Room at the end of a block's first line for the expand button. */
export const EXPAND_INSET = 28 + SPACE.xs;

function HeaderButton({
	onPress,
	label,
	testID,
	children,
}: {
	onPress: () => void;
	label: string;
	testID: string;
	children: ReactNode;
}) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={label}
			hitSlop={SPACE.sm}
			testID={testID}
			style={({ pressed }) => [
				styles.headerButton,
				{ backgroundColor: pressed ? c.hover : c.panel, borderColor: c.line },
			]}
		>
			{children}
		</Pressable>
	);
}

/**
 * The viewer shell: a full-screen modal with Close, the block kind, Fit and
 * Copy. `children` gets `fitKey`: a new value asks the pane to go back to the
 * fit. The screen can turn to landscape while the viewer is open (slice E).
 */
export function ZoomViewer({
	visible,
	kind,
	onClose,
	onCopy,
	children,
}: {
	visible: boolean;
	/** The block kind, shown in the header ("CODE", "TABLE", "MERMAID", …). */
	kind: string;
	onClose: () => void;
	onCopy?: () => void;
	children: (fitKey: number) => ReactNode;
}) {
	const c = usePalette();
	const [fitKey, setFitKey] = useState(0);
	useViewerOrientation(visible);
	return (
		<Modal
			visible={visible}
			animationType="fade"
			presentationStyle="fullScreen"
			supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
			onRequestClose={onClose}
		>
			{/* A modal is its own native root: the gestures need this. */}
			<GestureHandlerRootView style={styles.fill}>
				<SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} testID="zoom-viewer">
					<View style={styles.header}>
						<HeaderButton onPress={onClose} label="Close" testID="zoom-close">
							<Icon name="xmark" size={14} color={c.text} />
						</HeaderButton>
						<Text
							style={[styles.kind, { color: c.muted }]}
							accessibilityRole="header"
							testID="zoom-kind"
						>
							{kind}
						</Text>
						<View style={styles.headerEnd}>
							<HeaderButton
								onPress={() => setFitKey((k) => k + 1)}
								label="Fit to the screen"
								testID="zoom-fit"
							>
								<Text style={[styles.fitText, { color: c.text }]}>FIT</Text>
							</HeaderButton>
							{onCopy ? (
								<HeaderButton onPress={onCopy} label="Copy" testID="zoom-copy">
									<Icon name="doc.on.doc" size={14} color={c.text} />
								</HeaderButton>
							) : null}
						</View>
					</View>
					<View style={styles.fill}>{children(fitKey)}</View>
				</SafeAreaView>
			</GestureHandlerRootView>
		</Modal>
	);
}

type Point = { x: number; y: number };

type Live = { view: Box; frame: Size; base: number; current: GraphViewport | null };

/**
 * The pinch, drag and double-tap of a native pane. The callbacks run on the
 * JS thread and read the latest render through `sync`. `setLive` shows the
 * gesture; `commit` keeps the result (the content draws again at its size).
 */
function createZoomGesture(
	setLive: (vp: GraphViewport | null) => void,
	commit: (vp: GraphViewport) => void,
) {
	let state: Live | null = null;
	let pinchStart: { vp: GraphViewport; focus: Point | null } | null = null;
	let panStart: GraphViewport | null = null;
	let last: GraphViewport | null = null;
	const show = (vp: GraphViewport) => {
		last = vp;
		setLive(vp);
	};
	const end = () => {
		if (pinchStart || panStart) return;
		if (last) commit(last);
		last = null;
		setLive(null);
	};
	return {
		sync: (next: Live) => {
			state = next;
		},
		pinchBegin: () => {
			if (!state?.current) return;
			pinchStart = { vp: last ?? state.current, focus: null };
		},
		pinchUpdate: (e: { scale: number; focalX: number; focalY: number }) => {
			if (!state || !pinchStart) return;
			const to = { x: e.focalX, y: e.focalY };
			// The first update gives the point where the fingers started.
			pinchStart.focus ??= to;
			show(
				pinchViewport(
					state.view,
					state.frame,
					state.base,
					pinchStart.vp,
					e.scale,
					pinchStart.focus,
					to,
				),
			);
		},
		pinchEnd: () => {
			pinchStart = null;
			end();
		},
		panBegin: () => {
			if (!state?.current) return;
			panStart = last ?? state.current;
		},
		panUpdate: (e: { translationX: number; translationY: number }) => {
			// A pinch moves the content itself.
			if (!state || !panStart || pinchStart) return;
			show(
				panViewport(state.view, state.frame, state.base, panStart, e.translationX, e.translationY),
			);
		},
		panEnd: () => {
			panStart = null;
			end();
		},
		doubleTap: (e: { x: number; y: number }) => {
			if (!state?.current) return;
			commit(doubleTapViewport(state.view, state.frame, state.base, state.current, e));
		},
	};
}

/**
 * A native pane with pinch zoom, drag and double-tap. `render(scale,
 * screenWidth)` draws the content at `scale` points for each content unit
 * (1 is its natural size); `screenWidth` is the frame width at the fit, in
 * content units. The content is `contentWidth` units wide (at least the
 * frame width with `fillWidth`); its height is `contentHeight`, or measured.
 */
export function NativeZoomPane({
	contentWidth,
	contentHeight,
	maxBase = 1,
	minBase = 0,
	fillWidth = false,
	fitHeight = false,
	fitKey,
	render,
	label,
	testID = "zoom-pane",
}: {
	contentWidth: number;
	contentHeight?: number;
	/** The largest scale at the fit (a narrow block does not grow past it). */
	maxBase?: number;
	/** The smallest scale at the fit: a wider block goes past the edge, and
	 *  a drag moves it (code: 11 pt text). */
	minBase?: number;
	/** At the fit, the content is at least as wide as the frame (it does not
	 *  center). */
	fillWidth?: boolean;
	/** Fit the height too (a chart shows whole at the fit). */
	fitHeight?: boolean;
	/** A new value goes back to the fit (the Fit button). */
	fitKey: number;
	render: (scale: number, screenWidth: number) => ReactNode;
	/** The VoiceOver label of the pane. */
	label: string;
	testID?: string;
}) {
	const [frame, setFrame] = useState<Size>({ w: 0, h: 0 });
	const [measuredH, setMeasuredH] = useState<number | null>(null);
	const [vp, setVp] = useState<GraphViewport | null>(null);
	const [live, setLive] = useState<GraphViewport | null>(null);
	const [g] = useState(() => createZoomGesture(setLive, setVp));

	// W7 and the Fit button: back to the fit.
	const [fitFor, setFitFor] = useState({ fitKey, w: frame.w, h: frame.h });
	if (fitFor.fitKey !== fitKey || fitFor.w !== frame.w || fitFor.h !== frame.h) {
		setFitFor({ fitKey, w: frame.w, h: frame.h });
		setVp(null);
		setLive(null);
	}

	const height = contentHeight ?? measuredH ?? 0;
	const ready = frame.w > 0 && contentWidth > 0 && height > 0;
	let base = 1;
	if (frame.w > 0 && contentWidth > 0) {
		base = Math.max(Math.min(minBase, maxBase), Math.min(maxBase, frame.w / contentWidth));
		if (fitHeight && frame.h > 0 && height > 0) base = Math.min(base, frame.h / height);
	}
	const width = fillWidth && frame.w > 0 ? Math.max(contentWidth, frame.w / base) : contentWidth;
	const view: Box = { x: 0, y: 0, w: width, h: height };
	const committed = ready ? (vp ?? fitViewport(view, frame, base)) : null;
	const current = live ?? committed;
	useLayoutEffect(() => {
		g.sync({ view, frame, base, current });
	});

	// The content draws only at a committed scale.
	const kc = base * (committed?.zoom ?? 1);
	const screenWidth = frame.w > 0 ? frame.w / base : width;
	const drawn = useMemo(() => render(kc, screenWidth), [render, kc, screenWidth]);
	const k = base * (current?.zoom ?? 1);
	const pannable = !!(ready && current && canPan(view, frame, base, current));

	const pan = usePanGesture({
		runOnJS: true,
		disableReanimated: true,
		enabled: pannable,
		maxPointers: 1,
		onBegin: g.panBegin,
		onUpdate: g.panUpdate,
		onFinalize: g.panEnd,
	});
	const pinch = usePinchGesture({
		runOnJS: true,
		disableReanimated: true,
		simultaneousWith: pan,
		onBegin: g.pinchBegin,
		onUpdate: g.pinchUpdate,
		onFinalize: g.pinchEnd,
	});
	const tap = useTapGesture({
		runOnJS: true,
		disableReanimated: true,
		numberOfTaps: 2,
		maxDelay: DOUBLE_TAP_MAX_DELAY_MS,
		onActivate: g.doubleTap,
	});

	const onContentLayout = (e: LayoutChangeEvent) => {
		if (contentHeight !== undefined) return;
		const h = e.nativeEvent.layout.height / kc;
		setMeasuredH((old) => (old !== null && Math.abs(old - h) < 0.5 ? old : h));
	};

	const zoomBy = (factor: number) => {
		if (!committed) return;
		setVp(pinchViewport(view, frame, base, committed, factor, { x: frame.w / 2, y: frame.h / 2 }));
	};

	return (
		<GestureDetector gesture={pan}>
			<View style={styles.fill}>
				<GestureDetector gesture={pinch}>
					<View style={styles.fill}>
						<GestureDetector gesture={tap}>
							<View
								style={styles.frame}
								onLayout={(e) =>
									setFrame({
										w: Math.floor(e.nativeEvent.layout.width),
										h: Math.floor(e.nativeEvent.layout.height),
									})
								}
								accessible
								accessibilityRole="adjustable"
								accessibilityLabel={label}
								accessibilityActions={[
									{ name: "increment", label: "Zoom in" },
									{ name: "decrement", label: "Zoom out" },
								]}
								onAccessibilityAction={(e) =>
									zoomBy(e.nativeEvent.actionName === "increment" ? 2 : 0.5)
								}
								testID={testID}
							>
								<View
									onLayout={onContentLayout}
									style={[
										styles.content,
										{
											width: width * kc,
											left: current ? -(current.x - view.x) * k : 0,
											top: current ? -(current.y - view.y) * k : 0,
											opacity: ready ? 1 : 0,
											transform: [{ scale: k / kc }],
										},
									]}
									testID={`${testID}-content`}
								>
									{drawn}
								</View>
							</View>
						</GestureDetector>
					</View>
				</GestureDetector>
			</View>
		</GestureDetector>
	);
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	expand: {
		position: "absolute",
		top: SPACE.xs,
		right: SPACE.xs,
		width: 28,
		height: 28,
		borderRadius: 14,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: SPACE.lg,
		paddingVertical: SPACE.sm,
		gap: SPACE.sm,
	},
	headerEnd: { flexDirection: "row", gap: SPACE.sm },
	headerButton: {
		minWidth: 36,
		height: 36,
		borderRadius: 18,
		paddingHorizontal: SPACE.md,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
	},
	kind: { ...TYPE.xs, fontFamily: FONT.ui, letterSpacing: 1.5 },
	fitText: { ...TYPE.xs, fontFamily: FONT.ui },
	frame: { flex: 1, overflow: "hidden" },
	content: { position: "absolute", transformOrigin: "top left" },
});
