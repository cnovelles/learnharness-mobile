/**
 * The Graph tab canvas (issue 08 slice C, D-016): the desktop connectivity
 * graph, read only, drawn with Skia from the positions that the Mac saves.
 *
 * The draw layers are the desktop's (fork `components/graph-canvas.ts`):
 * 1. the region tints (a small blurred bitmap, the desktop splat),
 * 2. the edges (headless into implication nodes),
 * 3. the node discs,
 * 4. the node labels, which fade in as the camera zooms in,
 * 5. the glow of the selected node,
 * 6. the region labels, which fade out as the node labels fade in.
 *
 * The camera runs on the UI thread (Reanimated shared values): pan with one
 * finger, pinch to zoom, double tap to fit. A tap picks a node on the JS
 * thread and calls `onSelect`. The scene math is in src/lib/graph-scene.ts.
 */
import {
	AlphaType,
	Canvas,
	Circle,
	ColorType,
	FilterMode,
	Group,
	Image,
	MipmapMode,
	Paint,
	PaintStyle,
	Picture,
	Points,
	RadialGradient,
	Skia,
	StrokeCap,
	Text,
	createPicture,
	useFont,
	vec,
	type SkFont,
	type SkImage,
	type SkRect,
} from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, useColorScheme, type LayoutChangeEvent } from "react-native";
import {
	GestureDetector,
	GestureHandlerRootView,
	useExclusiveGestures,
	usePanGesture,
	usePinchGesture,
	useSimultaneousGestures,
	useTapGesture,
} from "react-native-gesture-handler";
import {
	useAnimatedReaction,
	useDerivedValue,
	useSharedValue,
	withTiming,
	type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
	CANVAS_SETTINGS,
	buildScene,
	fitCamera,
	labelLineHeight,
	labelShow,
	nodeLabelOpacity,
	panCamera,
	pickNode,
	pinchStep,
	PHONE_REGION_LABEL,
	regionLabelBoxes,
	placeRegionLabels,
	type RegionLabelPlacement,
	tapAllowed,
	DOUBLE_TAP_MAX_DISTANCE,
	regionFill,
	regionLabelColor,
	type LabelShow,
	type PinchFocus,
	type Scene,
	type SceneMeasure,
} from "@/lib/graph-scene";
import type { CanvasModel } from "@/lib/knowledge";
import {
	CLUSTER_LIGHTNESS,
	GLOW_ALPHA,
	GLOW_SCALE,
	REGION_LABEL_LINE_HEIGHT,
	blurRegionPixels,
	labelWrapWidth,
	type RegionSplat,
} from "@/lib/shared";
import { DOUBLE_TAP_MAX_DELAY_MS } from "@/lib/zoom-viewport";
import { alpha, usePalette } from "./ui";

// The desktop draws the labels in the body font (`--font-prose`, Source Sans 3).
const LABEL_FONT = require("@expo-google-fonts/source-sans-3/400Regular/SourceSans3_400Regular.ttf");

/** The camera glide of a double tap (fit), ms. */
const FIT_MS = 250;

/** The advance width of a text in a font (the canvas `measureText().width`). */
function textWidth(font: SkFont, text: string): number {
	if (!text) return 0;
	let w = 0;
	for (const g of font.getGlyphWidths(font.getGlyphIDs(text))) w += g;
	return w;
}

/**
 * Paint the region splat on a CPU surface, then blur it and scale its alpha
 * as the desktop does (`blurRegionPixels`). Null when Skia cannot make the
 * surface: the graph then draws with no region tints.
 */
