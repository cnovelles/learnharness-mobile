/**
 * Issue 19: the figure and the demo in the lesson (src/components/artifact-card.tsx),
 * with the error states of docs/ISSUES.md, issue 19. Jest cannot run a
 * WebView: the react-native-webview mock keeps each WebView's props, and
 * the tests play the page with `sendFromPage`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as ReactNative from "react-native";

import {
	ArtifactActionsProvider,
	ArtifactRow,
	MESSAGES,
	type ArtifactActions,
} from "@/components/artifact-card";
import { createIslandViewport, IslandViewportContext } from "@/components/island-viewport";
import { DEMO_CSP, FIGURE_CSP } from "@/lib/artifact-html";
import type { Artifact } from "@/lib/artifacts";

import {
	islandData,
	resetWebviews,
	sendFromPage,
	webviews,
	type FakeWebView,
} from "./helpers/fake-webview";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><circle r="4"/></svg>';
const SNAP = "ab12".repeat(16);
const FIGURE: Artifact = { kind: "figure", svg: SVG, inverted: false, snapshotId: null };
const DEMO: Artifact = {
	kind: "demo",
	title: "Moon distance",
	html: "<p>demo</p>",
	inverted: false,
};

type Call = { url: string; init?: RequestInit };

/** A fake Mac fetch: each call gets the next answer. */
function fakeActions(answers: (Response | Error)[] = []) {
	const calls: Call[] = [];
	const sent: string[] = [];
	let sendResult = true;
	const actions: ArtifactActions = {
		chatId: "chat 1",
		fetch: (async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			const answer = answers.shift() ?? new Response(JSON.stringify({ ok: true }));
			if (answer instanceof Error) throw answer;
			return answer;
		}) as typeof globalThis.fetch,
		sendText: async (text: string) => {
			sent.push(text);
			return sendResult;
		},
	};
	return {
		actions,
		calls,
		sent,
		failSend: () => {
			sendResult = false;
		},
	};
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function draw(artifact: Artifact, actions: ArtifactActions | null = null) {
	const row = <ArtifactRow id="sa_m1" messageId="m1" artifact={artifact} />;
	await render(
		actions ? <ArtifactActionsProvider value={actions}>{row}</ArtifactActionsProvider> : row,
	);
}

const only = (): FakeWebView => {
	const all = webviews();
	expect(all).toHaveLength(1);
	return all[0]!;
};

const page = async (webview: FakeWebView, data: unknown) => {
	await act(async () => sendFromPage(webview, data));
};

/** Settles the fake fetch promises. */
const settle = () => act(async () => {});

beforeEach(() => resetWebviews());

