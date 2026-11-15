/**
 * Markdown for the teacher's text (issue 05 slice A): text in, an mdast tree
 * out. The components in src/components/markdown.tsx draw the tree as native
 * views.
 *
 * The parse follows the desktop's Streamdown setup
 * (components/ai-elements/message.tsx in the fork):
 * - `transformMathDelimiters` reads the old `\(…\)` and `\[…\]` math.
 * - `remend` closes Markdown that is not complete while a reply streams
 *   (`**bol` becomes `**bol**`), with `htmlTags: false` as on the desktop.
 * - GFM (tables, strikethrough, task lists, autolinks, footnotes) and dollar
 *   math with single-dollar inline math.
 * - A soft line break stays a line break (the desktop uses remark-breaks).
 *   React Native draws the "\n" in a text node as a line break, so nothing
 *   changes the tree for that.
 *
 * The packages come from the fork's node_modules (metro.config.js,
 * tsconfig.json paths), so the phone parses with the same versions as the
 * desktop.
 */
import type { Blockquote, Code, Nodes, Paragraph, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import remend from "remend";

import { transformMathDelimiters } from "./shared";

declare module "mdast" {
	interface CodeData {
		/** The fence has no closing line yet (a reply that streams). */
		open?: boolean;
	}
}

/** A closing fence line: indent or quote marks, then 3 or more backticks or
 *  tildes. */
const CLOSING_FENCE = /(?:^|\n)[ \t>]*(?:`{3,}|~{3,})[ \t]*$/;

/**
 * Marks each code fence that the text does not close yet. `remend` can add
 * the closing line, and a fence also ends at the end of the text, so the
 * check is on the text before `remend`: a closed fence ends inside it, on a
 * closing line.
 */
function markOpenFences(root: Root, source: string, before: string) {
	const visit = (node: Nodes) => {
		if (node.type === "code") {
			const end = node.position?.end.offset;
			const indented = !/^ {0,3}(?:`{3}|~{3})/.test(
				source.slice(node.position?.start.offset ?? 0, end),
			);
			const closed =
				indented ||
				(end !== undefined && end <= before.length && CLOSING_FENCE.test(source.slice(0, end)));
			if (!closed) (node as Code).data = { ...node.data, open: true };
		}
		if ("children" in node) for (const child of node.children as Nodes[]) visit(child);
	};
	visit(root);
}

export function parseMarkdown(text: string): Root {
	const before = transformMathDelimiters(text);
	const source = remend(before, { htmlTags: false });
	const root = fromMarkdown(source, {
		extensions: [gfm(), math({ singleDollarTextMath: true })],
		mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
	});
	markOpenFences(root, source, before);
	return root;
}

/** Link schemes that the phone opens. Every other link shows as text. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** The URL to open for a link, or null when the phone must not open it. */
export function safeLinkUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	const trimmed = url.trim();
	if (!SAFE_LINK.test(trimmed)) return null;
	try {
		// A malformed address does not open.
		new URL(trimmed);
	} catch {
		return null;
	}
	return trimmed;
}

/** The text of a node and its children, with no Markdown. */
export function plainText(node: Nodes): string {
	if ("value" in node && typeof node.value === "string") return node.value;
	if ("children" in node) return (node.children as Nodes[]).map(plainText).join("");
	return "";
}

/** GitHub alert markers, as on the desktop (`parseAlertMarker` in
 *  components/md-blocks.tsx). The prompt teaches only [!IMPORTANT]; the
 *  renderer accepts all 5 and draws them the same. */
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

/**
 * A quote that starts with an alert marker: the quote's children with the
 * marker line removed. Null for an ordinary quote. The marker never shows
 * as text.
 */
export function alertContent(quote: Blockquote): RootContent[] | null {
	const [first, ...rest] = quote.children;
	if (first?.type !== "paragraph") return null;
	const lead = first.children[0];
	if (lead?.type !== "text" || !ALERT_MARKER.test(lead.value)) return null;
	const leadText = lead.value.replace(ALERT_MARKER, "");
	const children = [
		...(leadText ? [{ ...lead, value: leadText }] : []),
		...first.children.slice(1),
	];
	// A soft break right after the marker leaves a "\n" at the start.
	if (children[0]?.type === "text") {
		children[0] = { ...children[0], value: children[0].value.replace(/^\n/, "") };
		if (!children[0].value) children.shift();
	}
	const paragraph: Paragraph = { ...first, children };
	return paragraph.children.length > 0 ? [paragraph, ...rest] : rest;
}

/**
 * One line of plain text for a closed question's preview: the Markdown signs
 * go, and each block becomes one sentence run. If the parse fails, the text
 * shows as it is.
 */
export function markdownPreview(text: string, max = 90): string {
	let plain: string;
	try {
		plain = parseMarkdown(text)
			.children.filter((n) => n.type !== "definition")
			.map(plainText)
			.join(" ");
	} catch {
		plain = text;
	}
	plain = plain.replace(/\s+/g, " ").trim();
	return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}
