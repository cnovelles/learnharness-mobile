/**
 * The session screen's controls (issue 04 slice C) with the fake Mac:
 * steer, Stop, Skip, the retry gate, and background and foreground.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";
import { Alert, AppState } from "react-native";

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
// The first session screen in this file loads the whole rich renderer
// (Markdown, Shiki, the islands, the plan graph). Under the full suite's
// load that takes more than 5 s (the Jest default), and a test that times
// out leaves its held stream open for the next tests.
jest.setTimeout(20_000);

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

/** Press the confirm's destructive button (Stop, Skip). */
function confirmAlerts() {
	return jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
		buttons?.find((b) => b.style === "destructive")?.onPress?.();
	});
}

describe("steer, stop, skip, retry and foreground (slice C)", () => {
	afterEach(() => jest.restoreAllMocks());

	/** A session that waits for text; the next text starts a turn that runs until release. */
	async function runningTurn() {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Ask me." }]));
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		mac.holdNext = true;
		await fireEvent.changeText(await screen.findByTestId("composer"), "Why two bulges?");
		await fireEvent.press(screen.getByTestId("send"));
		expect(await screen.findByTestId("turn-running")).toBeTruthy();
		await waitFor(() => expect(mac.holding).toBe(true));
		return id;
	}

	it("while a turn runs, the composer sends a steer; it shows as queued until the teacher takes it", async () => {
		const id = await runningTurn();
		// An empty field: the button is Stop, as on the desktop.
		expect(screen.getByTestId("stop-turn")).toBeTruthy();
		expect(screen.queryByTestId("send")).toBeNull();
		await fireEvent.changeText(screen.getByTestId("composer"), "Use the Earth's spin too.");
		// Typed text: the button sends a steer.
		expect(screen.queryByTestId("stop-turn")).toBeNull();
		await fireEvent.press(screen.getByTestId("send"));

		await waitFor(() => expect(mac.steers).toHaveLength(1));
		expect(mac.steers[0]).toMatchObject({ type: "steer", text: "Use the Earth's spin too." });
		expect(screen.getByText("Waiting for the teacher: Use the Earth's spin too.")).toBeTruthy();
		expect(screen.getByTestId("composer").props.value).toBe("");

		await act(async () =>
			mac.release(id, [mac.assistant([{ type: "text", text: "With the spin." }])]),
		);
		await tick();
		expect(await screen.findByText("With the spin.", {})).toBeTruthy();
		await waitFor(() => expect(screen.queryByTestId("queued-steers")).toBeNull());
	});

	it("error state: a refused steer puts its text back into the composer with a clear message", async () => {
		const id = await runningTurn();
		mac.steerAnswer = {
			status: 403,
			body: { error: "This action is available only on the desktop." },
		};
		await fireEvent.changeText(screen.getByTestId("composer"), "Faster please.");
		await fireEvent.press(screen.getByTestId("send"));
		expect(
			await screen.findByText("The phone cannot do this yet. Use LearnHarness on the Mac for it."),
		).toBeTruthy();
		expect(screen.getByTestId("composer").props.value).toBe("Faster please.");
		expect(screen.queryByTestId("queued-steers")).toBeNull();
		await act(async () => mac.release(id));
	});

	it("error state: a steer that the Mac answers with 409 while the phone still settles the turn keeps its text", async () => {
		// 409: the turn ended on the Mac. SessionModel then sends the text as an
		// ordinary message, but only once its own turn is settled. Until then the
		// text goes back into the composer, so nothing is lost.
		const id = await runningTurn();
		mac.steerAnswer = { status: 409, body: { error: "not running" } };
		await fireEvent.changeText(screen.getByTestId("composer"), "And the Sun?");
		await fireEvent.press(screen.getByTestId("send"));
		await tick();
		await waitFor(() => expect(screen.getByTestId("composer").props.value).toBe("And the Sun?"));
		expect(screen.queryByTestId("session-error")).toBeNull();
		expect(screen.queryByTestId("queued-steers")).toBeNull();
		await act(async () => mac.release(id));
	});

	it("Stop asks first, then stops the turn on the Mac", async () => {
		const alert = confirmAlerts();
		const id = await runningTurn();
		await fireEvent.press(screen.getByTestId("stop-turn"));
		expect(alert).toHaveBeenCalledWith(
			"Stop this turn?",
			"The partial answer stays.",
			expect.any(Array),
		);
		await waitFor(() => expect(mac.aborts).toEqual([{ kind: "turn", id }]));
		await waitFor(() => expect(screen.queryByTestId("turn-running")).toBeNull());
		expect(screen.queryByTestId("session-error")).toBeNull();
		expect(screen.queryByTestId("stop-turn")).toBeNull();
		mac.release(id);
	});

	it("Cancel in the Stop confirm does nothing", async () => {
		jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
			buttons?.find((b) => b.style === "cancel")?.onPress?.();
		});
		const id = await runningTurn();
		await fireEvent.press(screen.getByTestId("stop-turn"));
		expect(mac.aborts).toEqual([]);
		expect(screen.getByTestId("turn-running")).toBeTruthy();
		await act(async () => mac.release(id));
	});

	it("error state: an abort that answers 409 (no turn runs) is not an error", async () => {
		confirmAlerts();
		const id = await runningTurn();
		mac.abortAnswer = { status: 409, body: { ok: false, reason: "not_running" } };
		await fireEvent.press(screen.getByTestId("stop-turn"));
		await waitFor(() => expect(mac.aborts).toHaveLength(1));
		await waitFor(() => expect(screen.queryByTestId("turn-running")).toBeNull());
		expect(screen.queryByTestId("session-error")).toBeNull();
		mac.release(id);
	});

	it("error state: an abort that fails says that the turn still runs on the Mac, and attaches again", async () => {
		confirmAlerts();
		const id = await runningTurn();
		mac.abortAnswer = { status: 500, body: { error: "boom: internal" } };
		const streamReads = () =>
			(globalThis.fetch as jest.Mock).mock.calls.filter(([u]) => String(u).endsWith("/stream"))
				.length;
		const before = streamReads();
		await fireEvent.press(screen.getByTestId("stop-turn"));
		expect(
			await screen.findByText(
				"The phone could not stop the turn. It still runs on the Mac. Try again in a moment.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/boom/)).toBeNull();
		expect(streamReads()).toBeGreaterThan(before);
		mac.release(id);
	});

	/** A session with a probe that waits. */
	function waitingProbe() {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats
			.get(id)!
			.messages.push(
				mac.assistant([{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE }]),
			);
		return id;
	}

	it("a waiting probe has no Skip: the dock starts with PROBE and offers I don't know", async () => {
		const id = waitingProbe();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByTestId("dock-question")).toBeTruthy();
		expect(screen.getByTestId("dock-kind")).toHaveTextContent("PROBE");
		expect(screen.getByTestId("dont-know")).toBeTruthy();
		expect(screen.queryByTestId("skip-question")).toBeNull();
		expect(screen.queryByText("Skip")).toBeNull();
		expect(mac.dismissals).toEqual([]);
	});

	it("a question that was dismissed on the Mac still shows as skipped in the transcript", async () => {
		const id = waitingProbe();
		mac.chats.get(id)!.messages.push({
			role: "toolResult",
			id: "r_probe",
			toolCallId: "call_probe",
			toolName: "probe",
			content: [{ type: "text", text: "dismissed" }],
			details: { dismissed: true, kind: "quiz", questionText: PROBE.question },
			isError: false,
			timestamp: 3,
		});
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("You skipped this question.")).toBeTruthy();
		expect(screen.queryByTestId("dock-question")).toBeNull();
	});

	it("error state: no Try again when the record does not end in a failed turn (nothing to retry)", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Done." }]));
		mac.chats.get(id)!.turnError = "weird";
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByTestId("session-error")).toBeTruthy();
		expect(screen.queryByTestId("retry-turn")).toBeNull();
		expect(screen.getByTestId("clear-error")).toBeTruthy();
		expect(mac.inputs).toEqual([]);
	});

	it("error state: Try again waits while the Mac compacts", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		const chat = mac.chats.get(id)!;
		chat.turnError = "boom";
		chat.messages.push({ ...mac.assistant([]), stopReason: "error", errorMessage: "boom" });
		chat.compacting = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByTestId("retry-turn")).toBeDisabled();
	});

	it("error state: a record read that fails after the foreground shows the message with Try again", async () => {
		const changes: ((s: string) => void)[] = [];
		jest.spyOn(AppState, "addEventListener").mockImplementation((_type, fn) => {
			changes.push(fn as (s: string) => void);
			return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
		});
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Hello." }]));
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("Hello.")).toBeTruthy();
		await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));

		mac.failRecordReads = 1;
		await act(async () => changes.forEach((fn) => fn("background")));
		await act(async () => changes.forEach((fn) => fn("active")));
		expect(
			await screen.findByText("The phone could not read this session from the Mac. Try again."),
		).toBeTruthy();
		expect(screen.queryByText(/disk on fire/)).toBeNull();

		// Meanwhile the Mac has a new message. Try again reads it.
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "New on the Mac." }]));
		await fireEvent.press(screen.getByTestId("retry-turn"));
		expect(await screen.findByText("New on the Mac.")).toBeTruthy();
		await waitFor(() => expect(screen.queryByTestId("session-error")).toBeNull());
	});

	it("the app goes to the background: the phone stops reading the stream; back in the foreground it attaches again", async () => {
		const changes: ((s: string) => void)[] = [];
		jest.spyOn(AppState, "addEventListener").mockImplementation((_type, fn) => {
			changes.push(fn as (s: string) => void);
			return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
		});
		const id = await runningTurn();
		await act(async () => changes.forEach((fn) => fn("background")));
		await waitFor(() => expect(screen.queryByTestId("turn-running")).toBeNull());
		// The turn runs on, on the Mac. It ends while the phone is away.
		mac.release(id, [mac.assistant([{ type: "text", text: "Finished while away." }])]);
		await act(async () => changes.forEach((fn) => fn("active")));
		expect(await screen.findByText("Finished while away.")).toBeTruthy();
		expect(mac.aborts).toEqual([]);
	});
});
