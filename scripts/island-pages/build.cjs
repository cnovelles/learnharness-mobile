/**
 * Builds the two island pages of issue 05 slice C from the fork's own files,
 * so that the phone uses the desktop's KaTeX and Mermaid versions:
 *
 * - The math page: an HTML shell with the KaTeX CSS and its woff2 fonts as
 *   `data:` URIs. The app makes the formula HTML with KaTeX in Hermes.
 * - The Mermaid page: an HTML shell, plus mermaid.min.js as script.
 *
 * Each page has a CSP with no `script-src`, so the page runs no script of its
 * own and loads nothing from the network (error state 12). The app adds the
 * page script with `injectedJavaScript`, which WebKit runs outside the page
 * CSP. The script is never inside the HTML, so no `</script>` or `<!--` text
 * in mermaid.min.js can break the HTML parse.
 *
 * Output: `.cache/island-pages/islands.js` (CommonJS, not in git). Metro
 * (metro.config.js) and Jest (tests/setup/esm-to-cjs.cjs) call this builder,
 * and it builds again only when an input is newer than the output.
 */
/* global __dirname */
const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = path.join(ROOT, ".cache/island-pages");
const OUT = path.join(OUT_DIR, "islands.js");

const CSP =
	"default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; " +
	"base-uri 'none'; form-action 'none'";

const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";

/** The full-screen viewer (issue 05, wide content, slice D): WebKit's own
 *  pinch zoom, up to 4. WebKit draws the vector content again at each zoom. */
const VIEWER_VIEWPORT =
	"width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=4, user-scalable=yes";

/** In the viewer, the content sits in the middle of the screen and the page
 *  can scroll; the page script fits it to the screen (`fitToScreen`). */
const VIEWER_CSS = `
html, body { height: 100%; }
body { overflow: auto; display: flex; touch-action: manipulation; }
#root { margin: auto; }
#root, .katex-display { overflow: visible; }
`;

const MATH_CSS = `
html, body { margin: 0; padding: 0; background: transparent; -webkit-text-size-adjust: 100%;
	-webkit-user-select: none; -webkit-touch-callout: none; }
body { color: var(--fg); font-size: var(--size); line-height: var(--line);
	font-family: -apple-system, system-ui, sans-serif; overflow: hidden; }
#root { overflow-x: auto; overflow-y: hidden; padding: 1px 0; }
p { margin: 0; }
.katex-display { margin: 0; padding: 2px 0; overflow-x: auto; overflow-y: hidden; }
a[data-link] { color: var(--accent); text-decoration: underline; }
code { font-family: Menlo, monospace; font-size: 0.88em; color: var(--code); background: var(--code-bg);
	padding: 0 0.2em; border-radius: 3px; }
.lh-tex { font-family: Menlo, monospace; font-size: 0.88em; color: var(--muted); }
.lh-muted { color: var(--muted); }
.lh-sup { color: var(--accent); font-size: 0.75em; }
`;

const MERMAID_CSS = `
html, body { margin: 0; padding: 0; background: transparent; -webkit-user-select: none;
	-webkit-touch-callout: none; }
body { overflow: hidden; }
#root { overflow-x: auto; overflow-y: hidden; }
#root svg { display: block; margin: 0 auto; }
`;

function shell(css, viewport = VIEWPORT) {
	return (
		'<!DOCTYPE html><html><head><meta charset="utf-8">' +
		`<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
		`<meta name="viewport" content="${viewport}">` +
		`<style>${css}</style></head><body><div id="root"></div></body></html>`
	);
}

/** KaTeX CSS with each font as a woff2 `data:` URI (the woff and ttf copies go). */
function katexCss(katexDir) {
	const css = fs.readFileSync(path.join(katexDir, "dist/katex.min.css"), "utf8");
	let fonts = 0;
	const out = css.replace(/src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g, (_, name) => {
		fonts++;
		const font = fs.readFileSync(path.join(katexDir, "dist/fonts", `${name}.woff2`));
		return `src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")`;
	});
	if (fonts === 0 || /url\(fonts\//.test(out)) {
		throw new Error("island pages: the KaTeX CSS has a font rule that the builder does not know");
	}
	return out;
}

