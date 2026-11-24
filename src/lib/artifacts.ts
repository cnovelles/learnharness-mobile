/**
 * Visual and demo artifacts (issue 19, D-018). A sub-agent delivers a figure
 * (SVG) or a demo (HTML and JavaScript) as a steer message with a
 * `data-subagent-artifact` part (fork src/core/view.ts). The desktop draws it
 * in components/artifacts/steer-card.tsx.
 *
 * Both are model output, so this file reads them as untrusted data. Security
 * review: docs/reviews/2026-11-23-artifact-sandbox.md. Error states:
 * docs/ISSUES.md, issue 19.
 */

/** A longer SVG is refused before a WebView starts (error state 3). */
export const MAX_SVG_CHARS = 1_000_000;
/** A longer demo is refused before a WebView starts (error state 3). */
export const MAX_DEMO_CHARS = 2_000_000;
/** The longest error text that goes to the teacher (error state 4). */
export const MAX_ERROR_CHARS = 500;
/** The page cuts its error text to this length; a longer message is not ours. */
const MAX_PAGE_ERROR_CHARS = 2000;

/** The hosts that a demo can load scripts, style sheets and fonts from (D-018). */
export const ARTIFACT_CDN_HOSTS = [
	"cdn.jsdelivr.net",
	"unpkg.com",
	"cdnjs.cloudflare.com",
] as const;

export type ArtifactWhat = "figure" | "demo";

export type Artifact =
	| {
			kind: "figure";
			svg: string;
			inverted: boolean;
			/** A figure on a learner photo: the photo's snapshot id. It has no invert switch. */
			snapshotId: string | null;
	  }
	| { kind: "demo"; title: string; html: string; inverted: boolean }
	| { kind: "failed"; what: ArtifactWhat }
	| { kind: "unreadable"; what: ArtifactWhat }
	| { kind: "too-large"; what: ArtifactWhat }
	| { kind: "blocked-source" }
	| { kind: "mac-only" };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const SNAPSHOT_ID = /^[a-f0-9]{64}$/;

/** The artifact of a `data-subagent-artifact` part. */
export function artifactOf(part: { data?: unknown }): Artifact {
	const data = part.data;
	if (!isObject(data)) return { kind: "mac-only" };
	const inverted = isObject(data.ui) && data.ui.inverted === true;
	const result = data.result;
	if (data.kind === "visual") {
		if (!isObject(result) || typeof result.svg !== "string")
			return { kind: "unreadable", what: "figure" };
		if (result.svg.length === 0) return { kind: "failed", what: "figure" };
		if (result.svg.length > MAX_SVG_CHARS) return { kind: "too-large", what: "figure" };
		if (result.image === undefined)
			return { kind: "figure", svg: result.svg, inverted, snapshotId: null };
		const id = isObject(result.image) ? result.image.snapshotId : undefined;
		if (typeof id !== "string" || !SNAPSHOT_ID.test(id))
			return { kind: "unreadable", what: "figure" };
		// A photo never inverts (the desktop shows no switch).
		return { kind: "figure", svg: result.svg, inverted: false, snapshotId: id };
	}
	if (data.kind === "demo") {
		if (!isObject(result) || typeof result.html !== "string" || typeof result.title !== "string")
			return { kind: "unreadable", what: "demo" };
		if (result.html.length === 0) return { kind: "failed", what: "demo" };
		if (result.html.length > MAX_DEMO_CHARS) return { kind: "too-large", what: "demo" };
		if (blockedSources(result.html).length > 0) return { kind: "blocked-source" };
		return { kind: "demo", title: result.title, html: result.html, inverted };
	}
	return { kind: "mac-only" };
}

