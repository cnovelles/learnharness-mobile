/**
 * Issue 05 slice C: the HTML of the math islands. KaTeX runs in the app
 * (decision 1), and every piece of model text is escaped (error state 12).
 */
import {
	hasInlineMath,
	mathBlockIsland,
	MAX_TEX_LENGTH,
	paragraphIsland,
	renderTex,
} from "@/lib/math-html";
import { parseMarkdown } from "@/lib/markdown";
import type { Paragraph } from "mdast";

const paragraph = (text: string) => (parseMarkdown(text).children[0] as Paragraph).children;

describe("renderTex", () => {
	it("gives KaTeX HTML with MathML for inline and display math", () => {
		expect(renderTex("x^2", false)).toMatch(/^<span class="katex">/);
		expect(renderTex("x^2", true)).toMatch(/^<span class="katex-display">/);
		expect(renderTex("x^2", false)).toContain(
			'<annotation encoding="application/x-tex">x^2</annotation>',
		);
	});

	it("8. gives null for a formula that KaTeX cannot draw, or a very long one", () => {
		expect(renderTex("\\frac{1}{", true)).toBeNull();
		expect(renderTex("\\foo{x}", false)).toBeNull();
		expect(renderTex("x".repeat(MAX_TEX_LENGTH + 1), false)).toBeNull();
	});

	it("12. makes no link or attribute from TeX commands (trust is off)", () => {
		const html = renderTex(
			"\\href{javascript:alert(1)}{x} \\url{https://a.b} \\htmlClass{a}{y}",
			false,
		)!;
		// KaTeX shows the commands as red text; the TeX source stays only in
		// the escaped annotation.
		expect(html).not.toMatch(/<a[\s>]/);
		expect(html).not.toContain("href=");
		expect(html).not.toContain('class="a"');
	});
});

describe("paragraphIsland", () => {
	it("puts all the text of a paragraph with inline math in one island", () => {
		const island = paragraphIsland(paragraph("The **pull** is $F = ma$ and `code`, *see*."));
		expect(island.html).toMatch(/^<p>The <strong>pull<\/strong> is <span class="katex">/);
		expect(island.html).toContain("<code>code</code>");
		expect(island.html).toContain("<em>see</em>");
		expect(island.failed).toBe(false);
		expect(island.copy).toBe("The **pull** is $F = ma$ and `code`, *see*.");
	});

	it("12. escapes model text, raw HTML and code", () => {
		const island = paragraphIsland(paragraph('<img src=x onerror="alert(1)"> $x$ `<b>` & "q"'));
		expect(island.html).not.toMatch(/<img|<b>|onerror="/);
		expect(island.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
		expect(island.html).toContain("<code>&lt;b&gt;</code>");
		expect(island.html).toContain("&amp; &quot;q&quot;");
	});

	it("6. gives safe links an index and no href, and shows other links as text", () => {
		const island = paragraphIsland(
			paragraph("$x$ [a](https://a.example) [b](javascript:alert(1)) [c][ref]\n\n[ref]: https://x"),
			(id) => (id === "ref" ? "mailto:c@example.com" : undefined),
		);
		expect(island.links).toEqual(["https://a.example", "mailto:c@example.com"]);
		expect(island.html).toContain('<a data-link="0">a</a>');
		expect(island.html).toContain('<a data-link="1">c</a>');
		expect(island.html).not.toContain("href");
		expect(island.html).not.toContain("javascript");
	});

	it("5. blocks images, as on the desktop", () => {
		const island = paragraphIsland(paragraph("$x$ ![moon](https://x.example/m.png)"));
		expect(island.html).toContain("[Image blocked: moon]");
		expect(island.html).not.toContain("x.example");
	});

	it("8. shows a formula that KaTeX cannot draw as its TeX source, and marks the island", () => {
		const island = paragraphIsland(paragraph("Good $x$ and bad $\\frac{1}{$ here."));
		expect(island.failed).toBe(true);
		expect(island.html).toContain('<span class="lh-tex">$\\frac{1}{$</span>');
		expect(island.html).toContain('<span class="katex">');
	});

	it("finds inline math, also inside bold and links", () => {
		expect(hasInlineMath(paragraph("plain **text**"))).toBe(false);
		expect(hasInlineMath(paragraph("**a $x$ b**"))).toBe(true);
	});
});

describe("mathBlockIsland", () => {
	it("copies the TeX source", () => {
		expect(mathBlockIsland("\\sum_k k")).toMatchObject({ failed: false, copy: "\\sum_k k" });
	});

	it("8. marks a formula that KaTeX cannot draw", () => {
		const island = mathBlockIsland("\\frac{<b>");
		expect(island.failed).toBe(true);
		expect(island.html).toContain("\\frac{&lt;b&gt;");
	});
});
