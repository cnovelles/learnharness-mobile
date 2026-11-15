/**
 * The math and Mermaid islands of the Markdown renderer (issue 05 slice C).
 *
 * - MathIsland: a paragraph with inline math, or a display formula. KaTeX
 *   makes the HTML in Hermes (src/lib/math-html.ts); the island shows it.
 * - MermaidIsland: a `mermaid` code fence, drawn by Mermaid in the island
 *   with `securityLevel: "strict"`, as on the desktop.
 *
 * An island starts its WebView only near the screen (decision 3). Before
 * that, and when the island cannot load, it shows `fallback`: the native
 * text with the TeX source in mono, or the chart source.
 *
 * Error states: 8 (math), 9 (Mermaid), 10 and 11 (WebIsland), 16 (a mode
 * change sends new colors to a math island and draws a chart again).
 */
import { MATH_HTML, MATH_SCRIPT, MERMAID_HTML, MERMAID_SCRIPT } from "lh-island-pages";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import type { MathIsland as MathIslandData } from "@/lib/math-html";
import { openLink } from "@/lib/open-link";
import { userMessage } from "@/lib/user-error";
import { copyActions, CopyLabel, useCopy } from "./copy";
import { useNearScreen } from "./island-viewport";
import { Button, ErrorText, type Palette } from "./ui";
import { WebIsland } from "./web-island";
import { SPACE } from "./spacing";

export const FORMULA_ERROR = userMessage("The phone cannot show this formula.");
export const DIAGRAM_ERROR = userMessage("The phone cannot draw this diagram.");

/** Mermaid gets this long to draw a chart (error state 9). */
export const MERMAID_TIMEOUT_MS = 10000;

/** The chart font size, as on the desktop (MERMAID_FONT_SIZE). */
const MERMAID_FONT_SIZE = 16;

const MATH_MAX_HEIGHT = 1200;
const MERMAID_MIN_HEIGHT = 120;
const MERMAID_MAX_HEIGHT = 1600;

const MONO = "Menlo";

export type IslandStyle = {
	c: Palette;
	scheme: "light" | "dark";
	color: string;
	fontSize: number;
	lineHeight: number;
};

/** A paragraph with inline math, or a display formula. */
export function MathIsland({
	island,
	look,
	fallback,
	testID,
}: {
	island: MathIslandData;
	look: IslandStyle;
	/** Native text with the TeX source: before the WebView starts, and when it cannot load. */
	fallback: ReactNode;
	testID?: string;
}) {
	const { c } = look;
	const slot = useRef<ComponentRef<typeof View>>(null);
	const near = useNearScreen(slot);
	const [loadFailed, setLoadFailed] = useState(false);
	const [height, setHeight] = useState<number | null>(null);
	const { copy, state } = useCopy(() => island.copy);
	const data = useMemo(
		() => ({
			html: island.html,
			color: look.color,
			accent: c.accent,
			muted: c.muted,
			code: c.code,
			codeBg: c.codeBg,
			fontSize: look.fontSize,
			lineHeight: look.lineHeight,
		}),
		[island.html, look.color, look.fontSize, look.lineHeight, c],
	);
	let body: ReactNode;
	if (loadFailed) body = fallback;
	else if (near) {
		body = (
			<WebIsland
				html={MATH_HTML}
				script={MATH_SCRIPT}
				data={data}
				live
				minHeight={look.lineHeight}
				maxHeight={MATH_MAX_HEIGHT}
				initialHeight={height}
				onHeight={setHeight}
				onMessage={(message) => {
					if (message.type === "longpress") copy();
					else if (message.type === "link") {
						const url = island.links[message.index];
						if (url) openLink(url);
					}
				}}
				onFail={() => setLoadFailed(true)}
				testID="md-math-island"
			/>
		);
	} else body = height === null ? fallback : <View style={{ height }} />;
	return (
		<View ref={slot} collapsable={false} {...copyActions(copy, "formula")} testID={testID}>
			{body}
			{loadFailed || island.failed ? (
				<ErrorText testID="md-math-error">{FORMULA_ERROR}</ErrorText>
			) : null}
			<CopyLabel state={state} c={c} />
		</View>
	);
}

