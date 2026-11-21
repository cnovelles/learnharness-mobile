/**
 * Syntax colors for code fences (issue 05 slice B), as on the desktop:
 * Shiki with the JavaScript regex engine (`forgiving: true`) and the themes
 * `github-light` and `github-dark` (Streamdown's `CodeBlock` in the fork).
 *
 * The Shiki packages come from the fork's node_modules (the copy that
 * `@streamdown/code` uses, see metro.config.js), so the phone colors code
 * with the same versions as the desktop.
 *
 * Differences from the desktop:
 * - A fixed list of languages (`LANGUAGES`). Each grammar loads the first
 *   time a block needs it. A language that is not in the list shows as a
 *   plain block.
 * - Hermes needs the matchAll shim (src/shims/match-all.ts). Hermes has no
 *   `v` RegExp flag, so a few regexes (mostly Haskell) are skipped, and 3 of
 *   the bundled grammars color some tokens differently (checked 2026-11-14).
 * - Large blocks show as plain blocks (`MAX_CHARS`, `MAX_LINES`): the
 *   highlighter runs on the JavaScript thread, and the app must not freeze.
 *
 * Every failure gives `null`, and the caller draws a plain block.
 */
import {
	createHighlighterCoreSync,
	type HighlighterCore,
	type LanguageRegistration,
	type ThemedToken,
	type ThemeRegistration,
} from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

export type CodeScheme = "light" | "dark";

const THEME: Record<CodeScheme, string> = { light: "github-light", dark: "github-dark" };

type Grammar = () => LanguageRegistration[];

/* eslint-disable @typescript-eslint/no-require-imports -- Each grammar loads
   when a block first needs it. A static import parses all of them at start. */
/** The bundled languages: Shiki id, the grammar, and the fence names. */
const LANGUAGES: readonly (readonly [string, Grammar, readonly string[]])[] = [
	["javascript", () => require("@shikijs/langs/javascript").default, ["js", "cjs", "mjs"]],
	["typescript", () => require("@shikijs/langs/typescript").default, ["ts", "cts", "mts"]],
	["jsx", () => require("@shikijs/langs/jsx").default, []],
	["tsx", () => require("@shikijs/langs/tsx").default, []],
	["json", () => require("@shikijs/langs/json").default, []],
	["jsonc", () => require("@shikijs/langs/jsonc").default, []],
	["python", () => require("@shikijs/langs/python").default, ["py"]],
	[
		"shellscript",
		() => require("@shikijs/langs/shellscript").default,
		["bash", "sh", "shell", "zsh"],
	],
	["shellsession", () => require("@shikijs/langs/shellsession").default, ["console"]],
	["powershell", () => require("@shikijs/langs/powershell").default, ["ps", "ps1"]],
	["html", () => require("@shikijs/langs/html").default, []],
	["css", () => require("@shikijs/langs/css").default, []],
	["java", () => require("@shikijs/langs/java").default, []],
	["c", () => require("@shikijs/langs/c").default, []],
	["cpp", () => require("@shikijs/langs/cpp").default, ["c++"]],
	["csharp", () => require("@shikijs/langs/csharp").default, ["c#", "cs"]],
	["go", () => require("@shikijs/langs/go").default, []],
	["rust", () => require("@shikijs/langs/rust").default, ["rs"]],
	["swift", () => require("@shikijs/langs/swift").default, []],
	["kotlin", () => require("@shikijs/langs/kotlin").default, ["kt", "kts"]],
	["sql", () => require("@shikijs/langs/sql").default, []],
	["yaml", () => require("@shikijs/langs/yaml").default, ["yml"]],
	["toml", () => require("@shikijs/langs/toml").default, []],
	["xml", () => require("@shikijs/langs/xml").default, []],
	["markdown", () => require("@shikijs/langs/markdown").default, ["md"]],
	["diff", () => require("@shikijs/langs/diff").default, []],
	["ruby", () => require("@shikijs/langs/ruby").default, ["rb"]],
	["php", () => require("@shikijs/langs/php").default, []],
	["r", () => require("@shikijs/langs/r").default, []],
	["lua", () => require("@shikijs/langs/lua").default, []],
	["latex", () => require("@shikijs/langs/latex").default, []],
	["scala", () => require("@shikijs/langs/scala").default, []],
	["dart", () => require("@shikijs/langs/dart").default, []],
	["haskell", () => require("@shikijs/langs/haskell").default, ["hs"]],
	["julia", () => require("@shikijs/langs/julia").default, ["jl"]],
	["elixir", () => require("@shikijs/langs/elixir").default, []],
	["matlab", () => require("@shikijs/langs/matlab").default, []],
	["graphql", () => require("@shikijs/langs/graphql").default, ["gql"]],
	["ini", () => require("@shikijs/langs/ini").default, ["properties"]],
	["docker", () => require("@shikijs/langs/docker").default, ["dockerfile"]],
	["make", () => require("@shikijs/langs/make").default, ["makefile"]],
	["regexp", () => require("@shikijs/langs/regexp").default, ["regex"]],
];
/* eslint-enable @typescript-eslint/no-require-imports */

