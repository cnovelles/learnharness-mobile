/**
 * Issue 19: the artifact pages and the lock script (src/lib/artifact-html.ts)
 * and the WebView load rule. Security review:
 * docs/reviews/2026-11-23-artifact-sandbox.md, sections 5 to 7.
 */
import { runInNewContext } from "node:vm";

import { allowIslandLoad } from "@/components/web-island";
import {
	DEMO_CSP,
	DEMO_LOCK_SCRIPT,
	DEMO_SCRIPT,
	FIGURE_CSP,
	demoPage,
	figurePage,
} from "@/lib/artifact-html";

const cspOf = (page: string) =>
	/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1];

/** The inner document of the demo page (the sandboxed frame's srcdoc). */
const innerOf = (page: string) => {
	const m = /<iframe sandbox="allow-scripts" srcdoc="([^"]*)"><\/iframe>/.exec(page);
	expect(m).not.toBeNull();
	return m![1]!
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&");
};

describe("demoPage", () => {
	it("runs the demo in a frame with the scripts-only sandbox (no modals, no same origin)", () => {
		const page = demoPage("<p>x</p>");
		expect(cspOf(page)).toBe(DEMO_CSP);
		expect(page.match(/<iframe /g)).toHaveLength(1);
		expect(page).toContain('<iframe sandbox="allow-scripts" srcdoc="');
	});

	it("puts its own CSP and the lock script before the first byte of the model HTML", () => {
		const html =
			'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>"&<x></body></html>';
		const inner = innerOf(demoPage(html));
		expect(inner.endsWith(html)).toBe(true);
		const head = inner.slice(0, inner.length - html.length);
		expect(head.startsWith("<!doctype html>")).toBe(true);
		expect(cspOf(head)).toBe(DEMO_CSP);
		expect(head).toContain(`<script>${DEMO_LOCK_SCRIPT}</script>`);
		// The first CSP in the frame is ours.
		expect(cspOf(inner)).toBe(DEMO_CSP);
	});

	it("keeps the model HTML inside the srcdoc attribute", () => {
		const page = demoPage('"></iframe><script>top.x()</script>');
		expect(page).not.toContain("<script>top.x()");
		expect(page.match(/<\/iframe>/g)).toHaveLength(1);
	});

	it("allows only inline code and the 3 CDN hosts", () => {
		const d = Object.fromEntries(
			DEMO_CSP.split(";").map((s) => {
				const [k, ...v] = s.trim().split(/\s+/);
				return [k, v.join(" ")];
			}),
		);
		const cdn = "https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com";
		expect(d).toEqual({
			"default-src": "'none'",
			"script-src": `'unsafe-inline' 'unsafe-eval' ${cdn}`,
			"style-src": `'unsafe-inline' ${cdn}`,
			"font-src": `data: ${cdn}`,
			"img-src": "data: blob:",
			"media-src": "data: blob:",
			"connect-src": "'none'",
			"frame-src": "'none'",
			"child-src": "'none'",
			"worker-src": "'none'",
			"base-uri": "'none'",
			"form-action": "'none'",
		});
	});
});

