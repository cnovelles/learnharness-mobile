/**
 * The page window of a long session (issue 21 slice D, D-014): the screen
 * draws the last page first, and one more page of older rows when the
 * reader scrolls near the top. The record keeps every message.
 */
import { router } from "expo-router";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { act } from "@testing-library/react-native";

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
	await fireEvent(screen.getByTestId("transcript-scroll"), "contentSizeChange", 390, 9000);
	await scrollTo(100);
	expect(await screen.findByText(text(0))).toBeTruthy();
	await waitFor(() => expect(screen.queryByTestId("earlier-rows")).toBeNull());
});

// ─── The open at a message (issue 08 slice C2) ─────────────────────────────

/** A long session of teacher messages; returns the chat id and the message ids. */
function addTeacherSession() {
	const messages = Array.from({ length: TOTAL }, (_, i) =>
		mac.assistant([{ type: "text", text: text(i) }]),
	);
	const id = mac.add("A long lesson", messages);
	return { id, ids: messages.map((m) => String(m.id)) };
}

/** Open the session at a message by a route push, as the node sheet does. */
async function openAt(id: string, message: string) {
	await renderRouter(APP, { initialUrl: "/" });
	await inTab("teach");
	await act(async () => router.push({ pathname: "/session/[id]", params: { id, message } }));
	await screen.findByTestId("transcript-scroll");
}

const scrollShape = (offset: number, content = 6000) =>
	fireEvent.scroll(screen.getByTestId("transcript-scroll"), {
		nativeEvent: {
			contentOffset: { x: 0, y: offset },
			contentSize: { width: 390, height: content },
			layoutMeasurement: { width: 390, height: 800 },
		},
	});

it("a graph link opens the session at the message's page, with lines over and under it", async () => {
	const { id, ids } = addTeacherSession();
	const at = 10;
	await openAt(id, ids[at]);
	expect(await screen.findByText(text(at))).toBeTruthy();
	expect(screen.getByText(text(at + PAGE_ROWS - 1))).toBeTruthy();
	expect(screen.queryByText(text(at - 1))).toBeNull();
	expect(screen.queryByText(text(at + PAGE_ROWS))).toBeNull();
	expect(screen.queryByText(text(TOTAL - 1))).toBeNull();
	expect(screen.getByTestId("earlier-rows")).toBeTruthy();
	expect(screen.getByTestId("later-rows")).toBeTruthy();
});

it("near the bottom, the next page of later rows comes in, up to the end", async () => {
	const { id, ids } = addTeacherSession();
	await openAt(id, ids[10]);
	await screen.findByText(text(10));
	await scrollShape(5000);
	expect(await screen.findByText(text(10 + PAGE_ROWS))).toBeTruthy();
	// The next page waits for the content to grow.
	await fireEvent(screen.getByTestId("transcript-scroll"), "contentSizeChange", 390, 9000);
	await scrollShape(8000, 9000);
	expect(await screen.findByText(text(TOTAL - 1))).toBeTruthy();
	await waitFor(() => expect(screen.queryByTestId("later-rows")).toBeNull());
});

it("Latest goes from the message to the last page", async () => {
	const { id, ids } = addTeacherSession();
	await openAt(id, ids[10]);
	await screen.findByText(text(10));
	await scrollShape(0);
	await scrollShape(1000);
	await fireEvent.press(await screen.findByTestId("go-latest"));
	expect(await screen.findByText(text(TOTAL - 1))).toBeTruthy();
	expect(screen.queryByText(text(10))).toBeNull();
	expect(screen.queryByTestId("later-rows")).toBeNull();
});

it("a message that is not in the record opens the session at its normal position (state 15)", async () => {
	const { id } = addTeacherSession();
	await openAt(id, "m_not_here");
	expect(await screen.findByText(text(TOTAL - 1))).toBeTruthy();
	expect(screen.getByText(text(TOTAL - PAGE_ROWS))).toBeTruthy();
	expect(screen.queryByText(text(TOTAL - PAGE_ROWS - 1))).toBeNull();
	expect(screen.queryByTestId("later-rows")).toBeNull();
	expect(screen.queryByTestId("session-load-error")).toBeNull();
});

it("a send from the composer goes to the last page, so the new turn shows (D-014)", async () => {
	const { id, ids } = addTeacherSession();
	await openAt(id, ids[10]);
	await screen.findByText(text(10));
	await act(async () => fireEvent.changeText(screen.getByTestId("composer"), "A new question"));
	await fireEvent.press(screen.getByTestId("send"));
	expect(await screen.findByText(text(TOTAL - 1))).toBeTruthy();
	expect(await screen.findByText("A new question")).toBeTruthy();
	expect(screen.queryByTestId("later-rows")).toBeNull();
});