describe("the figure", () => {
	it("draws the SVG as an image in a locked WebView", async () => {
		await draw(FIGURE);
		const w = only();
		const html = w.props.source as { html: string };
		expect(html.html).toContain(`content="${FIGURE_CSP}"`);
		expect(html.html).toContain('<img alt="" src="data:image/svg+xml;charset=utf-8,');
		// The lock (review sections 6 and 7).
		expect(w.props.originWhitelist).toEqual(["*"]);
		expect(w.props.mediaCapturePermissionGrantType).toBe("deny");
		expect(w.props.javaScriptCanOpenWindowsAutomatically).toBe(false);
		expect(w.props.incognito).toBe(true);
		expect(typeof w.props.onOpenWindow).toBe("function");
		const allow = w.props.onShouldStartLoadWithRequest as (r: {
			url: string;
			isTopFrame: boolean;
		}) => boolean;
		expect(allow({ url: "about:blank", isTopFrame: true })).toBe(true);
		expect(allow({ url: "https://example.com/", isTopFrame: true })).toBe(false);
		expect(allow({ url: "about:blank", isTopFrame: false })).toBe(false);
		expect(screen.getByText("FIGURE")).toBeTruthy();
	});

	it("takes the page's height", async () => {
		await draw(FIGURE);
		await page(only(), { type: "height", height: 140 });
		expect(screen.getByTestId("artifact-sa_m1-webview")).toHaveStyle({ height: 140 });
	});

	it("mounts its WebView only near the screen", async () => {
		let top = 5000;
		const spy = jest
			.spyOn(
				ReactNative.View.prototype as unknown as { measureInWindow: () => void },
				"measureInWindow",
			)
			.mockImplementation(function (this: unknown, ...args: unknown[]) {
				(args[0] as (x: number, y: number, w: number, h: number) => void)(0, top, 300, 150);
			});
		const viewport = createIslandViewport();
		await render(
			<IslandViewportContext.Provider value={viewport}>
				<ArtifactRow id="a" messageId="m1" artifact={FIGURE} />
				<ArtifactRow id="b" messageId="m2" artifact={FIGURE} />
			</IslandViewportContext.Provider>,
		);
		expect(webviews()).toHaveLength(0);
		top = 300;
		await act(async () => viewport.notify());
		expect(webviews()).toHaveLength(2);
		top = 9000;
		await act(async () => viewport.notify());
		expect(webviews()).toHaveLength(0);
		spy.mockRestore();
	});

	it("the invert switch is saved on the Mac", async () => {
		const mac = fakeActions();
		await draw(FIGURE, mac.actions);
		await act(async () => (only().props.onLoadEnd as () => void)());
		await act(async () =>
			fireEvent(screen.getByTestId("artifact-sa_m1-invert"), "valueChange", true),
		);
		await settle();
		expect(mac.calls).toEqual([
			{
				url: "/api/chats/chat%201/artifact-ui",
				init: expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ input: { messageId: "m1", inverted: true } }),
				}),
			},
		]);
		expect(screen.getByTestId("artifact-sa_m1-invert")).toHaveProp("value", true);
		// The page gets the new data.
		expect(only().posted.map((p) => JSON.parse(p))).toContainEqual({ inverted: true });
		expect(screen.queryByTestId("artifact-sa_m1-switch-error")).toBeNull();
	});

	it.each([
		["404", json({ error: "Unknown chat" }, 404)],
		["400", json({ error: "No demo/figure steer with that message id" }, 400)],
		["500", new Response("Internal Server Error", { status: 500 })],
		["no connection", new Error("Network request failed")],
	])("error state 7: a failed switch write (%s) puts the switch back", async (_name, answer) => {
		const mac = fakeActions([answer]);
		await draw(FIGURE, mac.actions);
		await act(async () =>
			fireEvent(screen.getByTestId("artifact-sa_m1-invert"), "valueChange", true),
		);
		await settle();
		expect(screen.getByTestId("artifact-sa_m1-invert")).toHaveProp("value", false);
		expect(screen.getByText(MESSAGES.switchNotSaved)).toBeTruthy();
		expect(screen.queryByText(/Unknown chat|steer|Internal|Network/)).toBeNull();
	});

	it("without a session the switch stays local", async () => {
		await draw(FIGURE);
		await act(async () =>
			fireEvent(screen.getByTestId("artifact-sa_m1-invert"), "valueChange", true),
		);
		expect(screen.getByTestId("artifact-sa_m1-invert")).toHaveProp("value", true);
		expect(islandData(only())).toEqual({ inverted: false });
	});

	it("a page load error shows a message, not the page", async () => {
		await draw(FIGURE);
		await page(only(), { type: "error", kind: "load" });
		expect(webviews()).toHaveLength(0);
		expect(screen.getByText(MESSAGES.figureLoad)).toBeTruthy();
	});

	it("opens full screen in the zoom viewer", async () => {
		await draw(FIGURE);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-expand")));
		expect(webviews()).toHaveLength(2);
		const html = (webviews()[1]!.props.source as { html: string }).html;
		expect(html).toContain("user-scalable=yes");
	});
});

