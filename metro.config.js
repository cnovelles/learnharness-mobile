// Metro config: the phone app imports shared code directly from the desktop
// fork (../learnharness): src/core and components/session-core.ts.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const forkRoot = process.env.LH_FORK_DIR ? path.resolve(process.env.LH_FORK_DIR) : path.resolve(projectRoot, "../learnharness");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), forkRoot];
// Shared files find their own packages (typebox, katex, ...) in the fork's
// node_modules. The shared code imports no React, so one React copy stays.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(forkRoot, "node_modules")];

const shims = {
	"node:crypto": path.resolve(projectRoot, "src/shims/node-crypto.ts"),
	crypto: path.resolve(projectRoot, "src/shims/node-crypto.ts"),
};

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
	if (shims[moduleName]) return { type: "sourceFile", filePath: shims[moduleName] };
	return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
