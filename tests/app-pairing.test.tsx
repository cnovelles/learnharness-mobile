/**
 * The app shell (src/app) with expo-router's test renderer: the root layout,
 * its guards and the pair, home and settings screens. The Keychain is an
 * in-memory mock and the Mac is a fake behind the pinned fetch (the native
 * module is mocked; a wrong pin rejects like the native module does).
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";
import { Alert } from "react-native";

import { headerButton, inTab } from "./helpers/tabs";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({ deviceName: "Test iPhone" }));
// The native PinnedFetch: delegates to fetchMock after the pin check.
jest.mock("@/lib/native-pinned-fetch", () => {
	const { PinMismatchError } = jest.requireActual("@/lib/pairing");
	return {
		nativePinnedFetch: () => (url: string, init: RequestInit & { pin: string }) =>
			init.pin === mockMacPin
				? (globalThis.fetch as typeof fetch)(url, init)
				: Promise.reject(new PinMismatchError()),
	};
});
jest.mock("expo-camera", () => ({
	CameraView: () => null,
	useCameraPermissions: () => [{ granted: false }, async () => ({ granted: false })],
}));

const APP = path.resolve(__dirname, "../src/app");
const CODE = "c".repeat(24);
const PIN = `sha256/${"A".repeat(42)}Q=`;
/** The pin of the certificate that the fake Mac shows. */
let mockMacPin = PIN;
const PAYLOAD = JSON.stringify({
	lh: 2,
	name: "Studio Mac",
	urls: ["https://192.168.1.20:47821"],
	pin: PIN,
	code: CODE,
});

/** The fake Mac. `pingStatus` changes what /phone/v1/ping answers. */
let pingStatus = 200;
let pairedDevices: string[] = [];
const fakeMac = async (url: string, init?: RequestInit) => {
	if (url.endsWith("/phone/v1/pair")) {
		const body = JSON.parse(String(init?.body));
		if (body.code !== CODE)
			return new Response(
				JSON.stringify({
					error: "The pairing code is not valid or has expired. Show a new QR code on the Mac.",
				}),
				{ status: 401 },
			);
		pairedDevices.push(body.deviceName);
		return new Response(
			JSON.stringify({
				token: "t".repeat(43),
				deviceId: "dev_1",
				protocol: 2,
				server: { name: "Studio Mac", version: "0.6.1" },
			}),
			{ status: 200 },
		);
	}
	if (url.endsWith("/phone/v1/ping"))
		return new Response(JSON.stringify({ ok: pingStatus === 200 }), { status: pingStatus });
	throw new TypeError("Network request failed");
};
const fetchMock = jest.fn(fakeMac);

beforeEach(() => {
	mockKeychain.clear();
	pingStatus = 200;
	mockMacPin = PIN;
	pairedDevices = [];
	fetchMock.mockReset();
	fetchMock.mockImplementation(fakeMac);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
});

it("an unpaired phone opens on the pair screen; pasting the text pairs and shows the connected home", async () => {
	await renderRouter(APP, { initialUrl: "/" });
	expect(await screen.findByText("Or paste the pairing text")).toBeTruthy();
	expect(screen).toHavePathname("/pair");

	await fireEvent.changeText(screen.getByTestId("pairing-text"), PAYLOAD);
	await fireEvent.press(screen.getByTestId("pair"));

	expect(await (await inTab("teach")).findByText("Connected · Studio Mac")).toBeTruthy();
	expect(screen).toHavePathname("/");
	expect(pairedDevices).toEqual(["Test iPhone"]);
	expect(JSON.parse(mockKeychain.get("lh.connection.v1")!)).toMatchObject({
		name: "Studio Mac",
		token: "t".repeat(43),
	});
});

it("a refused code shows the Mac's message and stays on the pair screen", async () => {
	await renderRouter(APP, { initialUrl: "/" });
	await fireEvent.changeText(
		await screen.findByTestId("pairing-text"),
		PAYLOAD.replace(CODE, "x".repeat(24)),
	);
	await fireEvent.press(screen.getByTestId("pair"));
	expect(await screen.findByText(/The pairing code is not valid or has expired/)).toBeTruthy();
	expect(screen).toHavePathname("/pair");
	expect(mockKeychain.size).toBe(0);
});

it("text that is not a pairing code shows a clear error", async () => {
	await renderRouter(APP, { initialUrl: "/" });
	await fireEvent.changeText(await screen.findByTestId("pairing-text"), "hello");
	await fireEvent.press(screen.getByTestId("pair"));
	expect(await screen.findByText("This is not a LearnHarness pairing code.")).toBeTruthy();
	expect(fetchMock).not.toHaveBeenCalled();
});

