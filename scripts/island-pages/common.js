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

/** The JSON data of the island (`injectedJavaScriptObject`), or null. */
function readData() {
	try {
		var data = JSON.parse(bridge.injectedObjectJson());
		return data && typeof data === "object" ? data : null;
	} catch (e) {
		return null;
	}
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

/** Sends {type:"longpress"} after a 500 ms touch that does not move. */
function watchLongPress() {
	var timer = null;
	var startX = 0;
	var startY = 0;
	function cancel() {
		if (timer) clearTimeout(timer);
		timer = null;
	}
	var passive = { passive: true };
	document.addEventListener(
		"touchstart",
		function (event) {
			var touch = event.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			cancel();
			timer = setTimeout(function () {
				timer = null;
				send({ type: "longpress" });
			}, 500);
		},
		passive,
	);
	document.addEventListener(
		"touchmove",
		function (event) {
			var touch = event.touches[0];
			if (Math.abs(touch.clientX - startX) > 8 || Math.abs(touch.clientY - startY) > 8) cancel();
		},
		passive,
	);
	document.addEventListener("touchend", cancel, passive);
	document.addEventListener("touchcancel", cancel, passive);
}
