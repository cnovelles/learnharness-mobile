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
	"mdast-util-from-markdown": "mdast-util-from-markdown",
	"mdast-util-math": "mdast-util-math",
	"micromark-extension-math": "micromark-extension-math",
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
			`module.exports = require("./bundle.cjs").m${i};\n`,
		);
	});
};
