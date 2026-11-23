/**
 * The session stats on the session screen (issue 08 slice E) with the fake
 * Mac: the line under the composer, the "Session stats" sheet, the update
 * after a turn and after a compaction, and error states 8, 9 and 10. Note:
 * renderRouter turns on Jest's fake timers.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { NO_CONTEXT, NO_LIMIT, NO_PRICE } from "@/lib/session-stats";
import { FakeMac, pairedConnection } from "./helpers/fake-mac";

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
// The first session screen in a file loads the whole rich renderer.
jest.setTimeout(20_000);

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	mac.catalog = [{ provider: "custom", id: "fake", contextWindow: 200_000 }];
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});
afterEach(() => jest.restoreAllMocks());

const tick = (ms = 100) => act(() => jest.advanceTimersByTimeAsync(ms));

type Rec = Record<string, unknown>;
const turn = (id: string, messageId: string, steps = 1): Rec => ({
	id,
	messageId,
	at: "2026-11-23T10:00:00.000Z",
	model: "custom:fake",
	steps: Array.from({ length: steps }, () => ({
		inputTokens: 100,
		outputTokens: 20,
		cacheReadTokens: 300,
	})),
});

/** A session with one priced teacher reply that measured 38 000 tokens. */
function pricedSession() {
	const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
	const chat = mac.chats.get(id)!;
	const reply = mac.assistant([{ type: "text", text: "Ask me." }]);
	(reply.usage as Rec).input = 37_000;
	(reply.usage as Rec).output = 1_000;
	chat.messages.push(reply);
	chat.turns = [turn("t_1", reply.id as string, 3)];
	chat.pricing = { cost: 0.0123, unpriced: 0, turnCosts: { t_1: 0.0123 } };
	chat.settings = { model: { provider: "custom", id: "fake" }, thinkingLevel: "low" };
	return id;
}

const line = () => screen.getByTestId("session-stats");

