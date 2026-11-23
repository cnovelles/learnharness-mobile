/**
 * The WebView pages of the artifacts (issue 19, D-017). Security review:
 * docs/reviews/2026-11-23-artifact-sandbox.md, sections 5 to 7.
 *
 * - The figure page shows the SVG as an image (`<img src="data:…">`), as the
 *   desktop does (fork components/artifacts/svg-image.tsx): scripts in the
 *   SVG never run, and an SVG image loads nothing. The page has no script
 *   source; only the app's injected script runs.
 * - The demo runs in a frame with `sandbox="allow-scripts"` (as the desktop's
 *   iframe): no `allow-modals`, so WebKit blocks `alert`, `confirm` and
 *   `prompt` in the frame and in every frame under it; no
 *   `allow-same-origin`, so the frame has an opaque origin. The frame's own
 *   document starts with our doctype, our CSP (a CSP in the demo can only
 *   add limits) and the lock script, before the first byte of the model
 *   HTML.
 */
import { ARTIFACT_CDN_HOSTS } from "./artifacts";
import { svgImageSource } from "./shared";

const CDN = ARTIFACT_CDN_HOSTS.map((host) => `https://${host}`).join(" ");

export const DEMO_CSP = [
	"default-src 'none'",
	`script-src 'unsafe-inline' 'unsafe-eval' ${CDN}`,
	`style-src 'unsafe-inline' ${CDN}`,
	`font-src data: ${CDN}`,
	"img-src data: blob:",
	"media-src data: blob:",
	"connect-src 'none'",
	"frame-src 'none'",
	"child-src 'none'",
	"worker-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

export const FIGURE_CSP = [
	"default-src 'none'",
	"img-src data:",
	"style-src 'unsafe-inline'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

const meta = (csp: string, viewport: string) =>
	`<meta charset="utf-8">` +
	`<meta http-equiv="Content-Security-Policy" content="${csp}">` +
	`<meta name="viewport" content="${viewport}">`;

const FIXED = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
/** The full-screen viewer: the learner can pinch the page. */
const ZOOM = "width=device-width, initial-scale=1, maximum-scale=6, user-scalable=yes";

const escapeAttr = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The demo page: the app's own page with one sandboxed frame. The frame's
 * document keeps its head open, so the demo's own head elements go into it;
 * the parser ignores the demo's own doctype and `<head>` tag. The white
 * background is the desktop's (the iframe has `bg-white`).
 */
export function demoPage(html: string): string {
	const inner =
		`<!doctype html><html><head>${meta(DEMO_CSP, "width=device-width, initial-scale=1")}` +
		`<script>${DEMO_LOCK_SCRIPT}</script><style>html{background:#fff}</style>` +
		html;
	return (
		`<!doctype html><html><head>${meta(DEMO_CSP, "width=device-width, initial-scale=1")}` +
		`<style>html,body{margin:0;padding:0;height:100%;background:#fff}` +
		`iframe{display:block;border:0;width:100%;height:100%;background:#fff}</style></head>` +
		`<body><iframe sandbox="allow-scripts" srcdoc="${escapeAttr(inner)}"></iframe></body></html>`
	);
}

/**
 * The figure page. `naturalWidth` is the SVG's declared width in px; a
 * narrow figure shows at that width, centered, as on the desktop.
 */
export function figurePage(
	svg: string,
	naturalWidth: number | null,
	{ zoom = false } = {},
): string {
	const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgImageSource(svg))}`;
	const width = naturalWidth !== null ? ` width="${Math.round(naturalWidth)}"` : "";
	const size = naturalWidth !== null ? "width:fit-content;max-width:100%" : "width:100%";
	return (
		`<!doctype html><html><head>${meta(FIGURE_CSP, zoom ? ZOOM : FIXED)}` +
		`<style>html,body{margin:0;padding:0;background:transparent}` +
		`#root{${size};margin:0 auto;background:#fff;border-radius:8px;overflow:hidden}` +
		`img{display:block;max-width:100%;height:auto${naturalWidth !== null ? "" : ";width:100%"}}` +
		`body.zoom{display:flex;min-height:100vh;align-items:center}</style></head>` +
		`<body${zoom ? ' class="zoom"' : ""}><div id="root"><img alt=""${width} src="${src}"></div></body></html>`
	);
}

