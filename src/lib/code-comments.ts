/**
 * Issue 05, wide content, the code viewer fit (user choice 2026-11-17,
 * option B). The viewer shows code at 11 pt at the smallest, so a long code
 * line goes past the edge and a drag moves it. A comment line is text: it
 * wraps at its words to the fit width. A comment at the end of a code line
 * stays on that line.
 */

/** Languages with `//` line comments and `/* *\/` block comments. */
const SLASH = new Set([
	"js",
	"jsx",
	"mjs",
	"cjs",
	"javascript",
	"ts",
	"tsx",
	"mts",
	"cts",
	"typescript",
	"c",
	"h",
	"cpp",
	"c++",
	"cc",
	"hpp",
	"cs",
	"csharp",
	"java",
	"kotlin",
	"kt",
	"kts",
	"swift",
	"go",
	"rust",
	"rs",
	"scala",
	"dart",
	"php",
	"objc",
	"objective-c",
	"groovy",
	"zig",
	"jsonc",
	"json5",
	"css",
	"scss",
	"less",
	"proto",
	"glsl",
	"solidity",
]);

/** Languages with `#` line comments. */
const HASH = new Set([
	"py",
	"python",
	"sh",
	"bash",
	"zsh",
	"shell",
	"fish",
	"rb",
	"ruby",
	"yaml",
	"yml",
	"toml",
	"r",
	"perl",
	"pl",
	"make",
	"makefile",
	"dockerfile",
	"nix",
	"elixir",
	"ex",
	"exs",
	"ps1",
	"powershell",
	"conf",
	"ini",
	"gitignore",
	"julia",
	"jl",
	"tcl",
	"cmake",
]);

/** Languages with `--` line comments. */
const DASH = new Set(["sql", "lua", "haskell", "hs", "elm", "ada", "plsql", "psql"]);

type Rules = { line: readonly RegExp[]; block: boolean };

/** With no language or an unknown one: `//`, and `#` with a space after it
 *  (not a `#tag`). */
const FALLBACK: Rules = { line: [/^\/\//, /^#(\s|$)/], block: false };

function rulesFor(lang: string | null | undefined): Rules {
	const name = lang?.trim().toLowerCase() ?? "";
	if (SLASH.has(name)) return { line: [/^\/\//], block: true };
	if (HASH.has(name)) return { line: [/^#/], block: false };
	if (DASH.has(name)) return { line: [/^--/], block: false };
	return FALLBACK;
}

/**
 * For each line: true when the whole line is a comment (its indent, then
 * the comment). The lines inside a block comment are comments too. A line
 * with code before or after the comment is code.
 */
export function commentLines(lines: readonly string[], lang: string | null | undefined): boolean[] {
	const rules = rulesFor(lang);
	let inBlock = false;
	return lines.map((line) => {
		const text = line.trim();
		if (inBlock) {
			const end = text.indexOf("*/");
			if (end === -1) return true;
			inBlock = false;
			return text.slice(end + 2).trim() === "";
		}
		if (text === "") return false;
		if (rules.block && text.startsWith("/*")) {
			const end = text.indexOf("*/", 2);
			if (end === -1) {
				inBlock = true;
				return true;
			}
			return text.slice(end + 2).trim() === "";
		}
		return rules.line.some((re) => re.test(text));
	});
}
