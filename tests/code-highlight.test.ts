/**
 * Issue 05 slice B: code colors with Shiki (src/lib/code-highlight.ts) and
 * the error states 3 and 4 (docs/ISSUES.md, issue 05).
 */
import * as core from "@shikijs/core";

import {
	CODE_COLORS,
	MAX_CHARS,
	MAX_LINES,
	codeLanguage,
	highlightCode,
	resetCodeHighlighter,
	tooLargeToColor,
} from "@/lib/code-highlight";

afterEach(() => {
	jest.restoreAllMocks();
	resetCodeHighlighter();
});

const colorOf = (lines: { content: string; color?: string }[][], text: string) =>
	lines.flat().find((t) => t.content.trim() === text)?.color;

describe("highlightCode", () => {
	it("colors code with the desktop themes, one line for each line", () => {
		const code = "const x = 1;\n// note";
		const light = highlightCode(code, "js", "light")!;
		const dark = highlightCode(code, "js", "dark")!;
		expect(light.lines).toHaveLength(2);
		expect(
			light.lines
				.flat()
				.map((t) => t.content)
				.join(""),
		).toBe("const x = 1;// note");
		// github-light and github-dark: the keyword and the comment.
		expect(colorOf(light.lines, "const")).toBe("#D73A49");
		expect(colorOf(dark.lines, "const")).toBe("#F97583");
		expect(colorOf(light.lines, "// note")).toBe("#6A737D");
		expect(CODE_COLORS.dark.fg).toBe("#e1e4e8");
	});

	it("reads the fence names and aliases of the bundled languages", () => {
		expect(codeLanguage("Python")).toBe("python");
		expect(codeLanguage(" sh ")).toBe("shellscript");
		expect(codeLanguage("c++")).toBe("cpp");
		expect(codeLanguage("dockerfile")).toBe("docker");
		expect(codeLanguage("")).toBeNull();
		expect(codeLanguage(undefined)).toBeNull();
	});

	it("colors an embedded language (CSS and JavaScript inside HTML)", () => {
		const lines = highlightCode(
			'<style>a { color: red; }</style>\n<p class="x">hi</p>',
			"html",
			"light",
		)!.lines;
		expect(colorOf(lines, "color")).toBe("#005CC5");
		expect(colorOf(lines, "style")).toBe("#22863A");
	});

	it("3. gives null for an unknown language, so the block stays plain", () => {
		expect(highlightCode("x := 1", "klingon", "light")).toBeNull();
		expect(highlightCode("x := 1", undefined, "light")).toBeNull();
	});

	it("4. gives null for a block that is too large, and does not tokenize it", () => {
		const spy = jest.spyOn(core, "createHighlighterCoreSync");
		expect(tooLargeToColor("a".repeat(MAX_CHARS + 1))).toBe(true);
		expect(
			tooLargeToColor(
				Array(MAX_LINES + 1)
					.fill("a")
					.join("\n"),
			),
		).toBe(true);
		expect(tooLargeToColor(Array(MAX_LINES).fill("a").join("\n"))).toBe(false);
		expect(highlightCode("x\n".repeat(MAX_LINES + 5), "js", "light")).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});

	it("4. gives null when the highlighter throws, and does not throw", () => {
		jest.spyOn(core, "createHighlighterCoreSync").mockImplementation(() => {
			throw new Error("engine failed");
		});
		expect(highlightCode("let a = 1", "js", "light")).toBeNull();
	});

	it("keeps the result: the same block in the same mode tokenizes once", () => {
		const first = highlightCode("let a = 1", "ts", "dark");
		expect(highlightCode("let a = 1", "typescript", "dark")).toBe(first);
		expect(highlightCode("let a = 1", "ts", "light")).not.toBe(first);
	});
});
