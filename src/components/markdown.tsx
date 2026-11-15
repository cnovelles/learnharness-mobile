/**
 * The teacher's Markdown as native views (issue 05 slice A). The parse is in
 * src/lib/markdown.ts; this file draws the tree.
 *
 * What the desktop does, and what the phone does:
 * - Headings, paragraphs, bold, italic, strikethrough, lists, task lists,
 *   quotes, tables and rules: native text and views.
 * - The GitHub alert markers ([!IMPORTANT] and 4 more): an outlined box with
 *   sharp corners, no label (the desktop's `MarkdownBlockquote`).
 * - Inline code: a mono font on a colored band. Native nested text cannot
 *   take padding or rounded corners (issue 05, "Accepted limit").
 * - Code fences: a mono block with line numbers that scrolls sideways, in
 *   the desktop's Shiki colors (src/lib/code-highlight.ts). A fence that is
 *   still open while the reply streams, an unknown language, a large block
 *   or a highlighter failure show the same block with no colors.
 * - Math: KaTeX in a WebView island (slice C, src/components/islands.tsx).
 *   A paragraph with inline math goes into one island with all its text. A
 *   heading or a table cell with math shows the TeX source in mono.
 * - Mermaid fences: drawn by Mermaid in a WebView island.
 * - Images never load (the desktop blocks remote images too).
 * - Links open only for http, https and mailto. Raw HTML shows as text.
 *
 * - A long press on a code block, a table, a math block or a chart copies
 *   its source (code as text, a table as Markdown, math as TeX, a chart as
 *   its Mermaid source; src/components/copy.tsx). A short label shows
 *   "Copied" or "Could not copy." (issue 05, decision 4 and error state 17).
 *
 * Every message has an error boundary: if the drawing fails, the message
 * shows as plain text, and the rest of the transcript still shows.
 */
import type { Definition, Nodes, PhrasingContent, Root, RootContent, Table } from "mdast";
import { Component, Fragment, useMemo, type ReactNode } from "react";
import {
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	View,
	useColorScheme,
	type TextStyle,
} from "react-native";

import { CODE_COLORS, highlightCode, type CodeScheme, type CodeToken } from "@/lib/code-highlight";
import { tableMarkdown } from "@/lib/copy-source";
import { alertContent, parseMarkdown, plainText, safeLinkUrl } from "@/lib/markdown";
import { hasInlineMath, mathBlockIsland, paragraphIsland } from "@/lib/math-html";
import { openLink } from "@/lib/open-link";
import { CopyLabel, CopyTarget, useCopy } from "./copy";
import { FORMULA_ERROR, MathIsland, MermaidIsland, type IslandStyle } from "./islands";
import { ErrorText, usePalette, type Palette } from "./ui";

export { COPY_LABEL_MS } from "./copy";

export const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

const HEADING_SIZE: Record<number, number> = { 1: 22, 2: 19, 3: 17 };

type Ctx = {
	c: Palette;
	/** The light or dark mode, for the code colors. */
	scheme: CodeScheme;
	/** The text style of the surface: size, line height, color, weight. */
	base: TextStyle;
	/** Less space between blocks (options, cards). */
	compact: boolean;
	definitions: Map<string, Definition>;
};

function fontSizeOf(base: TextStyle): number {
	return typeof base.fontSize === "number" ? base.fontSize : 16;
}

// ─── Inline content ──────────────────────────────────────────────────────────

function inlines(nodes: readonly PhrasingContent[], ctx: Ctx): ReactNode[] {
	return nodes.map((node, i) => <Inline key={i} node={node} ctx={ctx} />);
}

