/**
 * The Practice tab (issue 20, slice C): the continue card, the sessions by
 * time with the problem counts, an older Mac with no count, and the empty
 * and error states.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

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

/** A time `days` days before now, at the same clock time (Today, This week, Earlier). */
function daysAgo(days: number, minutes = 0) {
	const d = new Date();
	d.setDate(d.getDate() - days);
	d.setMinutes(d.getMinutes() - minutes);
	return d.toISOString();
}

/** A practice session with its list fields. */
function practice(title: string, fields: Record<string, unknown>) {
	const id = mac.add(title, [], "practice");
	mac.listFields.set(id, fields);
	return id;
}

it("shows the newest practice session on the card and the sessions by time, with problem counts", async () => {
	mac.add("How the tides work");
	const recur = practice("Linear recurrences", {
		updatedAt: daysAgo(0),
		problemCount: 4,
		pendingProblem: true,
	});
	const bayes = practice("Bayes rule", { updatedAt: daysAgo(0, 30), problemCount: 1 });
	const graphs = practice("Graph search", { updatedAt: daysAgo(3), problemCount: 0 });
	const old = practice("Sorting", { updatedAt: daysAgo(30), problemCount: 12 });
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");

	const card = await tab.findByTestId("practice-continue-card");
	expect(card).toHaveTextContent(/Linear recurrences/);
	expect(tab.getByTestId("practice-continue-line")).toHaveTextContent("Problem 4 · 3 done");
	expect(tab.getByTestId("practice-continue-badge")).toHaveTextContent("A problem waits");

	const labels = tab
		.getAllByRole("header")
		.map((h) => h.props.children as string)
		.filter((t) => t !== "Continue practice");
	expect(labels).toEqual(["Today", "This week", "Earlier"]);
	expect(tab.getByTestId("time-today")).toHaveTextContent(/Linear recurrences.*Bayes rule/);
	expect(tab.getByTestId("time-week")).toHaveTextContent(/Graph search/);
	expect(tab.getByTestId("time-earlier")).toHaveTextContent(/Sorting/);

	expect(tab.getByTestId(`problems-${recur}`)).toHaveTextContent("4 problems");
	expect(tab.getByTestId(`problems-${bayes}`)).toHaveTextContent("1 problem");
	expect(tab.getByTestId(`problems-${graphs}`)).toHaveTextContent("0 problems");
	expect(tab.getByTestId(`problems-${old}`)).toHaveTextContent("12 problems");
	// The waiting problem shows on its row too.
	expect(tab.getByTestId(`session-${recur}`)).toHaveTextContent(/A problem waits/);
	// The teach session is not in the Practice tab.
	expect(tab.queryByText("How the tides work")).toBeNull();
});

it("Continue opens the newest practice session", async () => {
	const newest = practice("Linear recurrences", { updatedAt: daysAgo(0), problemCount: 2 });
	practice("Bayes rule", { updatedAt: daysAgo(1), problemCount: 1 });
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");
	expect(await tab.findByTestId("practice-continue-line")).toHaveTextContent("Practice · 2 done");
	expect(tab.getByTestId("practice-continue-badge")).toHaveTextContent("Your turn");
	await fireEvent.press(tab.getByTestId("practice-continue"));
	expect(screen).toHavePathname(`/session/${newest}`);
});

it("a row opens its session", async () => {
	practice("Linear recurrences", { updatedAt: daysAgo(0), problemCount: 2 });
	const other = practice("Bayes rule", { updatedAt: daysAgo(1), problemCount: 1 });
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");
	await fireEvent.press(await tab.findByTestId(`session-${other}`));
	expect(screen).toHavePathname(`/session/${other}`);
});

it("error state 3: the chats call fails; a clear message, no raw server text", async () => {
	practice("Linear recurrences", { updatedAt: daysAgo(0), problemCount: 2 });
	// describeError logs the unmapped 500 for the developer; the screen shows a clear message.
	const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
	globalThis.fetch = jest.fn((url: string, init?: RequestInit) =>
		new URL(url).pathname === "/api/chats" && (init?.method ?? "GET") === "GET"
			? Promise.resolve(
					new Response(JSON.stringify({ error: "ENOENT internal" }), {
						status: 500,
						headers: { "content-type": "application/json" },
					}),
				)
			: mac.handle(url, init),
	) as unknown as typeof fetch;
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");
	expect(await tab.findByTestId("sessions-error")).toBeTruthy();
	expect(tab.queryByText(/ENOENT/)).toBeNull();
	expect(tab.queryByTestId("practice-continue-card")).toBeNull();
	warn.mockRestore();
});

it("shows no numbers when the Mac sends no problem count (an older fork build)", async () => {
	const id = practice("Linear recurrences", {
		updatedAt: daysAgo(0),
		problemCount: undefined,
		pendingProblem: true,
	});
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");
	expect(await tab.findByTestId(`session-${id}`)).toBeTruthy();
	expect(tab.queryByTestId(`problems-${id}`)).toBeNull();
	expect(tab.queryByText(/problems?$/)).toBeNull();
	expect(tab.getByTestId("practice-continue-line")).toHaveTextContent("Practice");
	expect(tab.getByTestId("practice-continue-badge")).toHaveTextContent("A problem waits");
});

it("an empty Practice tab asks the learner to start a practice session (error state 4)", async () => {
	mac.add("How the tides work");
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");
	expect(await tab.findByText("Start a practice session to begin.")).toBeTruthy();
	expect(tab.queryByTestId("practice-continue-card")).toBeNull();
});

it("reads the counts again when a turn ends on the Mac", async () => {
	const id = practice("Linear recurrences", { updatedAt: daysAgo(0), problemCount: 1 });
	await renderRouter(APP, { initialUrl: "/practice" });
	const tab = await inTab("practice");
	expect(await tab.findByTestId(`problems-${id}`)).toHaveTextContent("1 problem");
	await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));
	mac.listFields.set(id, { updatedAt: daysAgo(0), problemCount: 2, pendingProblem: true });
	await act(async () => mac.emit("turn-settled", { chatId: id }));
	await waitFor(() => expect(tab.getByTestId(`problems-${id}`)).toHaveTextContent("2 problems"));
	expect(tab.getByTestId("practice-continue-line")).toHaveTextContent("Problem 2 · 1 done");
});
