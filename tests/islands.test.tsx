/**
 * Issue 05 slice C: the math and Mermaid islands and their error states
 * (docs/ISSUES.md, issue 05: 8 to 12 and 16). Jest cannot run a WebView,
 * so the react-native-webview mock (__mocks__/) keeps each WebView's props,
 * and the tests play the page with `sendFromPage`.
 */
import { runInNewContext } from "node:vm";

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as ReactNative from "react-native";
import { Linking, StyleSheet } from "react-native";

import {
	createEndFollow,
	createIslandViewport,
	isAtEnd,
	isNearScreen,
	IslandViewportContext,
} from "@/components/island-viewport";
import { DIAGRAM_ERROR, FORMULA_ERROR, MERMAID_TIMEOUT_MS } from "@/components/islands";
import { Markdown } from "@/components/markdown";
import { allowIslandLoad, HEIGHT_WAIT_MS, islandDataScript } from "@/components/web-island";
import {
	islandData,
	resetWebviews,
	sendFromPage,
	webviews,
	type FakeWebView,
} from "./helpers/fake-webview";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
const setString = Clipboard.setStringAsync as jest.MockedFunction<typeof Clipboard.setStringAsync>;

const BASE = { fontSize: 16, lineHeight: 24, color: "#111" };
const md = (text: string) => <Markdown text={text} style={BASE} testID="md" />;
const show = (text: string) => render(md(text));

const only = (): FakeWebView => {
	const list = webviews();
	expect(list).toHaveLength(1);
	return list[0]!;
};
const data = islandData;
const call = async (w: FakeWebView, prop: string, arg?: unknown) => {
	await act(async () => {
		(w.props[prop] as (arg?: unknown) => void)(arg);
	});
};
const page = async (w: FakeWebView, message: unknown) => {
	await act(async () => {
		sendFromPage(w, message);
	});
};
const boxHeight = () =>
	StyleSheet.flatten(screen.getAllByTestId(/md-(math|mermaid)-island/)[0]!.props.style)?.height;

beforeEach(() => {
	setString.mockReset();
	setString.mockResolvedValue(true);
});

afterEach(() => {
	resetWebviews();
	jest.restoreAllMocks();
	jest.useRealTimers();
});

