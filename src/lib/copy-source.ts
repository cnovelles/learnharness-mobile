/**
 * The text that a long press on a block copies (issue 05, decision 4): code
 * as text, a table as Markdown, math as TeX. Copy never copies the URL of a
 * blocked image (error state 17): an image becomes its alt text.
 */
import type { PhrasingContent, Table } from "mdast";

import { safeLinkUrl } from "./markdown";

/** Inline Markdown: for a table cell, and for the copy of a math paragraph. */
export function inlineMarkdown(nodes: readonly PhrasingContent[]): string {
	return nodes
		.map((node): string => {
			switch (node.type) {
				case "text":
					return node.value;
				case "strong":
					return `**${inlineMarkdown(node.children)}**`;
				case "emphasis":
					return `*${inlineMarkdown(node.children)}*`;
				case "delete":
					return `~~${inlineMarkdown(node.children)}~~`;
				case "inlineCode":
					return `\`${node.value}\``;
				case "inlineMath":
					return `$${node.value}$`;
				case "link": {
					const label = inlineMarkdown(node.children);
					const url = safeLinkUrl(node.url);
					return url ? `[${label}](${url})` : label;
				}
				case "linkReference":
					return inlineMarkdown(node.children);
				case "image":
				case "imageReference":
					return node.alt ?? "";
				case "break":
					return " ";
				case "html":
					return node.value;
				default:
					return "";
			}
		})
		.join("");
}

const cell = (nodes: readonly PhrasingContent[]) =>
	inlineMarkdown(nodes).replace(/\n/g, " ").replace(/\|/g, "\\|").trim();

/** A GFM table as Markdown, with the alignment row. */
export function tableMarkdown(table: Table): string {
	const rows = table.children.map((row) => row.children.map((c) => cell(c.children)));
	const columns = Math.max(0, ...rows.map((r) => r.length));
	const line = (cells: string[]) =>
		`| ${Array.from({ length: columns }, (_, i) => cells[i] ?? "").join(" | ")} |`;
	const align = Array.from({ length: columns }, (_, i) => {
		const a = table.align?.[i];
		return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
	});
	const [head = [], ...body] = rows;
	return [line(head), line(align), ...body.map(line)].join("\n");
}
