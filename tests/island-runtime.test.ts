/**
 * Issue 05 slice C: the page scripts of the islands, run in a jsdom window
 * with a fake react-native-webview bridge. The Mermaid tests use a fake
 * `mermaid`. (The jsdom test environment does not run with jest-expo, so
 * each test makes its own window.)
 */
import { JSDOM } from "jsdom";
import { MATH_HTML, MATH_VIEWER_HTML, MERMAID_HTML, MERMAID_VIEWER_HTML } from "lh-island-pages";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pageScript } = require("../scripts/island-pages/build.cjs") as {
	pageScript: (name: string) => string;
};

type Sent = Record<string, unknown>;

let window: JSDOM["window"];
let document: Document;
let pendingMermaid: unknown = null;

function load(html: string, script: string, data: unknown): Sent[] {
	const sent: Sent[] = [];
	const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
	window = dom.window;
	document = window.document;
	const page = window as unknown as Record<string, unknown>;
	page.ReactNativeWebView = {
		postMessage: (message: string) => sent.push(JSON.parse(message)),
	};
	page.__lhIslandData = data;
	if (pendingMermaid) page.mermaid = pendingMermaid;
	window.eval(script);
	return sent;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	pendingMermaid = null;
});

describe("math page script", () => {
	const data = {
		html: '<p>See <a data-link="1">this</a> and <code>x</code></p>',
		color: "#123456",
		fontSize: 18,
	};

	it("puts the HTML in the page, sets the colors and reports the height", () => {
		const sent = load(MATH_HTML, pageScript("math-runtime.js"), data);
		expect(document.getElementById("root")!.innerHTML).toBe(data.html);
		expect(document.documentElement.style.getPropertyValue("--fg")).toBe("#123456");
		expect(document.documentElement.style.getPropertyValue("--size")).toBe("18px");
		expect(sent).toContainEqual({ type: "height", height: 0 });
	});

	it("sends the index of a tapped link and never navigates", () => {
		const sent = load(MATH_HTML, pageScript("math-runtime.js"), data);
		const link = document.querySelector("a")!;
		const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
		link.dispatchEvent(click);
		expect(sent).toContainEqual({ type: "link", index: 1 });
		expect(click.defaultPrevented).toBe(true);
	});

	it("takes new data from the app while a reply streams", () => {
		load(MATH_HTML, pageScript("math-runtime.js"), data);
		window.dispatchEvent(
			new window.MessageEvent("message", { data: JSON.stringify({ ...data, html: "<p>new</p>" }) }),
		);
		expect(document.getElementById("root")!.innerHTML).toBe("<p>new</p>");
		window.dispatchEvent(new window.MessageEvent("message", { data: "not json" }));
		expect(document.getElementById("root")!.innerHTML).toBe("<p>new</p>");
	});

	it("reports a long press when a still touch ends after 500 ms, never on a timer", () => {
		const sent = load(MATH_HTML, pageScript("math-runtime.js"), data);
		const now = jest.spyOn(window.Date, "now");
		const touch = (type: string, x: number, at: number) => {
			now.mockReturnValue(at);
			const event = new window.Event(type) as Event & {
				touches: { clientX: number; clientY: number }[];
			};
			event.touches =
				type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: 0 }];
			document.dispatchEvent(event);
		};
		const pressed = () => sent.filter((m) => m.type === "longpress").length;
		// A hold with no end (the transcript took the drag): nothing.
		touch("touchstart", 0, 1000);
		expect(pressed()).toBe(0);
		// A short tap: nothing.
		touch("touchstart", 0, 5000);
		touch("touchend", 0, 5200);
		expect(pressed()).toBe(0);
		// A hold that moves: nothing.
		touch("touchstart", 0, 6000);
		touch("touchmove", 30, 6100);
		touch("touchend", 30, 6800);
		expect(pressed()).toBe(0);
		// A cancelled hold: nothing.
		touch("touchstart", 0, 7000);
		touch("touchcancel", 0, 7600);
		touch("touchend", 0, 7700);
		expect(pressed()).toBe(0);
		// A still hold of 600 ms: one long press.
		touch("touchstart", 0, 8000);
		touch("touchend", 0, 8600);
		expect(pressed()).toBe(1);
	});

	it("10. reports bad data as an error", () => {
		expect(load(MATH_HTML, pageScript("math-runtime.js"), "{bad")).toEqual([
			{ type: "error", kind: "data" },
		]);
		expect(load(MATH_HTML, pageScript("math-runtime.js"), { html: 3 })).toEqual([
			{ type: "error", kind: "data" },
		]);
	});
});

