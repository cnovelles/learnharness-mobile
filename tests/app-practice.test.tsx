/**
 * Practice sessions on the phone (issue 06) with expo-router's test
 * renderer and the fake Mac: the home "New practice" button, the practice
 * start, and (later slices) the problem dock, the cards and Next problem.
 */
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, PROBE, type Rec, pairedConnection } from "./helpers/fake-mac";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({ deviceName: "Test iPhone" }));
// Each pinned fetch keeps the fake Mac of its own test, so work that an
// earlier test left running cannot reach the next test's Mac.
jest.mock("@/lib/native-pinned-fetch", () => ({
	nativePinnedFetch: () => {
		const f = globalThis.fetch as typeof fetch;
		return (url: string, init: RequestInit) => f(url, init);
	},
}));
jest.mock("expo-camera", () => ({
	CameraView: () => null,
	useCameraPermissions: () => [{ granted: false }, async () => ({ granted: false })],
}));

const APP = path.resolve(__dirname, "../src/app");
// The first session screen in this file loads the whole rich renderer
// (Markdown, Shiki, the islands, the plan graph). That takes about 1 s on a
// Mac and more than 5 s (the Jest default) on the CI runner.
jest.setTimeout(20_000);

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

describe("slice A: start a practice session", () => {
	it("home has a New practice button next to New session", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		expect(await screen.findByTestId("new-session")).toBeTruthy();
		expect(screen.getByTestId("new-practice")).toBeTruthy();
		expect(screen.getByText("New practice")).toBeTruthy();
	});

	it("New practice opens the practice form and starts a practice session with the text", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		await fireEvent.press(await screen.findByTestId("new-practice"));
		expect(await screen.findByText("What do you want to practice?")).toBeTruthy();
		expect(screen.getByText("Start practice")).toBeTruthy();
		expect(screen).toHavePathname("/new-session");
		await fireEvent.changeText(screen.getByTestId("opening-text"), "Linear recurrences");
		await fireEvent.press(screen.getByTestId("start-session"));

		await waitFor(() => expect(screen).toHavePathname("/session/chat_1"));
		expect(mac.chats.get("chat_1")).toMatchObject({
			title: "Linear recurrences",
			kind: "practice",
		});
		await waitFor(() => expect(mac.inputs).toEqual([{ type: "text", text: "Linear recurrences" }]));
	});

	it("New session still starts a teaching session", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		await fireEvent.press(await screen.findByTestId("new-session"));
		expect(await screen.findByText("What do you want to learn?")).toBeTruthy();
		await fireEvent.changeText(screen.getByTestId("opening-text"), "Tides");
		await fireEvent.press(screen.getByTestId("start-session"));
		await waitFor(() => expect(screen).toHavePathname("/session/chat_1"));
		expect(mac.chats.get("chat_1")!.kind).toBeUndefined();
	});

	it("error state: the Mac refuses the new practice session; the text stays", async () => {
		mac.createAnswer = { status: 500, body: { error: "disk on fire" } };
		await renderRouter(APP, { initialUrl: "/new-session?kind=practice" });
		await fireEvent.changeText(await screen.findByTestId("opening-text"), "Linear recurrences");
		await fireEvent.press(screen.getByTestId("start-session"));
		expect(await screen.findByTestId("new-session-error")).toBeTruthy();
		expect(screen.queryByText(/disk on fire/)).toBeNull();
		expect(screen.getByTestId("opening-text").props.value).toBe("Linear recurrences");
		expect(screen).toHavePathname("/new-session");
		expect(mac.chats.size).toBe(0);
	});
});
