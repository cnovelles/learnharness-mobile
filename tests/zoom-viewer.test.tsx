/**
 * Issue 05, wide content, slices B to E: the expand button, the full-screen
 * viewer, the native zoom pane, the web pane and the orientation unlock.
 * The test names start with the error state (W1 to W10, docs/ISSUES.md).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as ScreenOrientation from "expo-screen-orientation";
import { MATH_VIEWER_HTML, MERMAID_VIEWER_HTML } from "lh-island-pages";
import { useTapGesture } from "react-native-gesture-handler";
import { StyleSheet, Text } from "react-native";

import { DIAGRAM_ERROR } from "@/components/islands";
import { CODE_TEXT, CODE_VIEWER_MIN_SCALE, codeWidth, Markdown } from "@/components/markdown";
import { SPACE } from "@/components/spacing";
import { PlanBlock } from "@/components/plan-graph";
import * as planGraphLib from "@/lib/plan-graph";
import {
	DOUBLE_TAP_MAX_DELAY_MS,
	DOUBLE_TAP_ZOOM,
	doubleTapViewport,
	fitViewport,
} from "@/lib/zoom-viewport";
import type { PlanTree } from "@/lib/shared";
import {
	islandData,
	resetWebviews,
	sendFromPage,
	webviews,
	type FakeWebView,
} from "./helpers/fake-webview";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
// The real tap hook, with its config recorded.
jest.mock("react-native-gesture-handler", () => {
	const actual = jest.requireActual("react-native-gesture-handler");
	return { ...actual, useTapGesture: jest.fn((config) => actual.useTapGesture(config)) };
});
jest.mock("expo-screen-orientation", () => ({
	lockAsync: jest.fn(() => Promise.resolve()),
	OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3 },
}));
const setString = Clipboard.setStringAsync as jest.MockedFunction<typeof Clipboard.setStringAsync>;
const lockAsync = ScreenOrientation.lockAsync as jest.MockedFunction<
	typeof ScreenOrientation.lockAsync
>;

const BASE = { fontSize: 16, lineHeight: 24, color: "#111" };
const show = (text: string) => render(<Markdown text={text} style={BASE} testID="md" />);

/** Lay out the viewer pane: the frame, then the content (Jest has no layout). */
const layoutPane = async (width: number, height = 600) => {
	await layout("zoom-pane", width, height);
	await layout("zoom-pane-content", 100, 40);
};

const layout = async (testID: string, width: number, height = 600) => {
	await act(async () => {
		fireEvent(screen.getByTestId(testID), "layout", {
			nativeEvent: { layout: { x: 0, y: 0, width, height } },
		});
	});
};
const press = async (testID: string) => {
	await act(async () => {
		fireEvent.press(screen.getByTestId(testID));
	});
};
const page = async (w: FakeWebView, message: unknown) => {
	await act(async () => {
		sendFromPage(w, message);
	});
};
const contentWidth = () =>
	StyleSheet.flatten(screen.getByTestId("zoom-pane-content").props.style).width as number;

const LONG = "export const near = force(earth, moon, 384_400 - 6_371); // a long line";

beforeEach(() => {
	setString.mockReset();
	setString.mockResolvedValue(true);
	lockAsync.mockClear();
});

afterEach(() => {
	resetWebviews();
	jest.restoreAllMocks();
});

describe("doubleTapViewport", () => {
	const view = { x: 0, y: 0, w: 1000, h: 400 };
	const frame = { w: 300, h: 600 };
	const base = 0.3;

	it("zooms in to 2.5 around the tapped point, then back to the fit", () => {
		const fit = fitViewport(view, frame, base);
		const zoomed = doubleTapViewport(view, frame, base, fit, { x: 150, y: 60 });
		expect(zoomed.zoom).toBe(DOUBLE_TAP_ZOOM);
		// The content point under the finger stays under it.
		const k0 = base;
		const k1 = base * DOUBLE_TAP_ZOOM;
		expect(zoomed.x + 150 / k1).toBeCloseTo(fit.x + 150 / k0);
		expect(doubleTapViewport(view, frame, base, zoomed, { x: 0, y: 0 })).toEqual(fit);
	});
});