function Inline({ node, ctx }: { node: PhrasingContent; ctx: Ctx }): ReactNode {
	const { c } = ctx;
	switch (node.type) {
		case "text":
			return node.value;
		case "strong":
			return <Text style={styles.strong}>{inlines(node.children, ctx)}</Text>;
		case "emphasis":
			return <Text style={styles.em}>{inlines(node.children, ctx)}</Text>;
		case "delete":
			return <Text style={styles.del}>{inlines(node.children, ctx)}</Text>;
		case "break":
			return "\n";
		case "inlineCode":
			return (
				<Text
					style={{
						fontFamily: MONO,
						fontSize: fontSizeOf(ctx.base) * 0.88,
						color: c.code,
						backgroundColor: c.codeBg,
					}}
					testID="md-inline-code"
				>
					{` ${node.value} `}
				</Text>
			);
		case "inlineMath":
			return (
				<Text
					style={{ fontFamily: MONO, fontSize: fontSizeOf(ctx.base) * 0.88 }}
					testID="md-inline-math"
				>
					{node.value}
				</Text>
			);
		case "link":
			return (
				<LinkText url={node.url} ctx={ctx}>
					{inlines(node.children, ctx)}
				</LinkText>
			);
		case "linkReference": {
			const def = ctx.definitions.get(node.identifier.toLowerCase());
			return (
				<LinkText url={def?.url} ctx={ctx}>
					{inlines(node.children, ctx)}
				</LinkText>
			);
		}
		case "image":
		case "imageReference":
			return (
				<Text style={{ color: c.muted }} testID="md-image-blocked">
					{node.alt ? `[Image blocked: ${node.alt}]` : "[Image blocked]"}
				</Text>
			);
		case "footnoteReference":
			return (
				<Text style={{ color: c.accent, fontSize: fontSizeOf(ctx.base) * 0.75 }}>
					{`[${node.label ?? node.identifier}]`}
				</Text>
			);
		case "html":
			return node.value;
		default:
			return plainText(node as Nodes);
	}
}

function LinkText({ url, ctx, children }: { url?: string; ctx: Ctx; children: ReactNode }) {
	const safe = safeLinkUrl(url);
	if (!safe) return <>{children}</>;
	return (
		<Text
			style={{ color: ctx.c.accent, textDecorationLine: "underline" }}
			accessibilityRole="link"
			onPress={() => openLink(safe)}
			testID="md-link"
		>
			{children}
		</Text>
	);
}

// ─── Math and Mermaid ────────────────────────────────────────────────────────

function lineHeightOf(base: TextStyle): number {
	return typeof base.lineHeight === "number" ? base.lineHeight : Math.round(fontSizeOf(base) * 1.5);
}

function islandStyle(ctx: Ctx): IslandStyle {
	const { c, scheme, base } = ctx;
	return {
		c,
		scheme,
		color: typeof base.color === "string" ? base.color : c.text,
		fontSize: fontSizeOf(base),
		lineHeight: lineHeightOf(base),
	};
}

/** The TeX source of a display formula in mono: the island's fallback. */
function MathSource({ value, ctx }: { value: string; ctx: Ctx }) {
	const { base } = ctx;
	const { copy, state } = useCopy(() => value);
	return (
		<View>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} testID="md-math">
				<CopyTarget onCopy={copy} what="formula">
					<Text style={{ fontFamily: MONO, fontSize: fontSizeOf(base) * 0.88, color: base.color }}>
						{value}
					</Text>
				</CopyTarget>
			</ScrollView>
			<CopyLabel state={state} c={ctx.c} />
		</View>
	);
}

/** A display formula: KaTeX in an island. A formula that KaTeX cannot draw
 *  shows its source and the error at once, with no WebView (error state 8). */
function MathBlock({ value, ctx }: { value: string; ctx: Ctx }) {
	const island = useMemo(() => mathBlockIsland(value), [value]);
	const fallback = <MathSource value={value} ctx={ctx} />;
	if (island.failed) {
		return (
			<View>
				{fallback}
				<ErrorText testID="md-math-error">{FORMULA_ERROR}</ErrorText>
			</View>
		);
	}
	return <MathIsland island={island} look={islandStyle(ctx)} fallback={fallback} />;
}

