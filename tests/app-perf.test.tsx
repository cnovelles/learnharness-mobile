/**
 * The perf marks in the app (issue 21 slice A): a tap on a session row
 * starts an open, the session screen marks each phase, and the panel in
 * Settings shows the open.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { router } from "expo-router";
import { Alert } from "react-native";
import path from "node:path";

import { perf } from "@/lib/perf";
import { MARKS } from "@/lib/perf-marks";
import { FakeMac, pairedConnection } from "./helpers/fake-mac";
import { inTab } from "./helpers/tabs";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({
	isDevice: true,
	deviceName: "Test iPhone",
	modelName: "iPhone 13 Pro Max",
}));
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
jest.setTimeout(20_000);

let mac: FakeMac;
beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
	perf.clear();
});

async function openFromRow() {
	const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	await fireEvent.press(await teach.findByTestId(`session-${id}`));
	await waitFor(() => expect(perf.opens()).toHaveLength(1));
	return id;
}

it("a tap on a row records an open with all five marks in order", async () => {
	const id = await openFromRow();
	const [open] = perf.opens();
	expect(open).toMatchObject({
		chatId: id,
		title: "Tides",
		messages: 1,
		from: "tap",
		outcome: "end",
	});
	const times = MARKS.map((m) => open!.marks[m]);
	expect(times.every((t) => typeof t === "number")).toBe(true);
	expect([...times].sort((a, b) => a! - b!)).toEqual(times);
	expect(open!.build).toMatchObject({ device: "iPhone 13 Pro Max", type: "dev" });
});

it("the panel in Settings shows the open, and Clear asks first", async () => {
	await openFromRow();
	await act(async () => router.push("/settings"));
	expect(await screen.findByText("Developer: performance")).toBeTruthy();
	expect(screen.getByTestId("perf-opens")).toHaveTextContent("1");
	expect(screen.getByTestId("perf-build")).toHaveTextContent(/^Dev · .+ · iPhone 13 Pro Max$/);
	expect(screen.getByTestId("perf-phase-fetch")).toHaveTextContent(/ms|s$/);
	expect(screen.getByText(/Last open · Tides \(1 messages\)/)).toBeTruthy();
	expect(screen.getByTestId("perf-live")).toHaveTextContent("0");

	const alert = jest.spyOn(Alert, "alert");
	await fireEvent.press(screen.getByTestId("perf-clear"));
	expect(perf.opens()).toHaveLength(1);
	const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
	await act(async () => buttons.find((b) => b.text === "Clear")!.onPress!());
	expect(await screen.findByTestId("perf-empty")).toBeTruthy();
});