describe("figurePage", () => {
	it("draws the SVG as an image, with no script source", () => {
		const page = figurePage('<svg viewBox="0 0 10 10"><text>"</text></svg>', null);
		expect(cspOf(page)).toBe(FIGURE_CSP);
		expect(FIGURE_CSP).not.toMatch(/script-src|connect-src [^']/);
		expect(FIGURE_CSP).toContain("default-src 'none'");
		const src = /<img [^>]*src="([^"]+)"/.exec(page)![1]!;
		expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
		// The desktop's display repair adds the namespace.
		expect(decodeURIComponent(src.split(",")[1]!)).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	it("keeps model text out of the page markup", () => {
		const page = figurePage('<svg><text>"></img><script>x()</script></text></svg>', 240);
		expect(page).not.toContain("<script>");
		expect(page).not.toContain("x()</");
		expect(page).toContain('width="240"');
	});
});

/** Runs the lock script in a fake page and returns the page. */
function lockedPage() {
	const sent: unknown[] = [];
	const listeners: Record<string, ((e: unknown) => void)[]> = {};
	const original = { alert: jest.fn(), confirm: jest.fn(() => true), prompt: jest.fn(() => "pw") };
	const page: Record<string, unknown> = {
		...original,
		RTCPeerConnection: function RTCPeerConnection() {},
		webkitRTCPeerConnection: function webkit() {},
		RTCDataChannel: function channel() {},
		// The frame's parent: the app's own page (DEMO_SCRIPT forwards the message).
		parent: { postMessage: (m: unknown, origin: string) => sent.push([m, origin]) },
		addEventListener: (type: string, fn: (e: unknown) => void) => {
			(listeners[type] ??= []).push(fn);
		},
	};
	page.window = page;
	runInNewContext(DEMO_LOCK_SCRIPT, page);
	const fire = (type: string, event: unknown) => listeners[type]?.forEach((fn) => fn(event));
	return { page, sent, fire, original };
}

describe("DEMO_LOCK_SCRIPT", () => {
	it("turns off the native alert, confirm and prompt panels", () => {
		const { page, original } = lockedPage();
		expect((page.alert as () => unknown)()).toBeUndefined();
		expect((page.confirm as () => unknown)()).toBe(false);
		expect((page.prompt as () => unknown)()).toBeNull();
		expect(original.alert).not.toHaveBeenCalled();
		expect(original.prompt).not.toHaveBeenCalled();
		// The page cannot put them back.
		page.prompt = () => "again";
		expect((page.prompt as () => unknown)()).toBeNull();
	});

	it("removes WebRTC", () => {
		const { page } = lockedPage();
		expect(page.RTCPeerConnection).toBeUndefined();
		expect(page.webkitRTCPeerConnection).toBeUndefined();
		expect(page.RTCDataChannel).toBeUndefined();
		page.RTCPeerConnection = function back() {};
		expect(page.RTCPeerConnection).toBeUndefined();
	});

	it("reports a page error, cut to 2000 characters", () => {
		const { sent, fire } = lockedPage();
		fire("error", { message: "x is not defined" });
		fire("error", { message: "y".repeat(3000) });
		fire("unhandledrejection", { reason: { message: "async fail" } });
		// A resource that does not load (a CDN file offline): no message text.
		fire("error", { target: { src: "https://cdn.jsdelivr.net/npm/d3" } });
		expect(sent.every((s) => (s as [unknown, string])[1] === "*")).toBe(true);
		const messages = sent.map((s) => (s as [{ type: string; text: string }])[0]);
		expect(messages[0]).toEqual({ type: "lh-demo-error", text: "x is not defined" });
		expect(messages[1]!.text).toHaveLength(2000);
		expect(messages[2]).toEqual({ type: "lh-demo-error", text: "async fail" });
		expect(messages[3]).toEqual({
			type: "lh-demo-error",
			text: "A file did not load: https://cdn.jsdelivr.net/npm/d3",
		});
	});

	it("sends one message for each error text only once", () => {
		const { sent, fire } = lockedPage();
		fire("error", { message: "same" });
		fire("error", { message: "same" });
		expect(sent).toHaveLength(1);
	});
});

describe("allowIslandLoad", () => {
	it("allows only the page's own load and srcdoc frames", () => {
		expect(allowIslandLoad("about:blank")).toBe(true);
		expect(allowIslandLoad("about:blank", true)).toBe(true);
		expect(allowIslandLoad("about:blank", false)).toBe(false);
		// The demo's own sandboxed frame (srcdoc): no fetch, no network.
		expect(allowIslandLoad("about:srcdoc", false)).toBe(true);
		expect(allowIslandLoad("about:srcdoc", true)).toBe(false);
		expect(allowIslandLoad("https://cdn.jsdelivr.net/", true)).toBe(false);
		expect(allowIslandLoad("https://example.com/", false)).toBe(false);
	});
});

describe("DEMO_SCRIPT", () => {
	/** Runs the app's after-load script in a fake outer page with one frame. */
	function outerPage() {
		const sent: string[] = [];
		const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
		const frameWindow = {};
		const frame = { contentWindow: frameWindow, style: { filter: "" } };
		const page: Record<string, unknown> = {
			ReactNativeWebView: { postMessage: (s: string) => sent.push(s) },
			__lhIslandData: { inverted: true },
			addEventListener: (_type: string, fn: (e: { source: unknown; data: unknown }) => void) =>
				listeners.push(fn),
		};
		page.window = page;
		page.document = {
			querySelector: () => frame,
			addEventListener: () => {},
			documentElement: {},
		};
		runInNewContext(DEMO_SCRIPT, page);
		const fire = (source: unknown, data: unknown) =>
			listeners.forEach((fn) => fn({ source, data }));
		return { sent, fire, frame, frameWindow };
	}

	it("forwards the frame's error message, and nothing from other sources", () => {
		const { sent, fire, frameWindow } = outerPage();
		fire(frameWindow, { type: "lh-demo-error", text: "boom" });
		fire({}, { type: "lh-demo-error", text: "from a nested frame" });
		fire(frameWindow, { type: "other" });
		fire(frameWindow, { type: "lh-demo-error", text: 3 });
		expect(sent.map((s) => JSON.parse(s))).toEqual([{ type: "page-error", text: "boom" }]);
	});

	it("inverts the frame from the data and from each app message", () => {
		const { fire, frame } = outerPage();
		expect(frame.style.filter).toBe("invert(1) hue-rotate(180deg)");
		fire(null, JSON.stringify({ inverted: false }));
		expect(frame.style.filter).toBe("");
	});
});
