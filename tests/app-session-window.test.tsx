/**
 * The page window of a long session (issue 21 slice D, D-014): the screen
 * draws the last page first, and one more page of older rows when the
 * reader scrolls near the top. The record keeps every message.
 */
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { PAGE_ROWS } from "@/lib/transcript-window";
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

const TOTAL = 70;
const text = (i: number) => `Message number ${i} of the long session.`;

let mac: FakeMac;
beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

async function openLong() {
	const messages = Array.from({ length: TOTAL }, (_, i) => ({
		role: "user" as const,
		id: `u_${i}`,
		content: text(i),
		timestamp: i + 1,
	}));
	const id = mac.add("A long session", messages);
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	await fireEvent.press(await teach.findByTestId(`session-${id}`));
	expect(await screen.findByText(text(TOTAL - 1))).toBeTruthy();
}

const scrollTo = (offset: number) =>
	fireEvent.scroll(screen.getByTestId("transcript-scroll"), {
		nativeEvent: {
			contentOffset: { x: 0, y: offset },
			contentSize: { width: 390, height: 6000 },
			layoutMeasurement: { width: 390, height: 800 },
		},
	});

it("draws only the last page first, with the earlier line at the top", async () => {
	await openLong();
	expect(screen.getByText(text(TOTAL - PAGE_ROWS))).toBeTruthy();
	expect(screen.queryByText(text(TOTAL - PAGE_ROWS - 1))).toBeNull();
	expect(screen.queryByText(text(0))).toBeNull();
	expect(screen.getByTestId("earlier-rows")).toBeTruthy();
});

it("adds one page near the top, then the rest, and the earlier line goes", async () => {
	await openLong();
	await scrollTo(3000);
	expect(screen.queryByText(text(TOTAL - PAGE_ROWS - 1))).toBeNull();

	await scrollTo(100);
	expect(await screen.findByText(text(TOTAL - PAGE_ROWS - 1))).toBeTruthy();
	expect(screen.queryByText(text(TOTAL - 2 * PAGE_ROWS - 1))).toBeNull();

	// The next page waits for the content to grow.
	fireEvent(screen.getByTestId("transcript-scroll"), "contentSizeChange", 390, 9000);
	await scrollTo(100);
	expect(await screen.findByText(text(0))).toBeTruthy();
	await waitFor(() => expect(screen.queryByTestId("earlier-rows")).toBeNull());
});
