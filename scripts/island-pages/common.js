/*
 * Shared part of the island page scripts (issue 05 slice C). The builder
 * (build.cjs) puts this file and one page script in one function, so the
 * names here are local to the page script.
 */
var bridge = window.ReactNativeWebView;

/** Sends one message to the app as a JSON string. */
function send(message) {
	if (bridge) bridge.postMessage(JSON.stringify(message));
}

/**
 * The data of the island, or null. The app sets it before the page loads
 * (`islandDataScript` in src/components/web-island.tsx).
 */
function readData() {
	var data = window.__lhIslandData;
	return data && typeof data === "object" ? data : null;
}

/** Sends {type:"height"} now and each time the content height changes. */
function watchHeight(root) {
	var last = -1;
	function report() {
		var height = Math.ceil(root.getBoundingClientRect().height);
		if (height !== last) {
			last = height;
			send({ type: "height", height: height });
		}
	}
	if (typeof ResizeObserver === "function") new ResizeObserver(report).observe(root);
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(report);
	report();
}

/**
 * Sends {type:"longpress"} when a touch that did not move ends after 500 ms
 * or more. It fires on touchend, not on a timer: when the transcript takes
 * over a drag, WebKit sends the page no touchmove, touchcancel or touchend
 * (found on the Simulator, 2026-11-15), so a timer would copy during a
 * scroll. React Native cannot see touches over the WebView, so the app
 * cannot detect the long press itself.
 */
function watchLongPress() {
	var start = 0;
	var startX = 0;
	var startY = 0;
	var passive = { passive: true };
	document.addEventListener(
		"touchstart",
		function (event) {
			var touch = event.touches[0];
			start = event.touches.length === 1 ? Date.now() : 0;
			startX = touch.clientX;
			startY = touch.clientY;
		},
		passive,
	);
	document.addEventListener(
		"touchmove",
		function (event) {
			var touch = event.touches[0];
			if (Math.abs(touch.clientX - startX) > 8 || Math.abs(touch.clientY - startY) > 8) start = 0;
		},
		passive,
	);
	document.addEventListener(
		"touchend",
		function () {
			if (start && Date.now() - start >= 500) send({ type: "longpress" });
			start = 0;
		},
		passive,
	);
	document.addEventListener(
		"touchcancel",
		function () {
			start = 0;
		},
		passive,
	);
}

/**
 * The full-screen viewer (issue 05, wide content, slice D): shrink `el` so it
 * fits the screen, in both directions. WebKit's pinch zoom gives the detail.
 */
function fitToScreen(el) {
	var rect = el.getBoundingClientRect();
	var w = Math.max(el.scrollWidth, rect.width);
	var h = Math.max(el.scrollHeight, rect.height);
	if (!(w > 0) || !(h > 0)) return;
	var k = Math.min(1, window.innerWidth / w, window.innerHeight / h);
	if (k < 1) el.style.zoom = String(k);
}

/** Sends {type:"wide", wide} when the content is wider than the page. */
function reportWide(el) {
	send({ type: "wide", wide: el.scrollWidth > el.clientWidth + 1 });
}
