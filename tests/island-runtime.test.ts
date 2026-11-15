/**
 * Issue 05 slice C: the page scripts of the islands, run in a jsdom window
 * with a fake react-native-webview bridge. The Mermaid tests use a fake
 * `mermaid`. (The jsdom test environment does not run with jest-expo, so
 * each test makes its own window.)
 */
import { JSDOM } from "jsdom";
import { MATH_HTML, MERMAID_HTML } from "lh-island-pages";

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
		injectedObjectJson: () => (typeof data === "string" ? data : JSON.stringify(data)),
	};
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

	it("reports a long press after 500 ms, and not after a move", () => {
		jest.useFakeTimers();
		try {
			const sent = load(MATH_HTML, pageScript("math-runtime.js"), data);
			const touch = (type: string, x: number) => {
				const event = new window.Event(type) as Event & {
					touches: { clientX: number; clientY: number }[];
				};
				event.touches = [{ clientX: x, clientY: 0 }];
				document.dispatchEvent(event);
			};
			touch("touchstart", 0);
			touch("touchmove", 20);
			jest.advanceTimersByTime(600);
			expect(sent).not.toContainEqual({ type: "longpress" });
			touch("touchstart", 0);
			jest.advanceTimersByTime(600);
			expect(sent).toContainEqual({ type: "longpress" });
		} finally {
			jest.useRealTimers();
		}
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
		expect(svg.style.width).toBe("400px");
		expect(svg.style.maxWidth).toBe("none");
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