/** A paragraph with inline math: one island with all its text (decision 4). */
function MathParagraph({ nodes, ctx }: { nodes: readonly PhrasingContent[]; ctx: Ctx }) {
	const island = useMemo(
		() => paragraphIsland(nodes, (id) => ctx.definitions.get(id)?.url),
		[nodes, ctx.definitions],
	);
	return (
		<MathIsland
			island={island}
			look={islandStyle(ctx)}
			fallback={<Text style={ctx.base}>{inlines(nodes, ctx)}</Text>}
			testID="md-math-paragraph"
		/>
	);
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

function Blocks({ nodes, ctx }: { nodes: readonly RootContent[]; ctx: Ctx }) {
	return (
		<View style={{ gap: ctx.compact ? 4 : 10 }}>
			{nodes
				.filter((n) => n.type !== "definition")
				.map((node, i) => (
					<Block key={i} node={node} ctx={ctx} />
				))}
		</View>
	);
}

function Block({ node, ctx }: { node: RootContent; ctx: Ctx }): ReactNode {
	const { c, base } = ctx;
	switch (node.type) {
		case "paragraph":
			if (hasInlineMath(node.children)) return <MathParagraph nodes={node.children} ctx={ctx} />;
			return <Text style={base}>{inlines(node.children, ctx)}</Text>;
		case "heading": {
			const size = HEADING_SIZE[node.depth] ?? fontSizeOf(base);
			return (
				<Text
					accessibilityRole="header"
					style={[base, { fontSize: size, lineHeight: Math.round(size * 1.3), fontWeight: "700" }]}
				>
					{inlines(node.children, ctx)}
				</Text>
			);
		}
		case "thematicBreak":
			return <View style={[styles.rule, { borderColor: c.line }]} />;
		case "blockquote": {
			const alert = alertContent(node);
			if (alert) {
				return (
					<View style={[styles.callout, { borderColor: c.text }]} testID="md-callout">
						<Blocks nodes={alert} ctx={ctx} />
					</View>
				);
			}
			return (
				<View style={[styles.quote, { borderColor: c.line }]} testID="md-quote">
					<Blocks
						nodes={node.children}
						ctx={{
							...ctx,
							base: { ...base, color: c.muted, fontStyle: "italic" },
						}}
					/>
				</View>
			);
		}
		case "list":
			return (
				<View style={{ gap: ctx.compact ? 2 : 4 }}>
					{node.children.map((item, i) => {
						const marker =
							typeof item.checked === "boolean"
								? item.checked
									? "☑"
									: "☐"
								: node.ordered
									? `${(node.start ?? 1) + i}.`
									: "•";
						return (
							<View key={i} style={styles.item}>
								<Text style={[base, styles.marker]}>{marker}</Text>
								<View style={styles.itemBody}>
									<Blocks nodes={item.children} ctx={{ ...ctx, compact: true }} />
								</View>
							</View>
						);
					})}
				</View>
			);
		case "code":
			if (node.lang?.trim().toLowerCase() === "mermaid") {
				return (
					<MermaidIsland
						source={node.value}
						open={node.data?.open === true}
						look={islandStyle(ctx)}
					/>
				);
			}
			return (
				<CodeBlock
					value={node.value}
					lang={node.lang}
					meta={node.meta ?? ""}
					open={node.data?.open === true}
					ctx={ctx}
				/>
			);
		case "math":
			return <MathBlock value={node.value} ctx={ctx} />;
		case "table":
			return <TableBlock node={node} ctx={ctx} />;
		case "html":
			return <Text style={base}>{node.value}</Text>;
		case "footnoteDefinition":
			return (
				<View style={styles.item}>
					<Text
						style={[base, styles.marker, { color: c.accent }]}
					>{`[${node.label ?? node.identifier}]`}</Text>
					<View style={styles.itemBody}>
						<Blocks nodes={node.children} ctx={{ ...ctx, compact: true }} />
					</View>
				</View>
			);
		default:
			return <Text style={base}>{plainText(node as Nodes)}</Text>;
	}
}

function tokenStyle(token: CodeToken): TextStyle | undefined {
	if (!token.color && !token.italic && !token.bold && !token.underline && !token.strikethrough) {
		return undefined;
	}
	const line = [token.underline && "underline", token.strikethrough && "line-through"]
		.filter(Boolean)
		.join(" ");
	return {
		color: token.color,
		fontStyle: token.italic ? "italic" : undefined,
		fontWeight: token.bold ? "700" : undefined,
		textDecorationLine: line ? (line as TextStyle["textDecorationLine"]) : undefined,
	};
}

/** The colored lines of a block, as nested text in one text node. */
function ColoredCode({ lines }: { lines: CodeToken[][] }) {
	return lines.map((line, i) => (
		<Fragment key={i}>
			{i > 0 ? "\n" : null}
			{line.map((token, j) => {
				const style = tokenStyle(token);
				return style ? (
					<Text key={j} style={style}>
						{token.content}
					</Text>
				) : (
					token.content
				);
			})}
		</Fragment>
	));
}

/** A code fence: line numbers (unless the meta has `noLineNumbers`, and from
 *  `startLine=N`), no wrap, a sideways scroll for long lines, and the syntax
 *  colors of the light or dark mode. */
function CodeBlock({
	value,
	lang,
	meta,
	open,
	ctx,
}: {
	value: string;
	lang: string | null | undefined;
	meta: string;
	open: boolean;
	ctx: Ctx;
}) {
	const { c, scheme } = ctx;
	const lines = value.split("\n");
	const startMatch = /startLine=(\d+)/.exec(meta);
	const start = startMatch ? Math.max(1, Number.parseInt(startMatch[1]!, 10)) : 1;
	const numbered = !/\bnoLineNumbers\b/.test(meta);
	// An open fence changes with each streamed word: color it when it closes.
	const colored = useMemo(
		() => (open ? null : highlightCode(value, lang, scheme)),
		[open, value, lang, scheme],
	);
	const colors = CODE_COLORS[scheme];
	const { copy, state } = useCopy(() => value);
	const code = { fontFamily: MONO, fontSize: 13, lineHeight: 20 };
	return (
		<View
			style={[styles.code, { backgroundColor: colors.bg, borderColor: c.line }]}
			testID={colored ? "md-code-colored" : "md-code"}
		>
			{numbered ? (
				<Text
					style={[code, styles.lineNumbers, { color: c.muted }]}
					onLongPress={copy}
					testID="md-code-lines"
				>
					{lines.map((_, i) => String(start + i)).join("\n")}
				</Text>
			) : null}
			<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeScroll}>
				<CopyTarget onCopy={copy} what="code">
					<Text style={[code, { color: colors.fg }]} testID="md-code-text">
						{colored ? <ColoredCode lines={colored.lines} /> : value}
					</Text>
				</CopyTarget>
			</ScrollView>
			<CopyLabel state={state} c={ctx.c} />
		</View>
	);
}

