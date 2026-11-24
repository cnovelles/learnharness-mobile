/**
 * Issue 22 phase B2: the static OrbiTutor website in `website/public/`.
 * The pages load nothing from other hosts, every local link and file
 * exists, demo clips play muted and inline, and every text pair of both
 * color modes passes WCAG AA.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SITE = join(__dirname, "..", "website", "public");
const PAGES = ["index.html", "404.html"];
const html = readFileSync(join(SITE, "index.html"), "utf8");
const css = readFileSync(join(SITE, "style.css"), "utf8");
const headers = readFileSync(join(SITE, "_headers"), "utf8");

function attributes(page: string, name: string): string[] {
	return [...page.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]);
}

/** A local URL as a path in the site folder ("/a.svg" and "a.svg" are the same file). */
function localFile(url: string): string {
	return join(SITE, url.replace(/^\//, "").replace(/[?#].*$/, "") || "index.html");
}

function luminance(hex: string): number {
	const c = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** The `--name: #hex` values of one CSS block. */
function colors(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi))
		out[m[1]] = m[2].toLowerCase();
	return out;
}

const light = colors(
	css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")),
);
const dark = colors(
	css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("*,")),
);

describe.each(PAGES)("the page %s", (name) => {
	const page = readFileSync(join(SITE, name), "utf8");

	it("has no scripts and a strict content security policy", () => {
		expect(page).not.toMatch(/<script/i);
		expect(page).toMatch(/http-equiv="Content-Security-Policy"[^>]*default-src 'none'/);
	});

	it("loads every image, clip, style and icon from its own folder", () => {
		const loaded = [
			...attributes(page, "src"),
			...attributes(page, "srcset"),
			...attributes(page, "poster"),
		];
		const links = [...page.matchAll(/<link [^>]*href="([^"]*)"/g)].map((m) => m[1]);
		expect(loaded.length + links.length).toBeGreaterThan(0);
		for (const url of [...loaded, ...links]) {
			expect(url).not.toMatch(/^(https?:)?\/\//);
			expect(existsSync(localFile(url))).toBe(true);
		}
	});

	it("plays each demo clip muted and inline, with a poster image", () => {
		for (const m of page.matchAll(/<video\b[^>]*>/g)) {
			for (const attr of ["muted", "playsinline", "poster="]) expect(m[0]).toContain(attr);
		}
	});

	it("links out only over HTTPS, with no store or download links", () => {
		const hrefs = [...page.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
		for (const h of hrefs.filter((h) => !h.startsWith("#") && !h.startsWith("/"))) {
			expect(h).toMatch(/^https:\/\//);
			expect(h).not.toMatch(/apps\.apple\.com|testflight|\.dmg$|\.zip$/i);
		}
	});
});

describe("the home page", () => {
	it("points every page anchor at an element on the page", () => {
		const ids = new Set(attributes(html, "id"));
		const anchors = attributes(html, "href").filter((h) => h.startsWith("#"));
		expect(anchors.length).toBeGreaterThan(0);
		for (const a of anchors) expect(ids.has(a.slice(1))).toBe(true);
	});

	it("keeps the AGPL notice and the LearnHarness credit", () => {
		expect(html).toContain("AGPL-3.0-only");
		expect(html).toContain("https://www.gnu.org/licenses/agpl-3.0.html");
		expect(html).toContain("https://github.com/amosblomqvist/learnharness");
		expect(html).toContain("https://learnharness.ai");
		expect(html).toContain("copyright Amos Blomqvist");
	});

	it("links to the author's page with the other projects", () => {
		expect(html).toContain('href="https://www.christiangonzalezlopez.com"');
	});
});

describe("the response headers", () => {
	it("send the same content security policy as the page, plus frame-ancestors", () => {
		const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1];
		const sent = headers.match(/Content-Security-Policy: (.*)/)?.[1];
		expect(meta).toBeDefined();
		expect(sent).toBe(`${meta}; frame-ancestors 'none'`);
	});
});

const TEXT_PAIRS: [string, string][] = [
	["text", "bg"],
	["text", "panel"],
	["text", "badge-bg"],
	["text", "code-bg"],
	["strong", "bg"],
	["strong", "panel"],
	["muted", "bg"],
	["muted", "panel"],
	["accent", "bg"],
	["accent", "panel"],
	["on-primary", "primary"],
	["on-primary", "primary-hover"],
];

describe.each([
	["light", light],
	["dark", dark],
])("the %s colors", (_mode, p) => {
	it.each(TEXT_PAIRS)("%s on %s passes WCAG AA (4.5:1)", (fg, bg) => {
		expect(p[fg]).toBeDefined();
		expect(p[bg]).toBeDefined();
		expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
	});

	it("uses the Grove palette values", () => {
		expect(p.bg).toBe(_mode === "light" ? "#faf9f5" : "#141414");
		expect(p.primary).toBe(_mode === "light" ? "#0b7a4b" : "#2fd08a");
	});
});
