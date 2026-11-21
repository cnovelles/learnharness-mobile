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

test("native network code is only in the two audited files", () => {
	// docs/TRANSPORT-SECURITY.md: the pinned session to the Mac, and the
	// Deepgram socket (issue 07). A new native path needs an audit first.
	const allowed = new Set([
		"modules/pinned-fetch/ios/PinnedSession.swift",
		"modules/dictation/ios/DeepgramRun.swift",
	]);
	const root = path.join(__dirname, "..");
	const network = /URLSession\(|URLSession\.shared|NWConnection|CFStreamCreate|nw_connection/;
	const found: string[] = [];
	for (const module of fs.readdirSync(path.join(root, "modules"))) {
		const ios = path.join(root, "modules", module, "ios");
		if (!fs.existsSync(ios)) continue;
		for (const file of fs.readdirSync(ios)) {
			if (!file.endsWith(".swift")) continue;
			const rel = `modules/${module}/ios/${file}`;
			if (network.test(fs.readFileSync(path.join(ios, file), "utf8"))) found.push(rel);
		}
	}
	expect(found.sort()).toEqual([...allowed].sort());
});

test("the Deepgram socket goes only to Deepgram's host, with the system's certificate check", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "modules/dictation/ios/DeepgramRun.swift"),
		"utf8",
	);
	expect(source).toContain('public static let host = "api.deepgram.com"');
	expect(source).toContain('parts.scheme = "wss"');
	// A challenge for another host is refused; Deepgram's gets the default (system) trust.
	expect(source).toMatch(
		/protectionSpace\.host == allowedHost[\s\S]*cancelAuthenticationChallenge/,
	);
	expect(source).toContain(".performDefaultHandling");
	// The app's only public way in takes a language, not a URL.
	expect(source).toMatch(/public convenience init\(\s*language: String, token: String/);
	expect(source).not.toMatch(/public (convenience )?init\(\s*url:/);
});