function regionImage(splat: RegionSplat, ring: number, edgeAlpha: number): SkImage | null {
	const surface = Skia.Surface.Make(splat.width, splat.height);
	if (!surface) return null;
	const canvas = surface.getCanvas();
	const stroke = Skia.Paint();
	stroke.setAntiAlias(true);
	stroke.setStyle(PaintStyle.Stroke);
	stroke.setStrokeCap(StrokeCap.Round);
	stroke.setStrokeWidth(splat.lineWidth);
	const fill = Skia.Paint();
	fill.setAntiAlias(true);
	for (const layer of splat.layers) {
		const color = Float32Array.from(regionFill(layer.hue, ring));
		const s = layer.segments;
		if (s.length > 0) {
			const path = Skia.PathBuilder.Make();
			for (let i = 0; i < s.length; i += 4) {
				path.moveTo(s[i]!, s[i + 1]!);
				path.lineTo(s[i + 2]!, s[i + 3]!);
			}
			stroke.setColor(color);
			canvas.drawPath(path.detach(), stroke);
		}
		fill.setColor(color);
		const d = layer.discs;
		for (let i = 0; i < d.length; i += 2) canvas.drawCircle(d[i]!, d[i + 1]!, splat.discR, fill);
	}
	surface.flush();
	const info = {
		width: splat.width,
		height: splat.height,
		colorType: ColorType.RGBA_8888,
		alphaType: AlphaType.Unpremul,
	};
	const pixels = surface.makeImageSnapshot().readPixels(0, 0, info);
	if (!(pixels instanceof Uint8Array)) return null;
	blurRegionPixels(pixels, splat.width, splat.height, splat.blurPx, edgeAlpha);
	return Skia.Image.MakeImage(info, Skia.Data.fromBytes(pixels), splat.width * 4);
}

/**
 * The cull rect of a picture: the box of the points (x, y pairs) with a pad.
 * Skia's default starts at (0, 0) and drops what is at negative positions.
 */
function cullRect(points: ArrayLike<number>, pad: number): SkRect {
	let minX = 0;
	let minY = 0;
	let maxX = 0;
	let maxY = 0;
	for (let i = 0; i + 1 < points.length; i += 2) {
		minX = Math.min(minX, points[i]!);
		maxX = Math.max(maxX, points[i]!);
		minY = Math.min(minY, points[i + 1]!);
		maxY = Math.max(maxY, points[i + 1]!);
	}
	return Skia.XYWHRect(minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad);
}

/**
 * The arrow heads and the node discs as one picture in world units (drawn
 * once per scene). Each head and each disc is its own draw: the GPU draws a
 * circle or a small convex path directly. One path with all the shapes is
 * not convex, and Skia then fills it on the CPU at screen size on each
 * frame (the zoom-in stutter, iPhone profile 2026-11-21).
 */
function markPicture(scene: Scene, headColor: string, discColor: string) {
	const heads = Skia.Paint();
	heads.setAntiAlias(true);
	heads.setColor(Skia.Color(headColor));
	const discs = Skia.Paint();
	discs.setAntiAlias(true);
	discs.setColor(Skia.Color(discColor));
	const r = CANVAS_SETTINGS.nodeSize;
	const h = scene.glyphs.heads;
	const d = scene.discs;
	return createPicture(
		(canvas) => {
			for (let i = 0; i + 5 < h.length; i += 6) {
				const path = Skia.PathBuilder.Make();
				path.moveTo(h[i]!, h[i + 1]!);
				path.lineTo(h[i + 2]!, h[i + 3]!);
				path.lineTo(h[i + 4]!, h[i + 5]!);
				path.close();
				canvas.drawPath(path.detach(), heads);
			}
			for (let i = 0; i + 1 < d.length; i += 2) canvas.drawCircle(d[i]!, d[i + 1]!, r, discs);
		},
		cullRect([...d, ...h], 2 * r),
	);
}

/** The node labels as one picture in world units (drawn once per scene). */
function labelPicture(scene: Scene, font: SkFont, color: string) {
	const paint = Skia.Paint();
	paint.setAntiAlias(true);
	paint.setColor(Skia.Color(color));
	const ascent = -font.getMetrics().ascent;
	const lineH = labelLineHeight();
	const pad = 2 * labelWrapWidth(CANVAS_SETTINGS.labelSize) + 10 * lineH;
	const rect = cullRect(
		scene.labels.flatMap((l) => [l.x, l.top]),
		pad,
	);
	return createPicture((canvas) => {
		for (const label of scene.labels) {
			label.lines.forEach((line, i) => {
				const x = label.x - textWidth(font, line) / 2;
				canvas.drawText(line, x, label.top + ascent + i * lineH, paint, font);
			});
		}
	}, rect);
}

/** One region label line, laid out at the region centroid (world units). */
interface RegionLine {
	key: string;
	/** The anchor index (for `regionLabelsShown`). */
	anchor: number;
	text: string;
	/** The centroid: the origin of the label's 1/k scale. */
	cx: number;
	cy: number;
	/** The text start and baseline, in screen points from the centroid. */
	dx: number;
	dy: number;
	color: Float32Array;
}

