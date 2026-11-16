/**
 * Dictation in the app (issue 07): the mic in the question dock and the
 * composer, the Stop row, the text in the field, a refused microphone, and
 * the Dictation section of Settings with both engines. The native module is
 * a fake; the native engines have their own tests on macOS
 * (npm run test:native-dictation, npm run test:native-deepgram).
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, PROBE, pairedConnection } from "./helpers/fake-mac";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({ deviceName: "Test iPhone" }));
jest.mock("@/lib/reveal-gate", () => {
	const actual = jest.requireActual("@/lib/reveal-gate");
	return { ...actual, createRevealGate: () => actual.createRevealGate(0) };
});
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

type Listener = (e: Record<string, unknown>) => void;
const mockNative = {
	listeners: new Map<string, Set<Listener>>(),
	calls: [] as unknown[][],
	mic: "granted" as "granted" | "denied" | "undetermined",
	model: "installed",
	emit(event: string, body: Record<string, unknown>) {
		for (const fn of [...(this.listeners.get(event) ?? [])]) fn(body);
	},
	lastId(): string {
		const start = [...this.calls].reverse().find((c) => String(c[0]).startsWith("start"));
		return String(start?.[1]);
	},
	reset() {
		this.listeners.clear();
		this.calls = [];
		this.mic = "granted";
		this.model = "installed";
	},
};
jest.mock("@/lib/native-dictation", () => {
	const native = {
		isSupported: () => true,
		microphonePermission: () => mockNative.mic,
		requestMicrophone: async () => mockNative.mic === "granted",
		status: async () => ({ engine: "speech", locale: "en_US", model: mockNative.model }),
		install: async () => {
			mockNative.calls.push(["install"]);
			mockNative.model = "installed";
		},
		start: async (id: string, language: string) =>
			void mockNative.calls.push(["start", id, language]),
		startFile: async () => {},
		startDeepgram: async (id: string, language: string, token: string) =>
			void mockNative.calls.push(["startDeepgram", id, language, token]),
		stop: async () => {
			mockNative.calls.push(["stop"]);
			mockNative.emit("speechEnd", { id: mockNative.lastId() });
		},
		cancel: async () => void mockNative.calls.push(["cancel"]),
		addListener(event: string, fn: Listener) {
			if (!mockNative.listeners.has(event)) mockNative.listeners.set(event, new Set());
			mockNative.listeners.get(event)!.add(fn);
			return { remove: () => mockNative.listeners.get(event)!.delete(fn) };
		},
	};
	return { nativeDictation: () => native };
});

const APP = path.resolve(__dirname, "../src/app");
jest.setTimeout(20_000);

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mockNative.reset();
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

function sessionWithProbe(): string {
	const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
	mac.chats
		.get(id)!
		.messages.push(
			mac.assistant([{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE }]),
		);
	return id;
}

async function speak(text: string) {
	await act(async () => {
		mockNative.emit("speechLevel", { id: mockNative.lastId(), level: 0.2 });
		mockNative.emit("speechText", { id: mockNative.lastId(), text });
	});
}

it("the question dock: dictate, Stop, and the text goes after what you typed in Your thinking", async () => {
	const id = sessionWithProbe();
	await renderRouter(APP, { initialUrl: `/session/${id}` });
	await fireEvent.press(await screen.findByTestId("option-moon"));
	await fireEvent.changeText(screen.getByTestId("thinking"), "I think");
	await fireEvent.press(screen.getByTestId("dictate"));

	// Listening: Stop and the meter take the place of the mic and Send answer.
	expect(await screen.findByTestId("dictation-stop")).toBeTruthy();
	expect(screen.queryByTestId("submit-answer")).toBeNull();
	expect(mockNative.calls[0]).toEqual(["start", mockNative.lastId(), "en"]);

	await speak("the Moon pulls the water.");
	// No live text: the field changes only at the end.
	expect(screen.getByTestId("thinking").props.value).toBe("I think");
	await fireEvent.press(screen.getByTestId("dictation-stop"));
	await waitFor(() =>
		expect(screen.getByTestId("thinking").props.value).toBe("I think the Moon pulls the water."),
	);
	expect(screen.getByTestId("submit-answer")).toBeTruthy();
	expect(screen.queryByTestId("dictation-problem")).toBeNull();
});

it("the composer: the text goes into the message field", async () => {
	const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
	mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Ask me anything." }]));
	await renderRouter(APP, { initialUrl: `/session/${id}` });
	await fireEvent.press(await screen.findByTestId("dictate"));
	expect(await screen.findByTestId("dictation-stop")).toBeTruthy();
	expect(screen.queryByTestId("composer")).toBeNull();
	await speak("Why two bulges?");
	await fireEvent.press(screen.getByTestId("dictation-stop"));
	await waitFor(() => expect(screen.getByTestId("composer").props.value).toBe("Why two bulges?"));
});

it("no speech heard: the message shows, and its close button clears it", async () => {
	const id = sessionWithProbe();
	await renderRouter(APP, { initialUrl: `/session/${id}` });
	await fireEvent.press(await screen.findByTestId("dictate"));
	await fireEvent.press(await screen.findByTestId("dictation-stop"));
	expect(await screen.findByText("No speech heard.")).toBeTruthy();
	await fireEvent.press(screen.getByTestId("dictation-problem-close"));
	expect(screen.queryByText("No speech heard.")).toBeNull();
});

it("a refused microphone: the message has Open Settings, and no run starts", async () => {
	mockNative.mic = "denied";
	const id = sessionWithProbe();
	await renderRouter(APP, { initialUrl: `/session/${id}` });
	await fireEvent.press(await screen.findByTestId("dictate"));
	expect(await screen.findByText("Microphone access is off for LearnHarness.")).toBeTruthy();
	expect(screen.getByTestId("dictation-open-settings")).toBeTruthy();
	expect(mockNative.calls).toEqual([]);
});

it("Settings: choose Deepgram; the next run takes the Mac's token and language", async () => {
	mac.sttToken = "grant-1";
	mac.dictationLanguage = "multi";
	await renderRouter(APP, { initialUrl: "/settings" });
	expect(await screen.findByTestId("dictation-engine-on-device")).toBeTruthy();
	// The on-device engine uses the phone's language for "multi".
	expect(await screen.findByText(/\(set on the Mac\)$/)).toBeTruthy();
	await waitFor(() =>
		expect(screen.getByTestId("dictation-model")).toHaveTextContent("Downloaded"),
	);

	await fireEvent.press(screen.getByTestId("dictation-engine-deepgram"));
	await waitFor(() => expect(mockKeychain.get("lh.dictation.engine")).toBe("deepgram"));
	expect(await screen.findByText("multi (set on the Mac)")).toBeTruthy();

	const id = sessionWithProbe();
	await act(async () => {
		const { router } = jest.requireActual("expo-router");
		router.push(`/session/${id}`);
	});
	await fireEvent.press(await screen.findByTestId("dictate"));
	await waitFor(() =>
		expect(mockNative.calls[0]).toEqual(["startDeepgram", mockNative.lastId(), "multi", "grant-1"]),
	);
});

it("Deepgram with no key on the Mac: a clear message, no socket", async () => {
	mockKeychain.set("lh.dictation.engine", "deepgram");
	const id = sessionWithProbe();
	await renderRouter(APP, { initialUrl: `/session/${id}` });
	await fireEvent.press(await screen.findByTestId("dictate"));
	expect(
		await screen.findByText(
			"Dictation with Deepgram needs a Deepgram key on the Mac. Add it in the Mac's Settings, under Keys.",
		),
	).toBeTruthy();
	expect(mockNative.calls).toEqual([]);
});

it("Settings: a model that is not on the iPhone downloads with the button", async () => {
	mockNative.model = "supported";
	await renderRouter(APP, { initialUrl: "/settings" });
	await fireEvent.press(await screen.findByTestId("dictation-download"));
	await waitFor(() => expect(mockNative.calls).toContainEqual(["install"]));
	await waitFor(() =>
		expect(screen.getByTestId("dictation-model")).toHaveTextContent("Downloaded"),
	);
});