const GRAMMARS = new Map<string, { id: string; grammar: Grammar }>();
for (const [id, grammar, aliases] of LANGUAGES) {
	for (const name of [id, ...aliases]) GRAMMARS.set(name, { id, grammar });
}

/** Above these sizes a block shows as a plain block. */
export const MAX_CHARS = 12_000;
export const MAX_LINES = 300;

/** Shiki's own limits for one line: a longer line stays plain, and a line
 *  that takes longer stops in its color and goes on plain. The first line
 *  of a grammar also compiles its regexes, which takes more than Shiki's
 *  default of 500 ms on a slow phone (Hermes has no JIT). */
const MAX_LINE_LENGTH = 1_000;
const LINE_TIME_LIMIT_MS = 2_000;

/** Shiki's font style flags. */
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const STRIKETHROUGH = 8;

export type CodeToken = {
	content: string;
	color?: string;
	italic?: boolean;
	bold?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
};

export type HighlightedCode = { lines: CodeToken[][] };

/** The text color of a code block in each mode (the theme's own color). The
 *  background is the app's `codeBg`, as on the desktop, which puts its own
 *  tint under the Shiki colors (fork app/globals.css, code-block). */
export const CODE_COLORS: Record<CodeScheme, { fg: string }> = {
	light: { fg: "#24292e" },
	dark: { fg: "#e1e4e8" },
};

let highlighter: HighlighterCore | null = null;

function getHighlighter(): HighlighterCore {
	if (highlighter) return highlighter;
	/* eslint-disable @typescript-eslint/no-require-imports -- The theme files
	   have their types in a .d.mts file that tsconfig paths cannot reach. */
	const themes: ThemeRegistration[] = [
		require("@shikijs/themes/github-light").default,
		require("@shikijs/themes/github-dark").default,
	];
	/* eslint-enable @typescript-eslint/no-require-imports */
	highlighter = createHighlighterCoreSync({
		themes,
		langs: [],
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	});
	return highlighter;
}

/** The Shiki id for a fence's language name, or null when it is not bundled. */
export function codeLanguage(lang: string | null | undefined): string | null {
	if (!lang) return null;
	return GRAMMARS.get(lang.trim().toLowerCase())?.id ?? null;
}

function toToken(token: ThemedToken): CodeToken {
	const out: CodeToken = { content: token.content };
	if (token.color) out.color = token.color;
	const style = token.fontStyle ?? 0;
	if (style > 0) {
		if (style & ITALIC) out.italic = true;
		if (style & BOLD) out.bold = true;
		if (style & UNDERLINE) out.underline = true;
		if (style & STRIKETHROUGH) out.strikethrough = true;
	}
	return out;
}

/** True when a block is too large to color. */
export function tooLargeToColor(code: string): boolean {
	if (code.length > MAX_CHARS) return true;
	let lines = 1;
	for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) {
		if (++lines > MAX_LINES) return true;
	}
	return false;
}

/** The last colored blocks. A streaming reply draws its blocks again and
 *  again, and a mode change draws them in the other theme. */
const CACHE_SIZE = 64;
const cache = new Map<string, HighlightedCode | null>();

function remember(key: string, value: HighlightedCode | null) {
	cache.delete(key);
	cache.set(key, value);
	if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Only for tests: start again with no highlighter and no cache. */
export function resetCodeHighlighter() {
	highlighter = null;
	cache.clear();
}

/**
 * The tokens of a code block in the theme of `scheme`, or null for a plain
 * block: an unknown language, a block that is too large, or a highlighter
 * failure. It never throws.
 */
export function highlightCode(
	code: string,
	lang: string | null | undefined,
	scheme: CodeScheme,
): HighlightedCode | null {
	const id = codeLanguage(lang);
	if (!id || tooLargeToColor(code)) return null;
	const key = `${scheme}\u0000${id}\u0000${code}`;
	if (cache.has(key)) {
		const hit = cache.get(key) ?? null;
		remember(key, hit);
		return hit;
	}
	let result: HighlightedCode | null = null;
	try {
		const hl = getHighlighter();
		if (!hl.getLoadedLanguages().includes(id)) hl.loadLanguageSync(GRAMMARS.get(id)!.grammar());
		const { tokens } = hl.codeToTokens(code, {
			lang: id,
			theme: THEME[scheme],
			tokenizeMaxLineLength: MAX_LINE_LENGTH,
			tokenizeTimeLimit: LINE_TIME_LIMIT_MS,
		});
		result = { lines: tokens.map((line) => line.map(toToken)) };
	} catch {
		result = null;
	}
	remember(key, result);
	return result;
}