describe("the double-tap gesture", () => {
	it("waits long enough for a slow second tap (the iOS handler default is 200 ms)", async () => {
		await show(`\`\`\`ts\n${LONG}\n\`\`\``);
		await press("md-expand-code");
		const config = jest.mocked(useTapGesture).mock.calls.at(-1)![0];
		expect(config).toMatchObject({ numberOfTaps: 2, maxDelay: DOUBLE_TAP_MAX_DELAY_MS });
		// Maestro's two taps are 253 ms apart.
		expect(DOUBLE_TAP_MAX_DELAY_MS).toBeGreaterThanOrEqual(300);
	});
});

describe("code in the viewer", () => {
	it("W1. has no expand button while the fence streams", async () => {
		await show(`\`\`\`ts\n${LONG}`);
		expect(screen.queryByTestId("md-expand-code")).toBeNull();
		await show(`\`\`\`ts\n${LONG}\n\`\`\``);
		expect(screen.getByTestId("md-expand-code")).toBeTruthy();
	});

	it("opens full screen with no wrap, zooms, copies and closes", async () => {
		await show(`\`\`\`ts\n${LONG}\nshort\n\`\`\``);
		await press("md-expand-code");
		const viewer = screen.getByTestId("zoom-viewer");
		expect(within(viewer).getByTestId("zoom-kind")).toHaveTextContent("CODE");
		// Each line stays on one line in the viewer.
		const lines = within(viewer).getAllByTestId("md-code-line");
		expect(lines[0]!.props.numberOfLines).toBe(1);
		// The fit: the code shrinks to fill the frame, but not below 11 pt.
		// The end comment stays on its code line, so the line goes past the
		// edge and a drag moves it.
		await layoutPane(300);
		const natural = codeWidth([LONG, "short"], 1, true);
		expect(300 / natural).toBeLessThan(CODE_VIEWER_MIN_SCALE);
		expect(CODE_VIEWER_MIN_SCALE * CODE_TEXT.fontSize).toBeCloseTo(11);
		expect(contentWidth()).toBeCloseTo(natural * CODE_VIEWER_MIN_SCALE);
		const fontAt = () =>
			StyleSheet.flatten(within(viewer).getAllByTestId("md-code-line")[0]!.props.style).fontSize;
		expect(fontAt()).toBeCloseTo(11);
		// VoiceOver zoom in: the content draws again, twice as large.
		await act(async () => {
			fireEvent(screen.getByTestId("zoom-pane"), "accessibilityAction", {
				nativeEvent: { actionName: "increment" },
			});
		});
		expect(contentWidth()).toBeCloseTo(natural * CODE_VIEWER_MIN_SCALE * 2);
		expect(fontAt()).toBeCloseTo(22);
		// Fit goes back.
		await press("zoom-fit");
		expect(contentWidth()).toBeCloseTo(natural * CODE_VIEWER_MIN_SCALE);
		await press("zoom-copy");
		expect(setString).toHaveBeenLastCalledWith(`${LONG}\nshort`);
		await press("zoom-close");
		expect(screen.queryByTestId("zoom-viewer")).toBeNull();
	});

	it("W7. goes back to the fit when the screen turns", async () => {
		await show(`\`\`\`ts\n${LONG}\n\`\`\``);
		await press("md-expand-code");
		await layoutPane(300);
		await act(async () => {
			fireEvent(screen.getByTestId("zoom-pane"), "accessibilityAction", {
				nativeEvent: { actionName: "increment" },
			});
		});
		expect(contentWidth()).toBeGreaterThan(codeWidth([LONG], 1, true) * CODE_VIEWER_MIN_SCALE);
		// Landscape: a wider frame, at the fit. A short block does not grow past
		// 1; the content fills the frame width.
		await layoutPane(800, 300);
		expect(codeWidth([LONG], 1, true)).toBeLessThan(800);
		expect(contentWidth()).toBeCloseTo(800);
	});

	it("wraps a comment line at the fit width; code and end comments stay on one line", async () => {
		const comment = `// ${"Load the lesson from the Mac before the phone shows it. ".repeat(3).trim()}`;
		const code = "const a = 1; // end";
		await show(`\`\`\`ts\n${comment}\n${code}\n\`\`\``);
		await press("md-expand-code");
		await layoutPane(300);
		// The comment does not count in the width: the short code fits at 13 pt,
		// and the content fills the frame.
		expect(codeWidth([comment, code], 1, true)).toBeGreaterThan(300);
		expect(codeWidth([code], 1, true)).toBeLessThan(300);
		expect(contentWidth()).toBeCloseTo(300);
		const viewer = screen.getByTestId("zoom-viewer");
		const [commentLine, codeLine] = within(viewer).getAllByTestId("md-code-line");
		expect(commentLine!.props.numberOfLines).toBeUndefined();
		expect(codeLine!.props.numberOfLines).toBe(1);
		expect(StyleSheet.flatten(codeLine!.props.style).fontSize).toBeCloseTo(13);
		// The comment row is the content width less the padding on each side.
		const rows = within(viewer).getAllByTestId("md-code-row");
		expect(StyleSheet.flatten(rows[0]!.props.style).width).toBeCloseTo(300 - 2 * SPACE.lg);
		expect(StyleSheet.flatten(rows[1]!.props.style).width).toBeUndefined();
	});

	it("wraps a comment line at the screen width when a long code line goes past the edge", async () => {
		const comment = "// Newton: the force falls with the square of the distance";
		await show(`\`\`\`ts\n${comment}\n${LONG}\n\`\`\``);
		await press("md-expand-code");
		await layoutPane(300);
		// The long code line sets the content width (past the edge at 11 pt).
		expect(contentWidth()).toBeCloseTo(
			codeWidth([comment, LONG], 1, true, [true, false]) * CODE_VIEWER_MIN_SCALE,
		);
		expect(contentWidth()).toBeGreaterThan(300);
		// The comment row is the screen width less the padding, at the fit.
		const rows = within(screen.getByTestId("zoom-viewer")).getAllByTestId("md-code-row");
		expect(StyleSheet.flatten(rows[0]!.props.style).width).toBeCloseTo(
			300 - 2 * SPACE.lg * CODE_VIEWER_MIN_SCALE,
		);
	});
});

