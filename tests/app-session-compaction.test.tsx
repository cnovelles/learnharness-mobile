/**
 * The session screen during a compaction (issue 04 slice D) with the fake
 * Mac: sends and answers wait, the missed end event, the 30 s check, the
 * compaction dividers and the one error banner. Note: renderRouter turns on Jest's fake
 * timers. package.json keeps nextTick and queueMicrotask real, because the
 * web streams use them and a new fake clock in the next test lost them.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, PROBE, pairedConnection } from "./helpers/fake-mac";

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

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

/**
 * renderRouter turns on Jest's fake timers. Advance them inside act, so
 * async work (a stream end, an event, a record read) and its effects
 * finish before the next check.
 */
const tick = (ms = 100) => act(() => jest.advanceTimersByTimeAsync(ms));

describe("compaction and the error banner (slice D)", () => {
	afterEach(() => jest.restoreAllMocks());

	function compactingSession() {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		const chat = mac.chats.get(id)!;
		chat.messages.push(mac.assistant([{ type: "text", text: "Ask me." }]));
		chat.compacting = true;
		return id;
	}

	it("error state: a missed compaction-changed event is fixed by the next record read", async () => {
		const id = compactingSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByTestId("compacting")).toBeTruthy();
		await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));
		mac.chats.get(id)!.compacting = false;
		await act(async () => mac.emit("record-changed", { chatId: id }));
		await tick();
		await waitFor(() => expect(screen.queryByTestId("compacting")).toBeNull());
	});

	it("while the Mac compacts, sends wait; compaction-changed ends the wait", async () => {
		const id = compactingSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("The Mac is making the history shorter…")).toBeTruthy();
		await fireEvent.changeText(screen.getByTestId("composer"), "Hello?");
		expect(screen.getByTestId("send")).toBeDisabled();

		await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));
		mac.chats.get(id)!.compacting = false;
		await act(async () => mac.emit("compaction-changed", { chatId: id, running: false }));
		await tick();
		await waitFor(() => expect(screen.queryByTestId("compacting")).toBeNull());
		expect(screen.getByTestId("send")).not.toBeDisabled();
	});

	it("an answer waits while the Mac compacts", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats
			.get(id)!
			.messages.push(
				mac.assistant([{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE }]),
			);
		mac.chats.get(id)!.compacting = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.press(await screen.findByTestId("option-moon"));
		expect(screen.getByTestId("submit-answer")).toBeDisabled();
	});

	it("error state: a compaction that never ends does not lock the screen: the phone reads the record every 30 s", async () => {
		const id = compactingSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByTestId("compacting")).toBeTruthy();
		// Reading still works while it compacts.
		expect(screen.getByText("Ask me.")).toBeTruthy();
		// The end event never comes. After 30 s the phone reads the record.
		mac.chats.get(id)!.compacting = false;
		await tick(10_000);
		expect(screen.getByTestId("compacting")).toBeTruthy();
		await tick(20_000);
		await waitFor(() => expect(screen.queryByTestId("compacting")).toBeNull());
	});

	it("the transcript shows where the history was compacted", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Long talk." }]), {
			role: "custom",
			id: "cmp_1",
			customType: "compaction",
			content: "summary",
			display: true,
			details: { firstKeptMessageId: "u_1", tokensBefore: 12000 },
			timestamp: 9,
		});
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("Context compacted")).toBeTruthy();
	});

	it("error state: Close removes the banner; one banner at a time", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.turnError = "weird";
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Done." }]));
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findAllByTestId("session-error")).toHaveLength(1);
		await fireEvent.press(screen.getByTestId("clear-error"));
		await waitFor(() => expect(screen.queryByTestId("session-error")).toBeNull());
	});
});