describe("a figure on a learner photo", () => {
	const PHOTO: Artifact = {
		kind: "figure",
		svg: '<svg viewBox="0 0 4 3"><image href="learner-image" width="4" height="3"/></svg>',
		inverted: false,
		snapshotId: SNAP,
	};
	const IMAGE = { mimeType: "image/png", data: "iVBORw0KGgo=", width: 4, height: 3 };

	it("reads the photo from the Mac and puts it in the SVG; no switch", async () => {
		const mac = fakeActions([json(IMAGE)]);
		await draw(PHOTO, mac.actions);
		await settle();
		expect(mac.calls[0]!.url).toBe(`/api/chats/chat%201/images/${SNAP}`);
		const html = (only().props.source as { html: string }).html;
		const src = /<img [^>]*src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(html)![1]!;
		expect(decodeURIComponent(src)).toContain("data:image/png;base64,iVBORw0KGgo=");
		expect(screen.queryByTestId("artifact-sa_m1-invert")).toBeNull();
	});

	it("shows Loading image while the photo loads", async () => {
		const actions: ArtifactActions = {
			...fakeActions().actions,
			fetch: (() => new Promise(() => {})) as unknown as typeof globalThis.fetch,
		};
		await draw(PHOTO, actions);
		expect(screen.getByText(MESSAGES.imageLoading)).toBeTruthy();
		expect(webviews()).toHaveLength(0);
	});

	it.each([
		["404", json({ error: "Not found" }, 404)],
		["a bad type", json({ ...IMAGE, mimeType: "image/svg+xml" })],
		["a bad width", json({ ...IMAGE, width: 0 })],
		["not JSON", new Response("<html>")],
		["no connection", new Error("Network request failed")],
	])("error state 10: %s", async (_name, answer) => {
		await draw(PHOTO, fakeActions([answer]).actions);
		await settle();
		expect(webviews()).toHaveLength(0);
		expect(screen.getByText(MESSAGES.imageFailed)).toBeTruthy();
		expect(screen.queryByText(/Not found|html/)).toBeNull();
	});
});