describe("the orientation unlock (slice E)", () => {
	it("unlocks while the viewer is open and goes back to portrait", async () => {
		await show("```\nx\n```");
		await press("md-expand-code");
		expect(lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.DEFAULT);
		await press("zoom-close");
		expect(lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
	});

	it("W8. keeps working in portrait when the lock fails, with no error on screen", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		lockAsync.mockRejectedValueOnce(new Error("refused"));
		await show("```\nx\n```");
		await press("md-expand-code");
		expect(screen.getByTestId("zoom-viewer")).toBeTruthy();
		expect(screen.queryByText(/refused/)).toBeNull();
		expect(warn).toHaveBeenCalled();
	});
});

describe("tables in the viewer", () => {
	const TABLE = "| Side | Note |\n| --- | --- |\n| Near | Faces the Moon all day long |";
	const measure = async (note: number) => {
		const widths: Record<string, number> = { "0-0": 40, "0-1": 40, "1-0": 40, "1-1": note };
		await act(async () => {
			for (const [at, w] of Object.entries(widths))
				fireEvent(
					screen.getByTestId(`md-table-measure-${at}`, { includeHiddenElements: true }),
					"layout",
					{ nativeEvent: { layout: { x: 0, y: 0, width: w, height: 20 } } },
				);
		});
	};

	it("W2. has no button before the measure, or when the table fits", async () => {
		await show(TABLE);
		await layout("md-table-block", 200);
		expect(screen.queryByTestId("md-expand-table")).toBeNull();
		await measure(60);
		expect(screen.queryByTestId("md-expand-table")).toBeNull();
	});

	it("opens a table that had to shrink, at its natural widths", async () => {
		await show(TABLE);
		await measure(400);
		await layout("md-table-block", 200);
		await press("md-expand-table");
		const viewer = screen.getByTestId("zoom-viewer");
		expect(within(viewer).getByTestId("zoom-kind")).toHaveTextContent("TABLE");
		await layoutPane(2000);
		// At scale 1 (a wide frame): "Near" 40 + 12, the note 228 + 12 (the cap).
		expect(contentWidth()).toBe(52 + 240 + 2 * 16);
	});
});