function pageScript(name) {
	const common = fs.readFileSync(path.join(HERE, "common.js"), "utf8");
	const page = fs.readFileSync(path.join(HERE, name), "utf8");
	// `true;` at the end: react-native-webview asks for it after injected code.
	return `(function () {\n${common}\n${page}\n})();\ntrue;\n`;
}

/**
 * Writes each non-ASCII character of a script as a `\uXXXX` escape. Hermes
 * keeps a string with one non-ASCII character as UTF-16, which doubles the
 * 3.5 MB Mermaid script in the app bundle. JavaScript reads the escape as
 * the same character in strings, regular expressions, template literals and
 * names (mermaid.min.js has 78 such characters at 11.17.0).
 */
function asciiOnly(script) {
	return script.replace(
		/[^\x00-\x7f]/g,
		(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

function forkRootDefault() {
	return process.env.LH_FORK_DIR
		? path.resolve(process.env.LH_FORK_DIR)
		: path.resolve(ROOT, "../learnharness");
}

/** Builds the pages if an input is newer than the output. Returns the output path. */
function buildIslandPages(forkRoot = forkRootDefault()) {
	const katexDir = path.join(forkRoot, "node_modules/katex");
	const mermaidDir = path.join(forkRoot, "node_modules/mermaid");
	const inputs = [
		__filename,
		path.join(HERE, "common.js"),
		path.join(HERE, "math-runtime.js"),
		path.join(HERE, "mermaid-runtime.js"),
		path.join(katexDir, "package.json"),
		path.join(katexDir, "dist/katex.min.css"),
		path.join(mermaidDir, "package.json"),
		path.join(mermaidDir, "dist/mermaid.min.js"),
	];
	const newest = Math.max(...inputs.map((file) => fs.statSync(file).mtimeMs));
	if (fs.existsSync(OUT) && fs.statSync(OUT).mtimeMs >= newest) return OUT;

	const katexVersion = JSON.parse(
		fs.readFileSync(path.join(katexDir, "package.json"), "utf8"),
	).version;
	const mermaidVersion = JSON.parse(
		fs.readFileSync(path.join(mermaidDir, "package.json"), "utf8"),
	).version;
	const mermaid = fs.readFileSync(path.join(mermaidDir, "dist/mermaid.min.js"), "utf8");
	const pages = {
		KATEX_VERSION: katexVersion,
		MERMAID_VERSION: mermaidVersion,
		MATH_HTML: shell(katexCss(katexDir) + MATH_CSS),
		MATH_SCRIPT: pageScript("math-runtime.js"),
		MERMAID_HTML: shell(MERMAID_CSS),
		MATH_VIEWER_HTML: shell(katexCss(katexDir) + MATH_CSS + VIEWER_CSS, VIEWER_VIEWPORT),
		MERMAID_VIEWER_HTML: shell(MERMAID_CSS + VIEWER_CSS, VIEWER_VIEWPORT),
		MERMAID_SCRIPT: asciiOnly(`${mermaid}\n;${pageScript("mermaid-runtime.js")}`),
	};
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const body =
		"// Generated by scripts/island-pages/build.cjs. Do not edit.\n" +
		Object.entries(pages)
			.map(([key, value]) => `exports.${key} = ${JSON.stringify(value)};`)
			.join("\n") +
		"\n";
	const tmp = `${OUT}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, body);
	fs.renameSync(tmp, OUT);
	return OUT;
}

module.exports = { buildIslandPages, pageScript, OUT, CSP, VIEWER_VIEWPORT };

if (require.main === module) {
	console.log(buildIslandPages());
}
