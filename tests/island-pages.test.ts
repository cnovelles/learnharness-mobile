/**
 * Issue 05 slice C: the island pages come from the fork's own KaTeX and
 * Mermaid files, and they have no script and no network (error state 12).
 */
import fs from "node:fs";
import path from "node:path";

import * as pages from "lh-island-pages";

const FORK = path.resolve(__dirname, "../../learnharness/node_modules");
const version = (name: string) =>
	JSON.parse(fs.readFileSync(path.join(FORK, name, "package.json"), "utf8")).version;

describe("island pages", () => {
	it("use the fork's KaTeX and Mermaid versions", () => {
		expect(pages.KATEX_VERSION).toBe(version("katex"));
		expect(pages.MERMAID_VERSION).toBe(version("mermaid"));
		expect(require("katex").version).toBe(pages.KATEX_VERSION);
	});

	it("12. have a CSP with no script source and no network source", () => {
		for (const html of [pages.MATH_HTML, pages.MERMAID_HTML]) {
			const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
			expect(csp).toBeDefined();
			expect(csp).toMatch(/^default-src 'none';/);
			expect(csp).not.toMatch(/script-src|connect-src|https?:|\*/);
			expect(html).not.toMatch(/<script|<iframe|<link|<base/i);
		}
	});

	it("12. load every KaTeX font from a data URI", () => {
		const fonts = pages.MATH_HTML.match(/url\(data:font\/woff2;base64,/g) ?? [];
		expect(fonts).toHaveLength(20);
		expect(pages.MATH_HTML).not.toMatch(/url\((?!data:)/);
	});

	it("put Mermaid and the page scripts in the injected script, not in the page", () => {
		expect(pages.MERMAID_SCRIPT.length).toBeGreaterThan(1_000_000);
		expect(pages.MERMAID_SCRIPT).toContain('globalThis["mermaid"]');
		expect(pages.MERMAID_SCRIPT).toContain('securityLevel: "strict"');
		for (const script of [pages.MATH_SCRIPT, pages.MERMAID_SCRIPT]) {
			expect(script.trimEnd().endsWith("true;")).toBe(true);
			// Hermes keeps a string with one non-ASCII character as UTF-16 (double size).
			expect(script).toMatch(/^[\x00-\x7f]*$/);
		}
	});
});