describe("wide content: the viewer pages and the wide formula (slice D)", () => {
	it("the viewer pages allow WebKit's pinch zoom up to 4; the islands do not", () => {
		for (const html of [MATH_VIEWER_HTML, MERMAID_VIEWER_HTML]) {
			expect(html).toContain("maximum-scale=4, user-scalable=yes");
		}
		for (const html of [MATH_HTML, MERMAID_HTML]) expect(html).toContain("user-scalable=no");
	});

	it("reports a display formula that is wider than the island", () => {
		const html = '<span class="katex-display">x</span>';
		// The script runs right away, so the size goes on the prototype first.
		const sent: Sent[] = [];
		const dom = new JSDOM(MATH_HTML, { runScripts: "outside-only", pretendToBeVisual: true });
		const proto = dom.window.HTMLElement.prototype;
		Object.defineProperty(proto, "scrollWidth", { get: () => 600, configurable: true });
		Object.defineProperty(proto, "clientWidth", { get: () => 343, configurable: true });
		const page = dom.window as unknown as Record<string, unknown>;
		page.ReactNativeWebView = { postMessage: (m: string) => sent.push(JSON.parse(m)) };
		page.__lhIslandData = { html };
		dom.window.eval(pageScript("math-runtime.js"));
		expect(sent).toContainEqual({ type: "wide", wide: true });
	});

	it("in the viewer, the formula fits the screen, and the page reports no height", () => {
		const sent: Sent[] = [];
		const dom = new JSDOM(MATH_VIEWER_HTML, {
			runScripts: "outside-only",
			pretendToBeVisual: true,
		});
		const proto = dom.window.HTMLElement.prototype;
		// Twice as wide as the screen, and short.
		const wide = dom.window.innerWidth * 2;
		Object.defineProperty(proto, "scrollWidth", { get: () => wide, configurable: true });
		Object.defineProperty(proto, "scrollHeight", { get: () => 10, configurable: true });
		const page = dom.window as unknown as Record<string, unknown>;
		page.ReactNativeWebView = { postMessage: (m: string) => sent.push(JSON.parse(m)) };
		page.__lhIslandData = { html: "<p>x</p>", viewer: true };
		dom.window.eval(pageScript("math-runtime.js"));
		expect(sent).toContainEqual({ type: "rendered" });
		expect(sent.some((m) => m.type === "height")).toBe(false);
		expect(dom.window.document.getElementById("root")!.style.zoom).toBe("0.5");
	});

	it("in the viewer, a Mermaid chart fits the screen and reports no height", async () => {
		pendingMermaid = {
			initialize: () => {},
			render: async () => ({ svg: '<svg style="max-width: 900px;"></svg>' }),
		};
		const sent = load(MERMAID_VIEWER_HTML, pageScript("mermaid-runtime.js"), {
			source: "graph TD; A-->B",
			theme: "dark",
			viewer: true,
		});
		await flush();
		expect(sent).toContainEqual({ type: "rendered" });
		expect(sent.some((m) => m.type === "height")).toBe(false);
	});
});

describe("Mermaid page script", () => {
	const fakeMermaid = (render: () => Promise<{ svg: string }>) => {
		const calls: unknown[] = [];
		pendingMermaid = {
			initialize: (config: unknown) => calls.push(config),
			render,
		};
		return calls;
	};

	it("draws the chart with the desktop's config and reports it", async () => {
		const calls = fakeMermaid(async () => ({ svg: '<svg style="max-width: 400px;"></svg>' }));
		const sent = load(MERMAID_HTML, pageScript("mermaid-runtime.js"), {
			source: "graph TD; A-->B",
			theme: "dark",
		});
		await flush();
		expect(calls[0]).toMatchObject({
			securityLevel: "strict",
			theme: "dark",
			fontSize: 16,
			startOnLoad: false,
		});
		const svg = document.querySelector("#root svg") as unknown as { style: CSSStyleDeclaration };
		// Wide content, decision 3: the chart fits the island, never wider
		// than its natural size.
		expect(svg.style.width).toBe("100%");
		expect(svg.style.maxWidth).toBe("400px");
		expect(svg.style.height).toBe("auto");
		expect(sent).toContainEqual({ type: "rendered" });
	});

	it("9. reports a parse error without its text, and removes Mermaid's error drawing", async () => {
		fakeMermaid(async () => {
			document.body.appendChild(document.createElement("div"));
			throw new Error("Parse error on line 1: secret");
		});
		const sent = load(MERMAID_HTML, pageScript("mermaid-runtime.js"), { source: "graph ???" });
		await flush();
		expect(sent).toEqual([{ type: "error", kind: "parse" }]);
		expect(document.body.children).toHaveLength(1);
	});

	it("10. reports a missing Mermaid or bad data", () => {
		expect(load(MERMAID_HTML, pageScript("mermaid-runtime.js"), { source: "x" })).toEqual([
			{ type: "error", kind: "load" },
		]);
		fakeMermaid(async () => ({ svg: "" }));
		expect(load(MERMAID_HTML, pageScript("mermaid-runtime.js"), {})).toEqual([
			{ type: "error", kind: "data" },
		]);
	});
});
