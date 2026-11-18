/**
 * The tab shell (issue 20, slice A): Teach, Practice and Graph tabs, each
 * with its own list, and screens that open over the tab bar.
 */
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, pairedConnection } from "./helpers/fake-mac";
import { headerButton, inTab } from "./helpers/tabs";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({ deviceName: "Test iPhone" }));
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
});

it('"/" opens the Teach tab with the teach sessions only', async () => {
	const id = mac.add("How the tides work");
	mac.add("Linear recurrences", [], "practice");
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByTestId(`session-${id}`)).toHaveTextContent(/How the tides work/);
	expect(teach.queryByText("Linear recurrences")).toBeNull();
	expect(screen).toHavePathname("/");
});

it("the Practice tab lists the practice sessions only", async () => {
	mac.add("How the tides work");
	const id = mac.add("Linear recurrences", [], "practice");
	await renderRouter(APP, { initialUrl: "/practice" });
	const practice = await inTab("practice");
	expect(await practice.findByTestId(`session-${id}`)).toHaveTextContent(/Linear recurrences/);
	expect(practice.queryByText("How the tides work")).toBeNull();
	expect(screen).toHavePathname("/practice");
});

it("an empty tab asks the learner to start a session (error state 4)", async () => {
	mac.add("Linear recurrences", [], "practice");
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByText("Start a session to begin learning.")).toBeTruthy();
});

it("the Graph tab shows the placeholder and the connection status", async () => {
	await renderRouter(APP, { initialUrl: "/graph" });
	const graph = await inTab("graph");
	expect(graph.getByText("The graph comes in a later update.")).toBeTruthy();
	expect(await graph.findByText("Connected · Studio Mac")).toBeTruthy();
});

it("a session opens over the tabs, and back returns to the tab", async () => {
	const id = mac.add("How the tides work");
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	await fireEvent.press(await teach.findByTestId(`session-${id}`));
	expect(screen).toHavePathname(`/session/${id}`);
});

it("the gear opens Settings from the Practice tab", async () => {
	await renderRouter(APP, { initialUrl: "/practice" });
	await fireEvent.press(await headerButton("open-settings", "practice"));
	expect(await screen.findByTestId("mac-name")).toHaveTextContent("Studio Mac");
	expect(screen).toHavePathname("/settings");
});

it('the "+" is off while the Mac is not connected', async () => {
	globalThis.fetch = jest.fn(async () => {
		throw new TypeError("Network request failed");
	}) as unknown as typeof fetch;
	await renderRouter(APP, { initialUrl: "/" });
	await (await inTab("teach")).findByText(/The phone cannot reach Studio Mac/);
	expect(await headerButton("new-session")).toBeDisabled();
});
