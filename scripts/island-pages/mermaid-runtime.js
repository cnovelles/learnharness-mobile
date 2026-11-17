/*
 * Page script of the Mermaid island (issue 05 slice C), after mermaid.min.js
 * and common.js. The chart source comes in as JSON data and goes to
 * `mermaid.render` with `securityLevel: "strict"`, as on the desktop
 * (components/mermaid-render.ts).
 *
 * In the full-screen viewer (`data.viewer`), the chart fits the screen in
 * both directions and the page reports no height.
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
					// Fit the width (issue 05, wide content, decision 3): a wide
					// chart shrinks to the island; a narrow one keeps its natural
					// size. The full-screen viewer gives the detail.
					var width = parseFloat(svg.style.maxWidth) || svg.getBoundingClientRect().width;
					svg.style.maxWidth = Math.ceil(width) + "px";
					svg.style.width = "100%";
					svg.style.height = "auto";
					svg.removeAttribute("width");
					svg.removeAttribute("height");
				}
				if (data.viewer) fitToScreen(root);
				else watchHeight(root);
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