function regionLines(scene: Scene, font: SkFont, lightness: number): RegionLine[] {
	const size = PHONE_REGION_LABEL.size;
	const lineH = size * REGION_LABEL_LINE_HEIGHT;
	const m = font.getMetrics();
	// The desktop `textBaseline: middle`: the baseline under the em-box middle.
	const middle = (-m.ascent - m.descent) / 2;
	const out: RegionLine[] = [];
	scene.anchors.forEach((a, anchor) => {
		if (!a.lines) return;
		const first = (-(a.lines.length - 1) / 2) * lineH;
		const color = Float32Array.from(regionLabelColor(a.hue, lightness));
		a.lines.forEach((text, i) =>
			out.push({
				key: `${a.id}:${i}`,
				anchor,
				text,
				cx: a.cx,
				cy: a.cy,
				dx: -textWidth(font, text) / 2,
				dy: first + i * lineH + middle,
				color,
			}),
		);
	});
	return out;
}

/**
 * A region label line at a constant size on screen (scale 1/k about its
 * centroid). It moves inside the canvas edge, and it is hidden while it
 * overlaps the label of a larger region (`placeRegionLabels`).
 */
function RegionLabel({
	line,
	font,
	k,
	place,
}: {
	line: RegionLine;
	font: SkFont;
	k: SharedValue<number>;
	place: SharedValue<RegionLabelPlacement>;
}) {
	const opacity = useDerivedValue(() => (place.get().shown[line.anchor] ? 1 : 0));
	// The move is in screen points; the group is in world units (scale k).
	const transform = useDerivedValue(() => {
		const p = place.get();
		const s = k.get();
		return [
			{ translateX: p.dx[line.anchor]! / s },
			{ translateY: p.dy[line.anchor]! / s },
			{ scale: 1 / s },
		];
	});
	return (
		<Group transform={transform} origin={vec(line.cx, line.cy)} opacity={opacity}>
			<Text
				x={line.cx + line.dx}
				y={line.cy + line.dy}
				text={line.text}
				font={font}
				color={line.color}
			/>
		</Group>
	);
}

export interface GraphCanvasProps {
	model: CanvasModel;
	/** The search result: the ids that stay visible (null: all nodes). */
	visible: ReadonlySet<string> | null;
	/** The node of the open sheet (it glows), or null. */
	selected: string | null;
	onSelect: (nodeId: string) => void;
	/** The VoiceOver label of the canvas. */
	label: string;
	testID?: string;
}

