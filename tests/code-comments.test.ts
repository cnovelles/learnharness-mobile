/**
 * Issue 05, wide content, the code viewer fit (user choice 2026-11-17,
 * option B): a comment line is text, so it wraps in the viewer. A code line
 * and a comment at the end of a code line stay on one line.
 */
import { commentLines } from "@/lib/code-comments";

const of = (code: string, lang: string | null | undefined) => commentLines(code.split("\n"), lang);

describe("commentLines", () => {
	it("finds // comment lines in a C-family language, with their indent", () => {
		expect(of("// note\nconst a = 1;\n    // inside", "ts")).toEqual([true, false, true]);
		expect(of("// note", "Swift ")).toEqual([true]);
	});

	it("keeps a comment at the end of a code line as code", () => {
		expect(of("const a = 1; // end", "js")).toEqual([false]);
		expect(of("x = 1  # end", "python")).toEqual([false]);
	});

	it("finds the lines of a block comment, and code after its end", () => {
		const code = ["/**", " * Text.", " */", "/* one */", "/* a */ run();", "run();"].join("\n");
		expect(of(code, "tsx")).toEqual([true, true, true, true, false, false]);
	});

	it("uses # for shell, Python and YAML, and -- for SQL and Lua", () => {
		expect(of("# note\necho hi", "bash")).toEqual([true, false]);
		expect(of("# note\nkey: 1", "yaml")).toEqual([true, false]);
		expect(of("-- note\nSELECT 1;", "sql")).toEqual([true, false]);
		expect(of("-- note", "lua")).toEqual([true]);
	});

	it("does not use # in a C-family language (#include is code)", () => {
		expect(of("#include <stdio.h>\n// note", "c")).toEqual([false, true]);
	});

	it("does not use // or -- in a # language", () => {
		expect(of("// path\n-- flag", "sh")).toEqual([false, false]);
	});

	it("with no language or an unknown one, finds // and # with a space", () => {
		expect(of("// note\n# note\n#tag\n-- x\n/* x */", null)).toEqual([
			true,
			true,
			false,
			false,
			false,
		]);
		expect(of("// note", "brainfudge")).toEqual([true]);
	});

	it("does not count an empty line as a comment", () => {
		expect(of("// a\n\n// b", "ts")).toEqual([true, false, true]);
	});
});
