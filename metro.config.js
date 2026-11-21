// Metro config: the phone app imports shared code directly from the desktop
// fork (../learnharness): src/core and components/session-core.ts.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const forkRoot = process.env.LH_FORK_DIR
	? path.resolve(process.env.LH_FORK_DIR)
	: path.resolve(projectRoot, "../learnharness");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), forkRoot];
// Shared files find their own packages (typebox, katex, ...) in the fork's
// node_modules. The shared code imports no React, so one React copy stays.
// Shiki (code colors, issue 05 slice B) is the copy that the desktop's
// @streamdown/code uses, with the same version.
config.resolver.nodeModulesPaths = [
	path.resolve(projectRoot, "node_modules"),
	path.resolve(forkRoot, "node_modules"),
	path.resolve(forkRoot, "node_modules/@streamdown/code/node_modules"),
];

// The fork's shared core has two require cycles (native-messages and
// compaction, plugin-questions and plugin-submissions). The phone cannot
// change them. Without this pattern, each dev launch warns, and the warning
// shows a toast that covers the bottom buttons on a small iPhone.
config.resolver.requireCycleIgnorePatterns = [
	...(config.resolver.requireCycleIgnorePatterns ?? []),
	/(^|[/\\])learnharness[/\\]src[/\\]core[/\\]/,
];

// The math and Mermaid island pages (issue 05 slice C), built from the
// fork's KaTeX and Mermaid files into .cache/ (not in git).
const { buildIslandPages } = require("./scripts/island-pages/build.cjs");
const islandPages = buildIslandPages(forkRoot);

const shims = {
	"lh-island-pages": islandPages,
	"node:crypto": path.resolve(projectRoot, "src/shims/node-crypto.ts"),
	crypto: path.resolve(projectRoot, "src/shims/node-crypto.ts"),
};

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
	if (shims[moduleName]) return { type: "sourceFile", filePath: shims[moduleName] };
	return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