describe("the session stats (slice E)", () => {
	it("shows one line under the composer: the context, the limit and the cost", async () => {
		const id = pricedSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await screen.findByTestId("composer");
		await waitFor(() => expect(line()).toHaveTextContent("38k / 200k · $0.0123"));
		expect(line().props.accessibilityLabel).toBe("Session stats: context 38k / 200k, cost $0.0123");
		expect(mac.reads).toContain("/api/models");
	});

	it("a tap opens the Session stats sheet with the totals and one row for each turn", async () => {
		const id = pricedSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await waitFor(() => expect(line()).toHaveTextContent(/^38k \/ 200k/));
		await fireEvent.press(line());
		expect(await screen.findByTestId("session-stats-sheet")).toBeTruthy();
		expect(screen.getByTestId("stats-sheet-context")).toHaveTextContent(
			"Context (last call)38k / 200k",
		);
		expect(screen.getByTestId("stats-sheet-cost")).toHaveTextContent("Total cost$0.0123");
		expect(screen.getByTestId("stats-sheet-cache")).toHaveTextContent("Cache hit rate75.0%");
		expect(screen.queryByTestId("stats-sheet-unpriced")).toBeNull();
		expect(screen.queryByTestId("stats-sheet-note")).toBeNull();
		expect(screen.getByTestId("stats-turn-1")).toHaveTextContent(
			"#1 · fake · custom3 steps$0.0123",
		);
		await fireEvent.press(screen.getByTestId("session-stats-sheet-close"));
		await waitFor(() => expect(screen.queryByTestId("session-stats-sheet")).toBeNull());
	});

	it("updates after each turn: the new reply's context and the Mac's new total", async () => {
		const id = pricedSession();
		const chat = mac.chats.get(id)!;
		mac.turns.push(() => {
			const reply = mac.assistant([{ type: "text", text: "Low tide comes twice a day." }]);
			(reply.usage as Rec).input = 41_000;
			(reply.usage as Rec).output = 500;
			chat.turns = [...chat.turns!, turn("t_2", reply.id as string)];
			chat.pricing = { cost: 0.02, unpriced: 0, turnCosts: { t_1: 0.0123, t_2: 0.0077 } };
			return [reply];
		});
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await waitFor(() => expect(line()).toHaveTextContent("38k / 200k · $0.0123"));
		await fireEvent.changeText(screen.getByTestId("composer"), "When is low tide?");
		await fireEvent.press(screen.getByTestId("send"));
		await tick();
		await waitFor(() => expect(line()).toHaveTextContent("41.5k / 200k · $0.0200"));
	});

	it("updates after a compaction: ? until the next reply (state 10), then the new total", async () => {
		const id = pricedSession();
		const chat = mac.chats.get(id)!;
		chat.compacting = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await screen.findByTestId("compacting");
		await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));
		// A compaction marker as the Mac writes it (golden chat shape).
		chat.messages.push({
			role: "custom",
			id: "k_1",
			customType: "compaction",
			content: "[SESSION HISTORY COMPACTED] summary",
			display: true,
			details: {
				firstKeptMessageId: chat.messages[1]!.id,
				tokensBefore: 38_000,
				model: "custom:fake",
				at: "2026-11-23T10:05:00.000Z",
			},
			timestamp: 3,
		});
		chat.compacting = false;
		chat.pricing = { cost: 0.0151, unpriced: 0, turnCosts: { t_1: 0.0123 } };
		// The Mac's order at the end of a compaction (fork src/server/compaction.ts).
		await act(async () => mac.emit("record-changed", { chatId: id }));
		await act(async () => mac.emit("compaction-changed", { chatId: id, running: false }));
		await tick();
		await waitFor(() => expect(line()).toHaveTextContent("? / 200k · $0.0151"));
		await fireEvent.press(line());
		expect(await screen.findByText(NO_CONTEXT)).toBeTruthy();
	});

	it("error state 8: no turn has a price, so the cost is — and never $0.0000", async () => {
		const id = pricedSession();
		const chat = mac.chats.get(id)!;
		chat.pricing = { cost: 0, unpriced: 1, turnCosts: { t_1: null } };
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await waitFor(() => expect(line()).toHaveTextContent("38k / 200k · —"));
		expect(line()).not.toHaveTextContent("$0.0000");
		await fireEvent.press(line());
		expect(await screen.findByText(NO_PRICE)).toBeTruthy();
		expect(screen.getByTestId("stats-sheet-unpriced")).toHaveTextContent("Unpriced turns1");
		expect(screen.getByTestId("stats-turn-1")).toHaveTextContent(/3 steps—$/);
	});

	it("error state 8: a record with no pricing at all also shows —", async () => {
		const id = pricedSession();
		delete mac.chats.get(id)!.pricing;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await waitFor(() => expect(line()).toHaveTextContent("38k / 200k · —"));
	});

	it("error state 9: the catalog read fails, so the line shows only the tokens", async () => {
		mac.catalog = null;
		const id = pricedSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await screen.findByTestId("composer");
		await tick();
		await waitFor(() => expect(line()).toHaveTextContent("38k · $0.0123"));
		expect(line()).not.toHaveTextContent("/");
		await fireEvent.press(line());
		expect(await screen.findByText(NO_LIMIT)).toBeTruthy();
	});

	it("error state 9: the catalog has no entry for the session's model", async () => {
		mac.catalog = [{ provider: "custom", id: "other", contextWindow: 100_000 }];
		const id = pricedSession();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await tick();
		await waitFor(() => expect(line()).toHaveTextContent("38k · $0.0123"));
	});

	it("a session with no model setting uses the Mac's strong slot for the limit", async () => {
		mac.strongModel = { provider: "custom", id: "fake" };
		const id = pricedSession();
		delete mac.chats.get(id)!.settings;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await waitFor(() => expect(line()).toHaveTextContent("38k / 200k · $0.0123"));
	});

	it("error state 10: no reply yet, so the context is ?", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.settings = { model: { provider: "custom", id: "fake" } };
		mac.holdNext = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await tick();
		await waitFor(() => expect(line()).toHaveTextContent("? / 200k · —"));
	});
});