/** The host of an absolute or protocol-relative URL that the CSP blocks, or null. */
function blockedHost(url: string): string | null {
	const match = /^\s*(https?:)?\/\/([^/?#\s"'`]+)/i.exec(url);
	if (!match) return null;
	const scheme = (match[1] ?? "https:").toLowerCase();
	const host = match[2]!.toLowerCase();
	const allowed = scheme === "https:" && (ARTIFACT_CDN_HOSTS as readonly string[]).includes(host);
	return allowed ? null : host;
}

/**
 * The hosts of the scripts, module imports and style sheets in a demo that
 * the demo CSP blocks (error state 9). The CSP is the guard; this check only
 * gives a clear message in place of a broken demo. URLs that a script builds
 * at run time are not found here.
 */
export function blockedSources(html: string): string[] {
	const urls: string[] = [];
	const attr = (re: RegExp) => {
		for (const m of html.matchAll(re)) urls.push(m[1] ?? m[2] ?? m[3] ?? "");
	};
	// <script src=…>
	attr(/<script\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
	// <link rel=stylesheet href=…> (any <link> with a URL that loads)
	for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
		if (!/\brel\s*=\s*["']?[^"'>]*\b(stylesheet|preload|modulepreload)\b/i.test(tag[0])) continue;
		const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
		if (href) urls.push(href[1] ?? href[2] ?? href[3] ?? "");
	}
	// Inside scripts: import … from "url", import "url", import("url").
	for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
		const body = script[1]!;
		for (const m of body.matchAll(
			/\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?\(?\s*["'`]([^"'`]+)["'`]/g,
		))
			urls.push(m[1]!);
	}
	// Inside style sheets: @import url(…) and @import "…".
	for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
		for (const m of style[1]!.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi))
			urls.push(m[1]!);
	}
	const hosts = urls.map(blockedHost).filter((h): h is string => h !== null);
	return [...new Set(hosts)];
}

export type DemoMessage = { type: "page-error"; text: string };

/** A message from a demo page, or null for anything that is not one (error state 12). */
export function parseDemoMessage(raw: unknown): DemoMessage | null {
	if (typeof raw !== "string" || raw.length > MAX_PAGE_ERROR_CHARS + 100) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isObject(value) || value.type !== "page-error") return null;
	if (Object.keys(value).length !== 2) return null;
	const text = value.text;
	if (typeof text !== "string" || text.length > MAX_PAGE_ERROR_CHARS) return null;
	return { type: "page-error", text };
}

/** Control characters and line or paragraph separators become one space. */
const clean = (text: string) =>
	text
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * The text that "Send to teacher" sends (error state 4): the desktop's
 * sentence (demo-card.tsx), with the title and the error cleaned and the
 * error cut to MAX_ERROR_CHARS. The learner does not see the raw error.
 */
export function demoErrorText(title: string, error: string): string {
	const shortTitle = clean(title).slice(0, 120);
	return `The demo "${shortTitle}" threw an error: ${clean(error).slice(0, MAX_ERROR_CHARS)}`;
}

export type ImageSnapshot = {
	mimeType: "image/png" | "image/jpeg";
	data: string;
	width: number;
	height: number;
};

/** The Mac's image snapshot, checked as the desktop does (use-image-snapshot.ts), or null. */
export function parseImageSnapshot(value: unknown): ImageSnapshot | null {
	if (!isObject(value)) return null;
	const { mimeType, data, width, height } = value;
	if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
	// Base64 only: the data goes into an attribute of the SVG.
	if (typeof data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
	const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
	if (!whole(width) || !whole(height)) return null;
	return { mimeType, data, width, height };
}

const SVG_ROOT = /<svg\b[^>]*>/i;

const attrOf = (tag: string, name: string): string | null => {
	const m = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
	return m ? m[1]!.trim() : null;
};

const px = (value: string | null): number | null => {
	if (value === null) return null;
	const m = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
	if (!m) return null;
	const n = Number.parseFloat(m[1]!);
	return Number.isFinite(n) && n > 0 ? n : null;
};

/** The root's declared width in px, or null (the desktop's `svgNaturalWidth`). */
export function svgNaturalWidth(svg: string): number | null {
	const root = SVG_ROOT.exec(svg);
	return root ? px(attrOf(root[0], "width")) : null;
}

/** Height over width, from the root's viewBox, or else from its width and height in px. */
export function svgAspect(svg: string): number | null {
	const root = SVG_ROOT.exec(svg);
	if (!root) return null;
	const box = attrOf(root[0], "viewBox");
	if (box) {
		const parts = box.split(/[\s,]+/).map(Number);
		if (parts.length === 4 && parts.every(Number.isFinite) && parts[2]! > 0 && parts[3]! > 0)
			return parts[3]! / parts[2]!;
		return null;
	}
	const w = px(attrOf(root[0], "width"));
	const h = px(attrOf(root[0], "height"));
	return w && h ? h / w : null;
}