describe("a paired phone", () => {
	beforeEach(() => {
		mockKeychain.set(
			"lh.connection.v1",
			JSON.stringify({
				name: "Studio Mac",
				urls: ["https://192.168.1.20:47821"],
				pin: PIN,
				token: "t".repeat(43),
				deviceId: "dev_1",
				pairedAt: "2026-11-14T00:00:00.000Z",
			}),
		);
	});

	it("opens connected, and settings show the Mac and the address in use", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		const teach = await inTab("teach");
		expect(await teach.findByText("Connected · Studio Mac")).toBeTruthy();
		await fireEvent.press(await headerButton("open-settings"));
		expect(await screen.findByTestId("mac-name")).toHaveTextContent("Studio Mac");
		expect(screen.getByTestId("mac-address")).toHaveTextContent("https://192.168.1.20:47821");
	});

	it("shows what to check when the Mac does not answer", async () => {
		fetchMock.mockImplementation(async () => {
			throw new TypeError("Network request failed");
		});
		await renderRouter(APP, { initialUrl: "/" });
		expect(
			await (
				await inTab("teach")
			).findByText(/The phone cannot reach Studio Mac\. Make sure that the Mac is on/),
		).toBeTruthy();
	});

	it("a removal on the Mac (401) asks to pair again", async () => {
		pingStatus = 401;
		await renderRouter(APP, { initialUrl: "/" });
		expect(await screen.findByTestId("removed-message")).toHaveTextContent(
			"This phone was removed on the Mac. Pair again.",
		);
		expect(screen).toHavePathname("/pair");
		expect(mockKeychain.size).toBe(0);
	});

	it("another certificate at the Mac's address gets no token, and the pairing stays", async () => {
		mockMacPin = `sha256/${"B".repeat(42)}Q=`;
		await renderRouter(APP, { initialUrl: "/" });
		expect(
			await (
				await inTab("teach")
			).findByText(/A device answered at the address of Studio Mac, but it is not Studio Mac/),
		).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mockKeychain.size).toBe(1);
	});

	it('"Forget this Mac" asks first, then deletes the pairing', async () => {
		const alert = jest.spyOn(Alert, "alert");
		await renderRouter(APP, { initialUrl: "/settings" });
		await fireEvent.press(await screen.findByTestId("forget"));
		expect(alert).toHaveBeenCalledWith(
			"Forget this Mac?",
			expect.stringContaining("Studio Mac"),
			expect.any(Array),
		);
		expect(mockKeychain.size).toBe(1);
		const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
		await act(async () => buttons.find((b) => b.text === "Forget")!.onPress!());
		await waitFor(() => expect(screen).toHavePathname("/pair"));
		expect(mockKeychain.size).toBe(0);
	});

	describe("developer section (feature flags)", () => {
		const realDev = __DEV__;
		afterEach(() => {
			(globalThis as unknown as { __DEV__: boolean }).__DEV__ = realDev;
		});

		it("is hidden in a release build until Version is tapped 7 times, and stays open", async () => {
			(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
			await renderRouter(APP, { initialUrl: "/settings" });
			const version = await screen.findByTestId("version");
			for (let i = 0; i < 6; i++) await fireEvent.press(version);
			expect(screen.queryByText("Developer: modes")).toBeNull();
			await fireEvent.press(version);
			expect(await screen.findByText("Developer: modes")).toBeTruthy();
			expect(JSON.parse(mockKeychain.get("lh.flags.v1")!)).toMatchObject({ developer: true });
		});

		it("saves a mode switch on this phone and refuses to turn off the last mode", async () => {
			await renderRouter(APP, { initialUrl: "/settings" });
			expect(await screen.findByText("Developer: modes")).toBeTruthy();
			expect(screen.getByTestId("flag-onPhone").props.value).toBe(false);

			await act(async () => fireEvent(screen.getByTestId("flag-onPhone"), "valueChange", true));
			await waitFor(() => expect(screen.getByTestId("flag-onPhone").props.value).toBe(true));
			expect(JSON.parse(mockKeychain.get("lh.flags.v1")!).overrides).toEqual({ onPhone: true });

			await act(async () => fireEvent(screen.getByTestId("flag-onPhone"), "valueChange", false));
			await act(async () => fireEvent(screen.getByTestId("flag-macRemote"), "valueChange", false));
			expect(await screen.findByText("At least one mode must stay on.")).toBeTruthy();
			expect(screen.getByTestId("flag-macRemote").props.value).toBe(true);
			// The pairing is untouched by flag changes.
			expect(mockKeychain.has("lh.connection.v1")).toBe(true);
		});
	});
});