export function GraphCanvas({
	model,
	visible,
	selected,
	onSelect,
	label,
	testID = "graph-canvas",
}: GraphCanvasProps) {
	const c = usePalette();
	const mode = useColorScheme() === "dark" ? "dark" : "light";
	const lightness = CLUSTER_LIGHTNESS[mode];
	const labelFont = useFont(LABEL_FONT, CANVAS_SETTINGS.labelSize);
	const regionFont = useFont(LABEL_FONT, PHONE_REGION_LABEL.size);
	const [size, setSize] = useState({ w: 0, h: 0 });

	const measure = useMemo<SceneMeasure | null>(
		() =>
			labelFont && regionFont
				? { label: (s) => textWidth(labelFont, s), region: (s) => textWidth(regionFont, s) }
				: null,
		[labelFont, regionFont],
	);
	const scene = useMemo(
		() => (measure ? buildScene(model, visible, measure) : null),
		[model, visible, measure],
	);

	// The edge shafts as separate lines (point pairs). The GPU draws a single
	// straight line with flat ends directly. One path with all the shafts, or
	// round ends, makes Skia fill the stroke on the CPU at screen size on each
	// frame (the zoom-in stutter, iPhone profiles 2026-11-21).
	const shafts = useMemo(() => {
		if (!scene) return null;
		const s = scene.glyphs.shafts;
		const points = [];
		for (let i = 0; i + 3 < s.length; i += 4)
			points.push(vec(s[i]!, s[i + 1]!), vec(s[i + 2]!, s[i + 3]!));
		return points;
	}, [scene]);
	const marks = useMemo(
		() => (scene ? markPicture(scene, c.muted, c.primary) : null),
		[scene, c.muted, c.primary],
	);

	const labels = useMemo(
		() => (scene && labelFont ? labelPicture(scene, labelFont, c.muted) : null),
		[scene, labelFont, c.muted],
	);
	const regionText = useMemo(
		() => (scene && regionFont ? regionLines(scene, regionFont, lightness.label) : []),
		[scene, regionFont, lightness.label],
	);
	const regions = useMemo(() => {
		if (!scene?.splat) return null;
		const image = regionImage(scene.splat, lightness.ring, CANVAS_SETTINGS.regions.edgeAlpha);
		return image ? { image, rect: scene.splat.rect } : null;
	}, [scene, lightness.ring]);

	// ── The camera (UI thread) ──
	const tx = useSharedValue(0);
	const ty = useSharedValue(0);
	const k = useSharedValue(1);
	const kFit = useSharedValue(1);
	const fit = useSharedValue({ x: 0, y: 0, k: 1 });
	const pinching = useSharedValue(false);
	/** The time of the last pinch step (ms): a tap just after a pinch is a finger of it. */
	const pinchAt = useSharedValue(-Infinity);
	const focal = useSharedValue<PinchFocus | null>(null);

	// Fit once for the first graph and each new view size; a new snapshot
	// (the Mac changed the graph) keeps the camera, as the desktop does.
	const fitted = useRef<{ w: number; h: number } | null>(null);
	useEffect(() => {
		if (size.w <= 0 || size.h <= 0) return;
		const cam = fitCamera(model.bounds, size.w, size.h);
		fit.set(cam);
		kFit.set(cam.k);
		const last = fitted.current;
		if (!last || last.w !== size.w || last.h !== size.h) {
			fitted.current = size;
			tx.set(cam.x);
			ty.set(cam.y);
			k.set(cam.k);
		}
	}, [model.bounds, size, fit, kFit, tx, ty, k]);

	const transform = useDerivedValue(() => [
		{ translateX: tx.get() },
		{ translateY: ty.get() },
		{ scale: k.get() },
	]);
	const edgeStroke = useDerivedValue(() => CANVAS_SETTINGS.edgeWidth / k.get());
	const nodeLabelAlpha = useDerivedValue(() =>
		nodeLabelOpacity(kFit.get(), k.get(), CANVAS_SETTINGS.labelZoom),
	);
	const boxes = useMemo(() => (scene ? regionLabelBoxes(scene.anchors) : []), [scene]);
	const order = useMemo(() => scene?.labelOrder ?? [], [scene]);
	const regionPlace = useDerivedValue(() =>
		placeRegionLabels(boxes, order, { x: tx.get(), y: ty.get(), k: k.get() }, size.w, size.h),
	);
	const regionLabelAlpha = useDerivedValue(() =>
		CANVAS_SETTINGS.clusterLabels
			? 1 - nodeLabelOpacity(kFit.get(), k.get(), CANVAS_SETTINGS.labelZoom)
			: 0,
	);

	// Skia draws a picture with no paint, so a group opacity does not reach
	// it. Each label layer is drawn only while it shows, and the node labels
	// go through a layer paint only while they fade.
	const [nodeLabels, setNodeLabels] = useState<LabelShow>("off");
	const [regionLabels, setRegionLabels] = useState(true);
	useAnimatedReaction(
		() => labelShow(nodeLabelAlpha.get()),
		(now, before) => {
			if (now !== before) scheduleOnRN(setNodeLabels, now);
		},
	);
	useAnimatedReaction(
		() => regionLabelAlpha.get() > 0,
		(now, before) => {
			if (now !== before) scheduleOnRN(setRegionLabels, now);
		},
	);

	const pick = useCallback(
		(x: number, y: number, camX: number, camY: number, camK: number) => {
			if (!scene) return;
			const id = pickNode(scene, { x: camX, y: camY, k: camK }, x, y);
			if (id) onSelect(id);
		},
		[scene, onSelect],
	);

	const pan = usePanGesture({
		maxPointers: 1,
		onUpdate: (e) => {
			"worklet";
			// A pinch moves the camera itself.
			if (pinching.get()) return;
			const cam = panCamera({ x: tx.get(), y: ty.get(), k: k.get() }, e.changeX, e.changeY);
			tx.set(cam.x);
			ty.set(cam.y);
		},
	});
	const pinch = usePinchGesture({
		onBegin: () => {
			"worklet";
			pinching.set(true);
			focal.set(null);
		},
		onUpdate: (e) => {
			"worklet";
			const { cam, focus } = pinchStep(
				{ x: tx.get(), y: ty.get(), k: k.get() },
				focal.get(),
				e.scaleChange,
				e.focalX,
				e.focalY,
				e.numberOfPointers,
			);
			pinchAt.set(Date.now());
			tx.set(cam.x);
			ty.set(cam.y);
			k.set(cam.k);
			focal.set(focus);
		},
		onFinalize: () => {
			"worklet";
			pinching.set(false);
			focal.set(null);
		},
	});
	const doubleTap = useTapGesture({
		numberOfTaps: 2,
		maxDelay: DOUBLE_TAP_MAX_DELAY_MS,
		maxDistance: DOUBLE_TAP_MAX_DISTANCE,
		onActivate: () => {
			"worklet";
			if (!tapAllowed(pinching.get(), pinchAt.get(), Date.now())) return;
			tx.set(withTiming(fit.get().x, { duration: FIT_MS }));
			ty.set(withTiming(fit.get().y, { duration: FIT_MS }));
			k.set(withTiming(fit.get().k, { duration: FIT_MS }));
		},
	});
	const tap = useTapGesture({
		onActivate: (e) => {
			"worklet";
			if (!tapAllowed(pinching.get(), pinchAt.get(), Date.now())) return;
			scheduleOnRN(pick, e.x, e.y, tx.get(), ty.get(), k.get());
		},
	});
	const taps = useExclusiveGestures(doubleTap, tap);
	const gesture = useSimultaneousGestures(pan, pinch, taps);

	const glow = useMemo(() => {
		if (!selected || !scene) return null;
		const node = scene.pickable.find((n) => n.id === selected);
		if (!node) return null;
		const r = CANVAS_SETTINGS.nodeSize;
		return { x: node.x, y: node.y, r, outer: r * GLOW_SCALE };
	}, [selected, scene]);

	const onLayout = (e: LayoutChangeEvent) => {
		const { width, height } = e.nativeEvent.layout;
		setSize((old) =>
			old.w === Math.floor(width) && old.h === Math.floor(height)
				? old
				: { w: Math.floor(width), h: Math.floor(height) },
		);
	};

	return (
		// The app root has no gesture root: the canvas brings its own.
		<GestureHandlerRootView style={styles.fill}>
			<GestureDetector gesture={gesture}>
				<View
					style={styles.fill}
					onLayout={onLayout}
					accessible
					accessibilityRole="image"
					accessibilityLabel={label}
					testID={testID}
				>
					{shafts && marks && size.w > 0 ? (
						<Canvas style={styles.fill}>
							<Group transform={transform}>
								{regions ? (
									<Image
										image={regions.image}
										x={regions.rect.minX}
										y={regions.rect.minY}
										width={regions.rect.w}
										height={regions.rect.h}
										fit="fill"
										sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
									/>
								) : null}
								<Points
									points={shafts}
									mode="lines"
									style="stroke"
									strokeWidth={edgeStroke}
									strokeCap="butt"
									color={c.muted}
								/>
								<Picture picture={marks} />
								{labels && nodeLabels === "on" ? <Picture picture={labels} /> : null}
								{labels && nodeLabels === "fade" ? (
									<Group layer={<Paint opacity={nodeLabelAlpha} />}>
										<Picture picture={labels} />
									</Group>
								) : null}
								{glow ? (
									<Circle cx={glow.x} cy={glow.y} r={glow.outer}>
										<RadialGradient
											c={vec(glow.x, glow.y)}
											r={glow.outer}
											colors={[
												alpha(c.primary, GLOW_ALPHA),
												alpha(c.primary, GLOW_ALPHA),
												alpha(c.primary, 0),
											]}
											positions={[0, glow.r / glow.outer, 1]}
										/>
									</Circle>
								) : null}
								{regionFont && regionLabels ? (
									<Group opacity={regionLabelAlpha}>
										{regionText.map((line) => (
											<RegionLabel
												key={line.key}
												line={line}
												font={regionFont}
												k={k}
												place={regionPlace}
											/>
										))}
									</Group>
								) : null}
							</Group>
						</Canvas>
					) : null}
				</View>
			</GestureDetector>
		</GestureHandlerRootView>
	);
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
});
