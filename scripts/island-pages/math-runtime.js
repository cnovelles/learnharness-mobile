/*
 * Page script of the math island (issue 05 slice C), after common.js. The
 * app makes the HTML with KaTeX in Hermes and escapes every piece of model
 * text (src/lib/math-html.ts), so this script only puts it in the page,
 * reports the height, and sends link taps and long presses to the app.
 *
 * Data: the first data comes from `window.__lhIslandData`. While a reply
 * streams, the app sends new data with the WebView's `postMessage`, so the
 * page does not load again for each new word.
 *
 * Messages to the app: {type:"height", height}, {type:"link", index},
 * {type:"longpress"}, {type:"wide", wide} (a display formula is wider than
 * the island), {type:"error", kind:"data"}. In the full-screen viewer
 * (`data.viewer`): {type:"rendered"} and no height.
 */
var root = document.getElementById("root");

function apply(data) {
	if (!data || typeof data.html !== "string") return false;
	var style = document.documentElement.style;
	style.setProperty("--fg", String(data.color || "#000"));
	style.setProperty("--accent", String(data.accent || "#06c"));
	style.setProperty("--muted", String(data.muted || "#666"));
	style.setProperty("--code", String(data.code || "#000"));
	style.setProperty("--code-bg", String(data.codeBg || "#eee"));
	style.setProperty("--size", Number(data.fontSize || 16) + "px");
	style.setProperty("--line", Number(data.lineHeight || 24) + "px");
	root.innerHTML = data.html;
	return true;
}

function onAppMessage(event) {
	try {
		apply(JSON.parse(event.data));
	} catch (e) {
		// Not island data: ignore it.
	}
}

var first = readData();
if (!apply(first)) {
	send({ type: "error", kind: "data" });
} else if (first.viewer) {
	// The full-screen viewer: the formula fits the screen; no height.
	fitToScreen(root);
	send({ type: "rendered" });
} else {
	watchHeight(root);
	// A display formula wider than the island gets the expand button.
	var displays = root.querySelectorAll(".katex-display");
	for (var i = 0; i < displays.length; i++) reportWide(displays[i]);
	watchLongPress();
	window.addEventListener("message", onAppMessage);
	document.addEventListener("message", onAppMessage);
	root.addEventListener("click", function (event) {
		var target = event.target;
		while (target && target !== root) {
			if (target.getAttribute && target.getAttribute("data-link") !== null) {
				event.preventDefault();
				send({ type: "link", index: Number(target.getAttribute("data-link")) });
				return;
			}
			target = target.parentNode;
		}
	});
}