/**
 * The first script of the demo frame, before the demo's own scripts. It
 * reports page errors to the app's page (`DEMO_SCRIPT` forwards them). As a
 * second layer it also locks `alert`, `confirm` and `prompt` (the sandbox
 * blocks them) and removes WebRTC (the CSP does not cover it). A child
 * frame of the demo gets fresh copies, so this lock alone is not a guard:
 * see the review, section 7.
 */
export const DEMO_LOCK_SCRIPT = `(function () {
	var w = window;
	function lock(name, value) {
		try {
			Object.defineProperty(w, name, { value: value, writable: false, configurable: false });
		} catch (e) {}
	}
	lock("alert", function () {});
	lock("confirm", function () { return false; });
	lock("prompt", function () { return null; });
	["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCRtpSender",
	 "RTCRtpReceiver", "RTCRtpTransceiver", "RTCIceCandidate", "RTCSessionDescription"]
		.forEach(function (name) { lock(name, undefined); });
	var parent = w.parent;
	var seen = {};
	function send(text) {
		text = String(text).slice(0, 2000);
		if (seen[text]) return;
		seen[text] = true;
		try {
			parent.postMessage({ type: "lh-demo-error", text: text }, "*");
		} catch (e) {}
	}
	try {
		w.addEventListener("error", function (event) {
			if (event && event.message) return send(event.message);
			var target = event && event.target;
			var url = target && (target.src || target.href);
			if (url) send("A file did not load: " + url);
		}, true);
		w.addEventListener("unhandledrejection", function (event) {
			var reason = event && event.reason;
			send(reason && reason.message ? reason.message : String(reason));
		});
	} catch (e) {}
})();
`;

/**
 * Runs after the figure or the demo loads: it sets the invert filter from
 * the data and from each data change. The figure also reports its height.
 */
function afterLoadScript(target: "figure" | "demo"): string {
	return `(function () {
	var bridge = window.ReactNativeWebView;
	var root = ${target === "figure" ? 'document.getElementById("root")' : 'document.querySelector("iframe")'};
	function apply(data) {
		if (data && typeof data === "object")
			root.style.filter = data.inverted === true ? "invert(1) hue-rotate(180deg)" : "";
	}
	apply(window.__lhIslandData);
	function onMessage(event) {${
		target === "demo"
			? `
		// The demo frame's error report. Only the frame itself, not a frame under it.
		if (event.source && event.source === root.contentWindow) {
			var m = event.data;
			if (m && m.type === "lh-demo-error" && typeof m.text === "string" && bridge)
				bridge.postMessage(JSON.stringify({ type: "page-error", text: m.text.slice(0, 2000) }));
			return;
		}
		if (event.source) return;`
			: ""
	}
		try { apply(JSON.parse(event.data)); } catch (e) {}
	}
	window.addEventListener("message", onMessage);
	document.addEventListener("message", onMessage);
	${
		target === "figure"
			? `var last = -1;
	function report() {
		var height = Math.ceil(root.getBoundingClientRect().height);
		if (height > 0 && height !== last && bridge) {
			last = height;
			bridge.postMessage(JSON.stringify({ type: "height", height: height }));
		}
	}
	var img = root.querySelector("img");
	img.addEventListener("load", report);
	img.addEventListener("error", function () {
		if (bridge) bridge.postMessage(JSON.stringify({ type: "error", kind: "load" }));
	});
	if (typeof ResizeObserver === "function") new ResizeObserver(report).observe(root);
	if (img.complete) {
		if (img.naturalWidth === 0 && bridge) bridge.postMessage(JSON.stringify({ type: "error", kind: "load" }));
		else report();
	}`
			: ""
	}
})();
true;`;
}

export const FIGURE_SCRIPT = afterLoadScript("figure");
export const DEMO_SCRIPT = afterLoadScript("demo");