/** Column width from the longest cell, so that the columns line up in every
 *  row. Text wraps inside the width. Wide tables scroll sideways. */
function columnWidths(node: Table, fontSize: number): number[] {
	const widths: number[] = [];
	for (const row of node.children) {
		row.children.forEach((cell, i) => {
			const chars = plainText(cell).length;
			widths[i] = Math.max(widths[i] ?? 0, chars);
		});
	}
	return widths.map((chars) =>
		Math.min(240, Math.max(56, Math.ceil(chars * fontSize * 0.55) + 16)),
	);
}

function TableBlock({ node, ctx }: { node: Table; ctx: Ctx }) {
	const { c, base } = ctx;
	const widths = columnWidths(node, fontSizeOf(base));
	const { copy, state } = useCopy(() => tableMarkdown(node));
	const align = (i: number): TextStyle["textAlign"] => {
		const a = node.align?.[i];
		return a === "center" ? "center" : a === "right" ? "right" : "left";
	};
	return (
		<View>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} testID="md-table">
				<CopyTarget onCopy={copy} what="table">
					{node.children.map((row, r) => (
						<View
							key={r}
							style={[
								styles.tableRow,
								{
									borderColor: c.line,
									borderBottomWidth: r === 0 ? 1.5 : StyleSheet.hairlineWidth,
								},
							]}
						>
							{row.children.map((cell, i) => (
								<View key={i} style={[styles.cell, { width: widths[i] }]}>
									<Text style={[base, { textAlign: align(i) }, r === 0 ? styles.strong : null]}>
										{inlines(cell.children, ctx)}
									</Text>
								</View>
							))}
						</View>
					))}
				</CopyTarget>
			</ScrollView>
			<CopyLabel state={state} c={ctx.c} />
		</View>
	);
}

