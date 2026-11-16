/**
 * Transport security (docs/TRANSPORT-SECURITY.md): the ATS policy comes from
 * one config plugin, and the policy that app.json picks gives the Info.plist
 * that the pinned transport needs.
 */
import fs from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../plugins/with-transport-security");

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app.json"), "utf8")).expo;

/** iOS ignores NSAllowsArbitraryLoads when one of these keys is present. */
const CANCELS_ARBITRARY_LOADS = [
	"NSAllowsLocalNetworking",
	"NSAllowsArbitraryLoadsInWebContent",
	"NSAllowsArbitraryLoadsForMedia",
	"NSExceptionDomains",
];

function pluginEntry(): [string, { policy: string }] {
	const entry = appJson.plugins.find(
		(p: unknown) => Array.isArray(p) && p[0] === "./plugins/with-transport-security",
	);
	expect(entry).toBeDefined();
	return entry;
}

test("app.json sets the ATS policy only through the plugin", () => {
	const [, options] = pluginEntry();
	expect(plugin.POLICIES).toContain(options.policy);
	expect(appJson.ios.infoPlist.NSAppTransportSecurity).toBeUndefined();
});

test("the pinned policy turns ATS off with no key that cancels it", () => {
	const ats = plugin.transportSecurity("pinned");
	expect(ats).toEqual({ NSAllowsArbitraryLoads: true });
	for (const key of CANCELS_ARBITRARY_LOADS) expect(ats).not.toHaveProperty(key);
});

test("the local-only policy keeps ATS on and allows only local networking", () => {
	expect(plugin.transportSecurity("local-only")).toEqual({ NSAllowsLocalNetworking: true });
});

test("an unknown policy stops the build with a clear message", () => {
	expect(() => plugin.transportSecurity("open")).toThrow(/unknown policy "open"/);
});

test("the plugin replaces the whole ATS dictionary in the Info.plist", () => {
	// withInfoPlist adds a mod; run it on a plist that has keys from another policy.
	const config = plugin({ name: "t", slug: "t" }, { policy: "pinned" });
	const mod = config.mods.ios.infoPlist;
	return mod({
		...config,
		modResults: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true }, CFBundleName: "x" },
		modRequest: { platform: "ios", introspect: true },
	}).then((result: { modResults: Record<string, unknown> }) => {
		expect(result.modResults.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true });
		expect(result.modResults.CFBundleName).toBe("x");
	});
});

test("the pinned policy is safe only while app code has no other way to the network", () => {
	const config = require("../eslint.config.js");
	const src = config.find(
		(entry: { files?: string[]; rules?: Record<string, unknown> }) =>
			entry.files?.includes("src/**/*.{ts,tsx}") && entry.rules?.["no-restricted-globals"],
	);
	expect(src).toBeDefined();
	const globals = (src.rules["no-restricted-globals"] as unknown[])
		.slice(1)
		.map((g) => (g as { name: string }).name);
	expect(globals).toEqual(
		expect.arrayContaining(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]),
	);
});