describe("math islands", () => {
	it("send the island data with the colors and sizes of the surface", async () => {
		await show("Pull $F = ma$ here.");
		expect(data(only())).toMatchObject({ color: "#111", fontSize: 16, lineHeight: 24 });
		expect(only().props.injectedJavaScript).toContain('getAttribute("data-link")');
	});

	it("send a new text to the loaded page while a reply streams, with no new load", async () => {
		const view = await show("Pull $F$");
		const first = only();
		await call(first, "onLoadEnd");
		await act(async () => {
			view.rerender(md("Pull $F = ma$ grows"));
		});
		expect(only()).toBe(first);
		expect(JSON.parse(first.posted.at(-1)!).html).toContain("grows");
	});

	it("16. send new colors when the mode changes", async () => {
		const scheme = jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("light");
		const view = await show("$x$ and `code`");
		const first = only();
		await call(first, "onLoadEnd");
		const light = data(first).codeBg;
		scheme.mockReturnValue("dark");
		await act(async () => {
			view.rerender(md("$x$ and `code`"));
		});
		expect(only()).toBe(first);
		expect(JSON.parse(first.posted.at(-1)!).codeBg).not.toBe(light);
	});

	it("6. open a tapped link only when the index is a safe link", async () => {
		const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		await show("$x$ [a](https://a.example) and [b](javascript:x)");
		await page(only(), { type: "link", index: 0 });
		expect(open).toHaveBeenCalledWith("https://a.example");
		await page(only(), { type: "link", index: 1 });
		await page(only(), { type: "link", index: 99 });
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("copy the paragraph as Markdown on a long press in the page", async () => {
		await show("Pull $F = ma$ **now**.");
		await page(only(), { type: "longpress" });
		expect(setString).toHaveBeenCalledWith("Pull $F = ma$ **now**.");
		expect(screen.getByTestId("md-copy-label")).toHaveTextContent("Copied");
	});

	it("8. show a display formula that KaTeX cannot draw as its source, with no WebView", async () => {
		await show("$$\n\\frac{1}{\n$$");
		expect(webviews()).toHaveLength(0);
		expect(screen.getByTestId("md-math")).toHaveTextContent("\\frac{1}{");
		expect(screen.getByTestId("md-math-error")).toHaveTextContent(FORMULA_ERROR);
	});

	it("8. keep the good formulas of a paragraph and show the error under it", async () => {
		await show("Good $x$ and bad $\\frac{$.");
		expect(String(data(only()).html)).toContain('<span class="lh-tex">');
		expect(screen.getByTestId("md-math-error")).toHaveTextContent(FORMULA_ERROR);
	});

	it("8. show the native text and the error when the page cannot load", async () => {
		await show("Pull $F = ma$ here.");
		await page(only(), { type: "error", kind: "data" });
		expect(webviews()).toHaveLength(0);
		expect(screen.getByText(/Pull/)).toHaveTextContent("Pull F = ma here.");
		expect(screen.getByTestId("md-math-error")).toHaveTextContent(FORMULA_ERROR);
	});

	it("10. load again one time when the WebView process stops, then use the fallback", async () => {
		await show("$$\nx^2\n$$");
		const first = only();
		await call(first, "onContentProcessDidTerminate");
		const second = only();
		expect(second).not.toBe(first);
		expect(screen.queryByTestId("md-math-error")).toBeNull();
		await call(second, "onContentProcessDidTerminate");
		expect(webviews()).toHaveLength(0);
		expect(screen.getByTestId("md-math")).toHaveTextContent("x^2");
		expect(screen.getByTestId("md-math-error")).toHaveTextContent(FORMULA_ERROR);
	});

	it("10. use the fallback when the page fails to load", async () => {
		await show("$$\nx\n$$");
		await call(only(), "onError");
		expect(screen.getByTestId("md-math-error")).toBeTruthy();
	});
});

describe("island height", () => {
	it("takes a valid height from the page, with no scroll inside", async () => {
		await show("$$\nx\n$$");
		await page(only(), { type: "height", height: 57.2 });
		expect(boxHeight()).toBe(58);
		expect(only().props.scrollEnabled).toBe(false);
	});

	it("11. ignores a wrong height, and after the wait uses the minimum height with a scroll", async () => {
		jest.useFakeTimers();
		await show("$$\nx\n$$");
		await page(only(), { type: "height", height: -4 });
		await page(only(), { type: "height", height: "big" });
		await page(only(), "not json");
		await act(async () => {
			await jest.advanceTimersByTimeAsync(HEIGHT_WAIT_MS);
		});
		expect(boxHeight()).toBe(BASE.lineHeight);
		expect(only().props.scrollEnabled).toBe(true);
		// A valid height later ends the scroll.
		await page(only(), { type: "height", height: 40 });
		expect(boxHeight()).toBe(40);
		expect(only().props.scrollEnabled).toBe(false);
	});

	it("11. caps a very tall page and scrolls inside it", async () => {
		await show("$$\nx\n$$");
		await page(only(), { type: "height", height: 5000 });
		expect(boxHeight()).toBe(1200);
		expect(only().props.scrollEnabled).toBe(true);
	});
});

describe("island lockdown", () => {
	it("12. gives the page its data as a safe JSON literal, also with backticks and ${}", () => {
		const nasty = {
			source: "a`b ${globalThis.hacked = 1} \\frac{1}{2}\n</script><!-- & \u2028 \u2029 '\"",
		};
		const script = islandDataScript(nasty);
		expect(script).not.toMatch(/[<>&\u2028\u2029]/);
		const page: { __lhIslandData?: unknown } = {};
		const sandbox = { window: page, globalThis: {} as Record<string, unknown> };
		runInNewContext(script, sandbox);
		expect(page.__lhIslandData).toEqual(nasty);
		expect(sandbox.globalThis.hacked).toBeUndefined();
	});

	it("12. never uses injectedJavaScriptObject (iOS puts it in a template literal unescaped)", async () => {
		await show("$x$");
		expect(only().props.injectedJavaScriptObject).toBeUndefined();
	});

	it("12. loads only the page's own HTML", () => {
		expect(allowIslandLoad("about:blank")).toBe(true);
		for (const url of [
			"https://example.com",
			"http://localhost:8081",
			"file:///etc/passwd",
			"data:text/html,<b>x</b>",
			"javascript:alert(1)",
			"about:srcdoc",
		]) {
			expect(allowIslandLoad(url)).toBe(false);
		}
	});

	it("12. opens no window, finds no data, and keeps no cache", async () => {
		await show("$x$");
		const props = only().props;
		expect(
			(props.onShouldStartLoadWithRequest as (r: { url: string }) => boolean)({
				url: "https://a.b",
			}),
		).toBe(false);
		expect(props).toMatchObject({
			originWhitelist: ["*"],
			javaScriptCanOpenWindowsAutomatically: false,
			dataDetectorTypes: "none",
			allowsLinkPreview: false,
			textInteractionEnabled: false,
			incognito: true,
			cacheEnabled: false,
		});
		expect(typeof props.onOpenWindow).toBe("function");
	});
});

describe("Mermaid islands", () => {
	const chart = "```mermaid\ngraph TD; A-->B\n```";

	it("show a wait message while the fence is still open, with no WebView", async () => {
		await show("```mermaid\ngraph TD; A-->");
		expect(screen.getByTestId("md-mermaid-open")).toHaveTextContent("Drawing the diagram…");
		expect(webviews()).toHaveLength(0);
	});

	it("draw the chart with the source as data, and copy it on a long press", async () => {
		jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("light");
		await show(chart);
		expect(data(only())).toEqual({ source: "graph TD; A-->B", theme: "light", fontSize: 16 });
		expect(only().props.injectedJavaScript).toContain("mermaid.render");
		await page(only(), { type: "rendered" });
		await page(only(), { type: "longpress" });
		expect(setString).toHaveBeenCalledWith("graph TD; A-->B");
	});

	it("9. show the error, the folded source and Try again for a parse error", async () => {
		await show(chart);
		const first = only();
		await page(first, { type: "error", kind: "parse" });
		expect(screen.getByTestId("md-mermaid-error")).toHaveTextContent(DIAGRAM_ERROR);
		expect(screen.queryByTestId("md-mermaid-source")).toBeNull();
		await act(async () => {
			fireEvent.press(screen.getByTestId("md-mermaid-source-toggle"));
		});
		expect(screen.getByTestId("md-mermaid-source")).toHaveTextContent("graph TD; A-->B");
		await act(async () => {
			fireEvent.press(screen.getByTestId("md-mermaid-retry"));
		});
		expect(only()).not.toBe(first);
		expect(screen.queryByTestId("md-mermaid-error")).toBeNull();
	});

	it("9. fail after the time limit when the chart never draws", async () => {
		jest.useFakeTimers();
		await show(chart);
		await page(only(), { type: "height", height: 200 });
		await act(async () => {
			await jest.advanceTimersByTimeAsync(MERMAID_TIMEOUT_MS);
		});
		expect(screen.getByTestId("md-mermaid-error")).toHaveTextContent(DIAGRAM_ERROR);
		expect(webviews()).toHaveLength(0);
	});

	it("9. do not fail after the time limit when the chart is drawn", async () => {
		jest.useFakeTimers();
		await show(chart);
		await page(only(), { type: "rendered" });
		await act(async () => {
			await jest.advanceTimersByTimeAsync(MERMAID_TIMEOUT_MS * 2);
		});
		expect(screen.queryByTestId("md-mermaid-error")).toBeNull();
	});

	it("10. fail after the second process stop, or when Mermaid cannot load", async () => {
		await show(chart);
		await call(only(), "onContentProcessDidTerminate");
		await call(only(), "onContentProcessDidTerminate");
		expect(screen.getByTestId("md-mermaid-error")).toBeTruthy();
		resetWebviews();
		await show(chart);
		await page(only(), { type: "error", kind: "load" });
		expect(screen.getByTestId("md-mermaid-error")).toBeTruthy();
	});

	it("16. draw the chart again with the dark theme when the mode changes", async () => {
		const scheme = jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("light");
		const view = await show(chart);
		const first = only();
		scheme.mockReturnValue("dark");
		await act(async () => {
			view.rerender(md(chart));
		});
		expect(only()).not.toBe(first);
		expect(data(only()).theme).toBe("dark");
	});
});

describe("islands near the screen (decision 3)", () => {
	it("keep a reader who scrolled up where they are (only the end follows new content)", () => {
		expect(isAtEnd(900, 800, 1750)).toBe(true);
		expect(isAtEnd(0, 800, 800)).toBe(true);
		expect(isAtEnd(500, 800, 1750)).toBe(false);
	});

	it("keep the follow during the app's own scroll to the end, and stop it only for the reader's scroll", () => {
		const follow = createEndFollow();
		expect(follow.follows()).toBe(true);
		// A middle frame of the app's animated scroll, after an island grew: not at the end.
		follow.scrolled({ offset: 400, visible: 800, content: 2400 });
		expect(follow.follows()).toBe(true);
		// The reader drags up and lets go far from the end.
		follow.userStart();
		follow.scrolled({ offset: 300, visible: 800, content: 2400 });
		expect(follow.follows()).toBe(false);
		follow.userEnd({ offset: 200, visible: 800, content: 2400 });
		expect(follow.follows()).toBe(false);
		// Later app scroll events do not start the follow again.
		follow.scrolled({ offset: 1600, visible: 800, content: 2400 });
		expect(follow.follows()).toBe(false);
		// The reader's momentum ends at the end: the follow starts again.
		follow.userStart();
		follow.userEnd({ offset: 1590, visible: 800, content: 2400 });
		expect(follow.follows()).toBe(true);
		// A tap on the status bar goes to the top.
		follow.toTop();
		expect(follow.follows()).toBe(false);
	});

	it("come near within one screen, and go far only at three screens", () => {
		expect(isNearScreen(1500, 100, 1000, false)).toBe(true);
		expect(isNearScreen(2100, 100, 1000, false)).toBe(false);
		expect(isNearScreen(2100, 100, 1000, true)).toBe(true);
		expect(isNearScreen(4100, 100, 1000, true)).toBe(false);
		expect(isNearScreen(-1200, 100, 1000, false)).toBe(false);
	});

	it("show the native text until the island comes near, then start the WebView", async () => {
		let top = 5000;
		jest
			.spyOn(
				ReactNative.View.prototype as unknown as { measureInWindow: () => void },
				"measureInWindow",
			)
			.mockImplementation(function (this: unknown, ...args: unknown[]) {
				(args[0] as (x: number, y: number, w: number, h: number) => void)(0, top, 300, 24);
			});
		const viewport = createIslandViewport();
		await render(
			<IslandViewportContext.Provider value={viewport}>
				{md("Pull $F = ma$ here.")}
			</IslandViewportContext.Provider>,
		);
		expect(webviews()).toHaveLength(0);
		expect(screen.getByText(/Pull/)).toBeTruthy();
		top = 300;
		await act(async () => {
			viewport.notify();
		});
		expect(webviews()).toHaveLength(1);
	});
});
