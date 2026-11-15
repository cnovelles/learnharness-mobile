/*
 * Page script of the Mermaid island (issue 05 slice C), after mermaid.min.js
 * and common.js. The chart source comes in as JSON data and goes to
 * `mermaid.render` with `securityLevel: "strict"`, as on the desktop
 * (components/mermaid-render.ts).
 *
 * Messages to the app: {type:"height", height}, {type:"rendered"},
 * {type:"longpress"}, {type:"error", kind} with kind "data", "load" or
 * "parse". The message never has the error text.
 */
var data = readData();
var mermaid = window.mermaid;
if (!data || typeof data.source !== "string") {
	send({ type: "error", kind: "data" });
} else if (!mermaid || typeof mermaid.render !== "function") {
	send({ type: "error", kind: "load" });
} else {
	var root = document.getElementById("root");
	watchLongPress();
	try {
		mermaid.initialize({
			startOnLoad: false,
			fontFamily: "ui-sans-serif, system-ui, sans-serif",
			fontSize: Number(data.fontSize || 16),
			securityLevel: "strict",
			theme: data.theme === "dark" ? "dark" : "default",
		});
		mermaid
			.render("lh-mermaid-" + Date.now().toString(36), data.source)
			.then(function (result) {
				root.innerHTML = result.svg;
				var svg = root.querySelector("svg");
				if (svg) {
					// Natural width, never scaled down: a wide chart scrolls
					// sideways (error state 15), and its text keeps its size.
					var width = parseFloat(svg.style.maxWidth) || svg.getBoundingClientRect().width;
					svg.style.maxWidth = "none";
					svg.style.width = Math.ceil(width) + "px";
					svg.removeAttribute("width");
				}
				watchHeight(root);
				send({ type: "rendered" });
			})
			.catch(function () {
				// Mermaid can leave its error drawing in the body: remove it.
				var stray = document.querySelectorAll("body > :not(#root)");
				for (var i = 0; i < stray.length; i++) stray[i].remove();
				send({ type: "error", kind: "parse" });
			});
	} catch (e) {
		send({ type: "error", kind: "load" });
	}
}