// ─── The component ───────────────────────────────────────────────────────────

function collectDefinitions(root: Root): Map<string, Definition> {
	const map = new Map<string, Definition>();
	const walk = (node: Nodes) => {
		if (node.type === "definition") map.set(node.identifier.toLowerCase(), node);
		if ("children" in node) for (const child of node.children as Nodes[]) walk(child);
	};
	walk(root);
	return map;
}

function MarkdownTree({
	text,
	base,
	compact,
}: {
	text: string;
	base: TextStyle;
	compact: boolean;
}) {
	const c = usePalette();
	const scheme: CodeScheme = useColorScheme() === "dark" ? "dark" : "light";
	const root = useMemo(() => parseMarkdown(text), [text]);
	const definitions = useMemo(() => collectDefinitions(root), [root]);
	return <Blocks nodes={root.children} ctx={{ c, scheme, base, compact, definitions }} />;
}

type BoundaryProps = { text: string; base: TextStyle; children: ReactNode };

/** If the drawing throws, show the message as plain text. Never show the
 *  error itself. A new text (the next streaming update) tries again. */
class MarkdownBoundary extends Component<BoundaryProps, { failed: boolean; text: string }> {
	state = { failed: false, text: this.props.text };

	static getDerivedStateFromProps(props: BoundaryProps, state: { failed: boolean; text: string }) {
		return props.text === state.text ? null : { failed: false, text: props.text };
	}

	static getDerivedStateFromError() {
		return { failed: true };
	}

	render() {
		if (this.state.failed) {
			return (
				<Text style={this.props.base} testID="md-plain">
					{this.props.text}
				</Text>
			);
		}
		return this.props.children;
	}
}

/**
 * Draws Markdown text. `style` is the text style of the surface (size, line
 * height, color, weight); headings, code and tables start from it.
 */
export function Markdown({
	text,
	style,
	compact = false,
	testID,
}: {
	text: string;
	style: TextStyle | TextStyle[];
	compact?: boolean;
	testID?: string;
}) {
	const base: TextStyle = StyleSheet.flatten(style) ?? {};
	return (
		<View testID={testID}>
			<MarkdownBoundary text={text} base={base}>
				<MarkdownTree text={text} base={base} compact={compact} />
			</MarkdownBoundary>
		</View>
	);
}

const styles = StyleSheet.create({
	strong: { fontWeight: "700" },
	em: { fontStyle: "italic" },
	del: { textDecorationLine: "line-through" },
	rule: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
	callout: {
		alignSelf: "flex-start",
		maxWidth: "100%",
		borderWidth: 1,
		paddingHorizontal: 14,
		paddingVertical: 10,
	},
	quote: { borderLeftWidth: 4, paddingLeft: 12 },
	item: { flexDirection: "row", gap: 6 },
	marker: { minWidth: 16 },
	itemBody: { flex: 1 },
	code: {
		flexDirection: "row",
		borderRadius: 8,
		borderWidth: StyleSheet.hairlineWidth,
		paddingVertical: 10,
		paddingHorizontal: 10,
	},
	lineNumbers: { textAlign: "right", marginRight: 12, minWidth: 18 },
	codeScroll: { flex: 1 },
	tableRow: { flexDirection: "row" },
	cell: { paddingVertical: 6, paddingRight: 12 },
});
