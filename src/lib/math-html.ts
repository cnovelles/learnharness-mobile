/**
 * The HTML of a math island (issue 05 slice C, decisions 1 and 4). KaTeX
 * runs here in Hermes, as `rehype-katex` runs on the desktop, and the island
 * only shows the result. KaTeX 0.18.2 gives the same HTML on Hermes as on
 * Node (checked 2026-11-15 with scripts/hermes-run).
 *
 * Every piece of model text goes through `escapeHtml` or through KaTeX,
 * which escapes its own output (`trust: false`, so `\href`, `\url` and the
 * HTML commands make no links or attributes). Links get no `href`: the page
 * sends the link's index back to the app, which opens only safe links
 * (error states 6 and 12).
 */
import { renderToString } from "katex";
import type { PhrasingContent } from "mdast";

import { inlineMarkdown } from "./copy-source";
import { safeLinkUrl } from "./markdown";

/** Longer TeX shows as its source: KaTeX time grows with the size. */
export const MAX_TEX_LENGTH = 4000;

const CACHE_SIZE = 256;
const cache = new Map<string, string | null>();

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/**
 * KaTeX HTML for one formula, or null when KaTeX cannot draw it (a parse
 * error, or longer than MAX_TEX_LENGTH). Error state 8.
 */
export function renderTex(tex: string, display: boolean): string | null {
	if (tex.length > MAX_TEX_LENGTH) return null;
	const key = `${display ? "D" : "I"}${tex}`;
	if (cache.has(key)) return cache.get(key)!;
	let html: string | null;
	try {
		html = renderToString(tex, {
			displayMode: display,
			throwOnError: true,
			trust: false,
			// The desktop's default is "warn": it only writes to the console.
			strict: "ignore",
			output: "htmlAndMathml",
		});
	} catch {
		html = null;
	}
	if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
	cache.set(key, html);
	return html;
}

/** The TeX source in mono, for a formula that KaTeX cannot draw. */
function texSource(tex: string, display: boolean): string {
	const text = display ? tex : `$${tex}$`;
	return `<span class="lh-tex">${escapeHtml(text)}</span>`;
}

/** True when the paragraph (or one of its children) has inline math. */
export function hasInlineMath(nodes: readonly PhrasingContent[]): boolean {
	return nodes.some(
		(node) => node.type === "inlineMath" || ("children" in node && hasInlineMath(node.children)),
	);
}

export type MathIsland = {
	html: string;
	/** Safe link URLs; the page sends the index of a tapped link. */
	links: string[];
	/** True when one formula or more show as their TeX source (error state 8). */
	failed: boolean;
	/** What a long press copies. */
	copy: string;
};

type LinkResolver = (identifier: string) => string | undefined;

function phrasing(
	nodes: readonly PhrasingContent[],
	out: { links: string[]; failed: boolean },
	resolve: LinkResolver,
): string {
	return nodes
		.map((node): string => {
			switch (node.type) {
				case "text":
					return escapeHtml(node.value);
				case "strong":
					return `<strong>${phrasing(node.children, out, resolve)}</strong>`;
				case "emphasis":
					return `<em>${phrasing(node.children, out, resolve)}</em>`;
				case "delete":
					return `<del>${phrasing(node.children, out, resolve)}</del>`;
				case "break":
					return "<br>";
				case "inlineCode":
					return `<code>${escapeHtml(node.value)}</code>`;
				case "inlineMath": {
					const html = renderTex(node.value, false);
					if (html !== null) return html;
					out.failed = true;
					return texSource(node.value, false);
				}
				case "link":
				case "linkReference": {
					const label = phrasing(node.children, out, resolve);
					const url = safeLinkUrl(
						node.type === "link" ? node.url : resolve(node.identifier.toLowerCase()),
					);
					if (!url) return label;
					out.links.push(url);
					return `<a data-link="${out.links.length - 1}">${label}</a>`;
				}
				case "image":
				case "imageReference":
					return `<span class="lh-muted">${escapeHtml(
						node.alt ? `[Image blocked: ${node.alt}]` : "[Image blocked]",
					)}</span>`;
				case "footnoteReference":
					return `<span class="lh-sup">${escapeHtml(`[${node.label ?? node.identifier}]`)}</span>`;
				case "html":
					return escapeHtml(node.value);
				default:
					return "";
			}
		})
		.join("");
}

/** A paragraph with inline math: all its text in one island (decision 4). */
export function paragraphIsland(
	nodes: readonly PhrasingContent[],
	resolve: LinkResolver = () => undefined,
): MathIsland {
	const out = { links: [] as string[], failed: false };
	const html = `<p>${phrasing(nodes, out, resolve)}</p>`;
	return { html, links: out.links, failed: out.failed, copy: inlineMarkdown(nodes) };
}

/** A display formula (a `$$` block). */
export function mathBlockIsland(tex: string): MathIsland {
	const html = renderTex(tex, true);
	return {
		html: html ?? `<div>${texSource(tex, true)}</div>`,
		links: [],
		failed: html === null,
		copy: tex,
	};
}