describe("Mermaid in the viewer", () => {
	it("W1. shows the button only when the chart is drawn, and opens the viewer page", async () => {
		await show("```mermaid\ngraph TD; A-->B\n```");
		expect(screen.queryByTestId("md-expand-diagram")).toBeNull();
		await page(webviews()[0]!, { type: "rendered" });
		await press("md-expand-diagram");
		const viewerPage = webviews().find(
			(w) => w.props.source && (w.props.source as { html: string }).html === MERMAID_VIEWER_HTML,
		);
		expect(viewerPage).toBeTruthy();
		expect(islandData(viewerPage!)).toMatchObject({
			source: "graph TD; A-->B",
			viewer: true,
			// The page zooms on a double-tap like the native panes.
			doubleTapZoom: DOUBLE_TAP_ZOOM,
			doubleTapMs: DOUBLE_TAP_MAX_DELAY_MS,
		});
	});

	it("W4. shows the error in the viewer when the page cannot draw", async () => {
		await show("```mermaid\ngraph TD; A-->B\n```");
		await page(webviews()[0]!, { type: "rendered" });
		await press("md-expand-diagram");
		const viewerPage = webviews()[webviews().length - 1]!;
		await page(viewerPage, { type: "error", kind: "parse" });
		expect(within(screen.getByTestId("zoom-error")).getByText(DIAGRAM_ERROR)).toBeTruthy();
	});
});

describe("math in the viewer", () => {
	it("shows the button for a wide formula, and W9 keeps the data it opened with", async () => {
		const view = await show("$$\n\\sum_{k=1}^{n} k\n$$");
		const island = webviews()[0]!;
		await page(island, { type: "height", height: 40 });
		expect(screen.queryByTestId("md-expand-formula")).toBeNull();
		await page(island, { type: "wide", wide: true });
		await press("md-expand-formula");
		const viewerPage = webviews().find(
			(w) => (w.props.source as { html: string }).html === MATH_VIEWER_HTML,
		)!;
		const opened = islandData(viewerPage);
		expect(opened).toMatchObject({ viewer: true });
		// A new text: the viewer keeps its data.
		await view.rerender(<Markdown text={"$$\n\\sum_{k=1}^{n} k^2\n$$"} style={BASE} testID="md" />);
		expect(islandData(viewerPage)).toEqual(opened);
	});
});

describe("the plan block in the viewer", () => {
	const PLAN: PlanTree = {
		version: 1,
		nodes: [
			{ id: "a", title: "Uneven pull" },
			{ id: "b", title: "Two bulges" },
		] as PlanTree["nodes"],
		edges: [{ from: "a", to: "b" }] as PlanTree["edges"],
	};

	it("opens the graph full screen; the block's tap still opens the Plan sheet", async () => {
		const onOpen = jest.fn();
		await render(
			<PlanBlock id="p" tree={PLAN} label="Lesson plan" onOpen={onOpen} fallback={null} />,
		);
		await press("plan-expand-p");
		expect(onOpen).not.toHaveBeenCalled();
		expect(within(screen.getByTestId("zoom-viewer")).getByTestId("zoom-kind")).toHaveTextContent(
			"PLAN",
		);
		await press("zoom-close");
		await press("plan-p");
		expect(onOpen).toHaveBeenCalled();
	});

	it("W5. shows the text card and no button when the layout fails", async () => {
		jest.spyOn(planGraphLib, "planGraph").mockReturnValue(null);
		await render(
			<PlanBlock
				id="p"
				tree={PLAN}
				label="Lesson plan"
				onOpen={jest.fn()}
				fallback={<Text testID="plan-card">The plan</Text>}
			/>,
		);
		expect(screen.getByTestId("plan-card")).toBeTruthy();
		expect(screen.queryByTestId("plan-expand-p")).toBeNull();
	});
});