describe("the demo", () => {
	it("starts no WebView until the learner taps Run demo", async () => {
		await draw(DEMO);
		expect(webviews()).toHaveLength(0);
		expect(screen.getByText("INTERACTIVE DEMO")).toBeTruthy();
		expect(screen.getByText("Moon distance")).toBeTruthy();
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		const w = only();
		expect((w.props.source as { html: string }).html).toContain(`content="${DEMO_CSP}"`);
		const html = (w.props.source as { html: string }).html;
		expect(html).toContain('<iframe sandbox="allow-scripts" srcdoc="');
		expect(html).toContain("&lt;p>demo&lt;/p>&quot;></iframe>".replace("&quot;>", '">'));
		const allow = w.props.onShouldStartLoadWithRequest as (r: {
			url: string;
			isTopFrame: boolean;
		}) => boolean;
		expect(allow({ url: "about:srcdoc", isTopFrame: false })).toBe(true);
		expect(allow({ url: "https://cdn.jsdelivr.net/", isTopFrame: false })).toBe(false);
		expect(w.props.mediaCapturePermissionGrantType).toBe("deny");
		// Done closes the sheet and ends the WebView.
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-done")));
		expect(webviews()).toHaveLength(0);
	});

	it("error state 4: a page error shows a fixed message, and Send to teacher sends the cleaned text once", async () => {
		const mac = fakeActions();
		await draw(DEMO, mac.actions);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		await page(only(), {
			type: "page-error",
			text: "ReferenceError: x is not defined\n at line 3",
		});
		expect(screen.getAllByText(MESSAGES.demoError).length).toBeGreaterThan(0);
		expect(screen.queryByText(/ReferenceError/)).toBeNull();
		await act(async () => fireEvent.press(screen.getAllByTestId("artifact-sa_m1-send-error")[0]!));
		await settle();
		expect(mac.sent).toEqual([
			'The demo "Moon distance" threw an error: ReferenceError: x is not defined at line 3',
		]);
		expect(screen.queryByTestId("artifact-sa_m1-send-error")).toBeNull();
		expect(screen.getAllByText("Sent to the teacher.").length).toBeGreaterThan(0);
	});

	it("error state 4: a send that the Mac does not take keeps the button", async () => {
		const mac = fakeActions();
		mac.failSend();
		await draw(DEMO, mac.actions);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		await page(only(), { type: "page-error", text: "boom" });
		await act(async () => fireEvent.press(screen.getAllByTestId("artifact-sa_m1-send-error")[0]!));
		await settle();
		expect(mac.sent).toHaveLength(1);
		expect(screen.getAllByTestId("artifact-sa_m1-send-error").length).toBeGreaterThan(0);
	});

	it("error state 12: other page messages are ignored", async () => {
		await draw(DEMO, fakeActions().actions);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		await page(only(), { type: "page-error", text: "x", extra: true });
		await page(only(), "not json");
		await page(only(), { type: "navigate", url: "https://evil.example" });
		expect(screen.queryByText(MESSAGES.demoError)).toBeNull();
		expect(webviews()).toHaveLength(1);
	});

	it("error state 5: one stop loads again; a second stop shows Try again", async () => {
		await draw(DEMO);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		await act(async () => (only().props.onContentProcessDidTerminate as () => void)());
		expect(webviews()).toHaveLength(1);
		await act(async () => (only().props.onContentProcessDidTerminate as () => void)());
		expect(webviews()).toHaveLength(0);
		expect(screen.getByText(MESSAGES.demoStopped)).toBeTruthy();
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-retry")));
		expect(webviews()).toHaveLength(1);
		expect(screen.queryByText(MESSAGES.demoStopped)).toBeNull();
	});

	it("the invert switch goes to the running page and to the Mac", async () => {
		const mac = fakeActions();
		await draw({ ...DEMO, inverted: true }, mac.actions);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		expect(islandData(only())).toEqual({ inverted: true });
		await act(async () =>
			fireEvent(screen.getAllByTestId("artifact-sa_m1-invert")[0]!, "valueChange", false),
		);
		await settle();
		expect(JSON.parse(String(mac.calls[0]!.init!.body))).toEqual({
			input: { messageId: "m1", inverted: false },
		});
	});

	it("without a session there is no Send to teacher button", async () => {
		await draw(DEMO);
		await act(async () => fireEvent.press(screen.getByTestId("artifact-sa_m1-run")));
		await page(only(), { type: "page-error", text: "boom" });
		expect(screen.queryByTestId("artifact-sa_m1-send-error")).toBeNull();
	});
});

describe("the notes (error states 1, 2, 3, 9, 11)", () => {
	it.each<[Artifact, string]>([
		[{ kind: "unreadable", what: "figure" }, MESSAGES.figureUnreadable],
		[{ kind: "unreadable", what: "demo" }, MESSAGES.demoUnreadable],
		[{ kind: "failed", what: "figure" }, MESSAGES.figureFailed],
		[{ kind: "failed", what: "demo" }, MESSAGES.demoFailed],
		[{ kind: "too-large", what: "figure" }, MESSAGES.figureTooLarge],
		[{ kind: "too-large", what: "demo" }, MESSAGES.demoTooLarge],
		[{ kind: "blocked-source" }, MESSAGES.blockedSource],
		[{ kind: "mac-only" }, MESSAGES.macOnly],
	])("%o shows its message and no WebView", async (artifact, message) => {
		await draw(artifact);
		expect(screen.getByText(message)).toBeTruthy();
		expect(webviews()).toHaveLength(0);
	});

	it("a failed artifact shows the FAILED badge", async () => {
		await draw({ kind: "failed", what: "demo" });
		expect(screen.getByText("FAILED")).toBeTruthy();
		expect(screen.getByText("INTERACTIVE DEMO")).toBeTruthy();
	});
});