type MermaidPhase = "drawing" | "drawn" | "failed";

/** A `mermaid` code fence. */
export function MermaidIsland({
	source,
	open,
	look,
}: {
	source: string;
	/** The fence is still open while the reply streams. */
	open: boolean;
	look: IslandStyle;
}) {
	const { c, scheme } = look;
	const slot = useRef<ComponentRef<typeof View>>(null);
	const near = useNearScreen(slot);
	const [phase, setPhase] = useState<MermaidPhase>("drawing");
	const [attempt, setAttempt] = useState(0);
	const [showSource, setShowSource] = useState(false);
	const [height, setHeight] = useState<number | null>(null);
	const { copy, state } = useCopy(() => source);
	const data = useMemo(
		() => ({ source, theme: scheme, fontSize: MERMAID_FONT_SIZE }),
		[source, scheme],
	);

	// A new chart, a mode change or Try again draws again.
	const [drawn, setDrawn] = useState({ data, attempt });
	if (drawn.data !== data || drawn.attempt !== attempt) {
		setDrawn({ data, attempt });
		setPhase("drawing");
	}

	const drawing = !open && near && phase === "drawing";
	useEffect(() => {
		if (!drawing) return;
		const timer = setTimeout(() => setPhase("failed"), MERMAID_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [drawing, attempt]);

	if (open) {
		return (
			<View style={[styles.mermaidWait, { borderColor: c.line }]} testID="md-mermaid-open">
				<ActivityIndicator color={c.muted} />
				<Text style={{ color: c.muted }}>Drawing the diagram…</Text>
			</View>
		);
	}

	if (phase === "failed") {
		return (
			<View style={[styles.mermaidFailed, { borderColor: c.line }]} testID="md-mermaid-failed">
				<ErrorText testID="md-mermaid-error">{DIAGRAM_ERROR}</ErrorText>
				<View style={styles.row}>
					<Button
						title="Try again"
						onPress={() => {
							setAttempt(attempt + 1);
							setPhase("drawing");
						}}
						testID="md-mermaid-retry"
					/>
					<Button
						title={showSource ? "Hide the source" : "Show the source"}
						kind="plain"
						onPress={() => setShowSource(!showSource)}
						testID="md-mermaid-source-toggle"
					/>
				</View>
				{showSource ? (
					<ScrollView horizontal showsHorizontalScrollIndicator={false}>
						<Text style={[styles.source, { color: c.text }]} testID="md-mermaid-source">
							{source}
						</Text>
					</ScrollView>
				) : null}
			</View>
		);
	}

	return (
		<View ref={slot} collapsable={false} {...copyActions(copy, "diagram")} testID="md-mermaid">
			{near ? (
				<WebIsland
					key={attempt}
					html={MERMAID_HTML}
					script={MERMAID_SCRIPT}
					data={data}
					minHeight={MERMAID_MIN_HEIGHT}
					maxHeight={MERMAID_MAX_HEIGHT}
					initialHeight={height}
					onHeight={setHeight}
					onMessage={(message) => {
						if (message.type === "rendered") setPhase("drawn");
						else if (message.type === "error") setPhase("failed");
						else if (message.type === "longpress") copy();
					}}
					onFail={() => setPhase("failed")}
					testID="md-mermaid-island"
				/>
			) : (
				<View style={{ height: height ?? MERMAID_MIN_HEIGHT }} />
			)}
			{phase === "drawing" ? (
				<View pointerEvents="none" style={styles.mermaidSpinner}>
					<ActivityIndicator color={c.muted} />
				</View>
			) : null}
			<CopyLabel state={state} c={c} />
		</View>
	);
}

const styles = StyleSheet.create({
	mermaidWait: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		minHeight: MERMAID_MIN_HEIGHT,
		justifyContent: "center",
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 8,
	},
	mermaidFailed: {
		gap: SPACE.sm,
		padding: SPACE.md,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 8,
	},
	mermaidSpinner: {
		...StyleSheet.absoluteFill,
		alignItems: "center",
		justifyContent: "center",
	},
	row: { flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" },
	source: { fontFamily: MONO, fontSize: 13, lineHeight: 20 },
});
