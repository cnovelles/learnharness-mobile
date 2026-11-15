/**
 * Jest global setup: the shared fork code imports packages that ship only
 * ES modules (typebox and others). This Jest setup runs CommonJS, so it
 * cannot load them. Bundle them once into one CommonJS file with the fork's
 * esbuild, and give each import path a small file that takes its part.
 * One bundle keeps one copy of each package, so shared state (for example
 * typebox format registrations) stays shared. package.json maps the import
 * paths here (jest.moduleNameMapper).
 */
/* global __dirname */
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../.cache/esm-cjs");
const FORK = process.env.LH_FORK_DIR
	? path.resolve(process.env.LH_FORK_DIR)
	: path.resolve(__dirname, "../../../learnharness");

/** Import path → file name. Keep in sync with jest.moduleNameMapper. */
const PACKAGES = {
	typebox: "typebox",
	"typebox/compile": "typebox-compile",
	"typebox/format": "typebox-format",
	"typebox/system": "typebox-system",
	"typebox/value": "typebox-value",
	"d3-force": "d3-force",
	"d3-shape": "d3-shape",
	"dagre-d3-es": "dagre-d3-es",
	"dagre-d3-es/src/dagre/index.js": "dagre-d3-es-dagre",
	"mdast-util-from-markdown": "mdast-util-from-markdown",
	"mdast-util-math": "mdast-util-math",
	"micromark-extension-math": "micromark-extension-math",
	"mdast-util-gfm": "mdast-util-gfm",
	"micromark-extension-gfm": "micromark-extension-gfm",
	remend: "remend",
};

module.exports = function buildEsmToCjs() {
	const esbuild = require(path.join(FORK, "node_modules/esbuild"));
	fs.mkdirSync(OUT, { recursive: true });
	const names = Object.entries(PACKAGES);
	const entry = names
		.map(([spec], i) => `export * as m${i} from ${JSON.stringify(spec)};`)
		.join("\n");
	esbuild.buildSync({
		stdin: { contents: entry, resolveDir: FORK, loader: "js" },
		bundle: true,
		format: "cjs",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["import", "default"],
		outfile: path.join(OUT, "bundle.cjs"),
		// katex has a CommonJS build: Jest loads it directly, so keep one copy.
		external: ["katex"],
		logLevel: "error",
	});
	names.forEach(([, file], i) => {
		fs.writeFileSync(
			path.join(OUT, `${file}.cjs`),
			// __esModule lets a default import (remend) find the default export.
			`module.exports = { __esModule: true, ...require("./bundle.cjs").m${i} };\n`,
		);
	});
	buildShiki(esbuild);
	// The island pages of issue 05 slice C (jest.moduleNameMapper: lh-island-pages).
	require("../../scripts/island-pages/build.cjs").buildIslandPages(FORK);
};

/**
 * Shiki (issue 05 slice B) in its own bundle, so that only the code color
 * tests load the grammars. The import paths are `@shikijs/...`; the grammar
 * list comes from the `require` calls in src/lib/code-highlight.ts.
 * package.json maps `^@shikijs/(.*)$` to `shikijs/$1.cjs`.
 */
function buildShiki(esbuild) {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../src/lib/code-highlight.ts"),
		"utf8",
	);
	const langs = [...source.matchAll(/require\("(@shikijs\/langs\/[\w-]+)"\)/g)].map((m) => m[1]);
	const specs = [
		"@shikijs/core",
		"@shikijs/engine-javascript",
		"@shikijs/themes/github-light",
		"@shikijs/themes/github-dark",
		...langs,
	];
	const dir = path.join(OUT, "shikijs");
	fs.mkdirSync(dir, { recursive: true });
	esbuild.buildSync({
		stdin: {
			contents: specs
				.map((spec, i) => `export * as m${i} from ${JSON.stringify(spec)};`)
				.join("\n"),
			resolveDir: FORK,
			loader: "js",
		},
		nodePaths: [path.join(FORK, "node_modules/@streamdown/code/node_modules")],
		bundle: true,
		format: "cjs",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["import", "default"],
		outfile: path.join(dir, "bundle.cjs"),
		logLevel: "error",
	});
	specs.forEach((spec, i) => {
		const file = path.join(OUT, "shikijs", `${spec.slice("@shikijs/".length)}.cjs`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const bundle = path.relative(path.dirname(file), path.join(dir, "bundle.cjs"));
		fs.writeFileSync(
			file,
			`module.exports = { __esModule: true, ...require(${JSON.stringify(`./${bundle}`)}).m${i} };\n`,
		);
	});
}
