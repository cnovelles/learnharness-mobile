/**
 * Practice sessions on the phone (issue 06) with expo-router's test
 * renderer and the fake Mac: the home "New practice" button, the practice
 * start, and (later slices) the problem dock, the cards and Next problem.
 */
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import path from "node:path";

import { Alert, Dimensions } from "react-native";

import { FakeMac, type Rec, pairedConnection } from "./helpers/fake-mac";
import { SOLVED, conclude, pose } from "./helpers/practice-record";
import { DISMISS_FAILED, PROBLEM_NOT_ACTIVE } from "@/lib/user-error";

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
// (Markdown, Shiki, the islands, the plan graph). That takes about 1 s on a
// Mac and more than 5 s (the Jest default) on the CI runner.
jest.setTimeout(20_000);

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

describe("slice A: start a practice session", () => {
	it("home has a New practice button next to New session", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		expect(await screen.findByTestId("new-session")).toBeTruthy();
		expect(screen.getByTestId("new-practice")).toBeTruthy();
		expect(screen.getByText("New practice")).toBeTruthy();
	});

	it("New practice opens the practice form and starts a practice session with the text", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		await fireEvent.press(await screen.findByTestId("new-practice"));
		expect(await screen.findByText("What do you want to practice?")).toBeTruthy();
		expect(screen.getByText("Start practice")).toBeTruthy();
		expect(screen).toHavePathname("/new-session");
		await fireEvent.changeText(screen.getByTestId("opening-text"), "Linear recurrences");
		await fireEvent.press(screen.getByTestId("start-session"));

		await waitFor(() => expect(screen).toHavePathname("/session/chat_1"));
		expect(mac.chats.get("chat_1")).toMatchObject({
			title: "Linear recurrences",
			kind: "practice",
		});
		await waitFor(() => expect(mac.inputs).toEqual([{ type: "text", text: "Linear recurrences" }]));
	});

	it("New session still starts a teaching session", async () => {
		await renderRouter(APP, { initialUrl: "/" });
		await fireEvent.press(await screen.findByTestId("new-session"));
		expect(await screen.findByText("What do you want to learn?")).toBeTruthy();
		await fireEvent.changeText(screen.getByTestId("opening-text"), "Tides");
		await fireEvent.press(screen.getByTestId("start-session"));
		await waitFor(() => expect(screen).toHavePathname("/session/chat_1"));
		expect(mac.chats.get("chat_1")!.kind).toBeUndefined();
	});

	it("error state: the Mac refuses the new practice session; the text stays", async () => {
		mac.createAnswer = { status: 500, body: { error: "disk on fire" } };
		await renderRouter(APP, { initialUrl: "/new-session?kind=practice" });
		await fireEvent.changeText(await screen.findByTestId("opening-text"), "Linear recurrences");
		await fireEvent.press(screen.getByTestId("start-session"));
		expect(await screen.findByTestId("new-session-error")).toBeTruthy();
		expect(screen.queryByText(/disk on fire/)).toBeNull();
		expect(screen.getByTestId("opening-text").props.value).toBe("Linear recurrences");
		expect(screen).toHavePathname("/new-session");
		expect(mac.chats.size).toBe(0);
	});
});

/** A practice session whose teacher has posed one problem. */
function practiceWithProblem(): string {
	return mac.add(
		"Recurrences",
		[
			{ role: "user", id: "u_1", content: "Recurrences", timestamp: 1 },
			...(pose("call_p1") as Rec[]),
		],
		"practice",
	);
}

/** Press the alert's button with this text. */
function alertPress(text: string) {
	return jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
		buttons?.find((b) => b.text === text)?.onPress?.();
	});
}

describe("slice C: the practice dock", () => {
	afterEach(() => jest.restoreAllMocks());

	it("an active problem replaces the composer; the dock shows the statement, never the solution", async () => {
		const id = practiceWithProblem();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		const dock = await screen.findByTestId("practice-dock");
		expect(within(dock).getByText("PROBLEM")).toBeTruthy();
		expect(within(dock).getByText("YOUR THINKING")).toBeTruthy();
		expect(screen.queryByTestId("composer")).toBeNull();
		expect(screen.queryByText(/roots are 1 and 2/)).toBeNull();
		expect(screen.getByTestId("practice-send")).toBeDisabled();
	});

	it("Submit thinking sends it for the problem; the conclusion frees the composer", async () => {
		const id = practiceWithProblem();
		mac.turns.push(() => conclude("call_c1", SOLVED, "Well done.") as Rec[]);
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(
			await screen.findByTestId("practice-thinking-field"),
			"Roots 1 and 2, so 2^(n+1) - 1.",
		);
		await fireEvent.press(screen.getByTestId("practice-send"));

		expect(await screen.findByText("Well done.")).toBeTruthy();
		expect(mac.inputs).toEqual([
			{ type: "thinking", problemCallId: "call_p1", text: "Roots 1 and 2, so 2^(n+1) - 1." },
		]);
		expect(screen.getByText("Roots 1 and 2, so 2^(n+1) - 1.")).toBeTruthy();
		expect(screen.getByText("MODEL SOLUTION")).toBeTruthy();
		expect(screen.queryByTestId("practice-dock")).toBeNull();
		expect(screen.getByTestId("composer")).toBeTruthy();
	});

	it("a thinking that does not end the problem keeps the dock, with an empty field", async () => {
		const id = practiceWithProblem();
		mac.turns.push(() => [mac.assistant([{ type: "text", text: "Check your second root." }])]);
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(
			await screen.findByTestId("practice-thinking-field"),
			"Root 1 and 3?",
		);
		await fireEvent.press(screen.getByTestId("practice-send"));
		expect(await screen.findByText("Check your second root.")).toBeTruthy();
		expect(await screen.findByTestId("practice-dock")).toBeTruthy();
		expect(screen.getByTestId("practice-thinking-field").props.value).toBe("");
	});

	it("the chevron collapses the dock to a bar; the bar opens it again with the text kept", async () => {
		const id = practiceWithProblem();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(
			await screen.findByTestId("practice-thinking-field"),
			"Half a thought",
		);
		await fireEvent.press(screen.getByTestId("collapse-problem"));
		expect(screen.queryByTestId("practice-dock")).toBeNull();
		const bar = screen.getByTestId("practice-dock-bar");
		expect(within(bar).getByText("PROBLEM")).toBeTruthy();
		expect(within(bar).getByText(/Solve/)).toBeTruthy();
		await fireEvent.press(bar);
		expect(screen.getByTestId("practice-thinking-field").props.value).toBe("Half a thought");
	});

	it("the statement scrolls inside the dock at a maximum of 35% of the screen height", async () => {
		const id = practiceWithProblem();
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		const statement = await screen.findByTestId("problem-statement");
		const style = [statement.props.style].flat() as { maxHeight?: number }[];
		const { height } = Dimensions.get("window");
		expect(style.find((x) => x?.maxHeight)?.maxHeight).toBe(Math.round(height * 0.35));
	});

	it("Dismiss asks first; Dismiss sends the silent dismissal and frees the composer", async () => {
		const id = practiceWithProblem();
		const alert = alertPress("Dismiss");
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.press(await screen.findByTestId("dismiss-problem"));
		expect(alert).toHaveBeenCalledWith(
			"Dismiss this problem?",
			expect.any(String),
			expect.any(Array),
		);
		await waitFor(() =>
			expect(mac.dismissals).toEqual([{ type: "dismiss-problem", problemCallId: "call_p1" }]),
		);
		expect(await screen.findByTestId("composer")).toBeTruthy();
		expect(screen.queryByTestId("practice-dock")).toBeNull();
		// No turn starts.
		expect(mac.inputs).toEqual([]);
	});

	it("Cancel keeps the problem", async () => {
		const id = practiceWithProblem();
		alertPress("Cancel");
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.press(await screen.findByTestId("dismiss-problem"));
		expect(mac.dismissals).toEqual([]);
		expect(screen.getByTestId("practice-dock")).toBeTruthy();
	});

	it("while a turn runs the dock hides and the composer shows Stop; the dock comes back after", async () => {
		const id = practiceWithProblem();
		mac.holdNext = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(await screen.findByTestId("practice-thinking-field"), "Thinking");
		await fireEvent.press(screen.getByTestId("practice-send"));
		await waitFor(() => expect(mac.holding).toBe(true));
		expect(await screen.findByTestId("stop-turn")).toBeTruthy();
		expect(screen.queryByTestId("practice-dock")).toBeNull();
		await act(async () => mac.release(id, [mac.assistant([{ type: "text", text: "Go on." }])]));
		expect(await screen.findByTestId("practice-dock")).toBeTruthy();
	});

	it("error state: the Mac says the problem is not active; the text stays and Try again reads the session", async () => {
		const id = practiceWithProblem();
		mac.refuseNext = { status: 400, body: { error: "thinking input targets no active problem" } };
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(await screen.findByTestId("practice-thinking-field"), "My answer");
		await fireEvent.press(screen.getByTestId("practice-send"));
		const banner = await screen.findByTestId("session-error");
		expect(banner).toHaveTextContent(PROBLEM_NOT_ACTIVE);
		expect(screen.queryByText(/targets no active problem/)).toBeNull();
		expect(screen.getByTestId("practice-thinking-field").props.value).toBe("My answer");
		// The Mac concluded the problem in the meantime: Try again reads the record.
		mac.chats.get(id)!.messages.push(...(conclude("call_c1", SOLVED, "Done.") as Rec[]));
		await fireEvent.press(screen.getByTestId("retry-turn"));
		expect(await screen.findByText("Done.")).toBeTruthy();
		expect(screen.queryByTestId("practice-dock")).toBeNull();
		expect(mac.inputs).toHaveLength(1);
	});

	it("error state: network loss keeps the text, and Try again sends it again", async () => {
		const id = practiceWithProblem();
		mac.networkFailNextChat = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(await screen.findByTestId("practice-thinking-field"), "My answer");
		await fireEvent.press(screen.getByTestId("practice-send"));
		expect(await screen.findByTestId("session-error")).toBeTruthy();
		expect(screen.getByTestId("practice-thinking-field").props.value).toBe("My answer");
		mac.turns.push(() => [mac.assistant([{ type: "text", text: "Got it." }])]);
		await fireEvent.press(screen.getByTestId("retry-turn"));
		expect(await screen.findByText("Got it.")).toBeTruthy();
		// The lost request never reached the Mac.
		expect(mac.inputs).toEqual([{ type: "thinking", problemCallId: "call_p1", text: "My answer" }]);
	});

	it("error state: a failed dismissal shows a clear message and the dock comes back", async () => {
		const id = practiceWithProblem();
		mac.dismissAnswer = { status: 500, body: { error: "disk on fire" } };
		alertPress("Dismiss");
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.press(await screen.findByTestId("dismiss-problem"));
		const banner = await screen.findByTestId("session-error");
		expect(banner).toHaveTextContent(DISMISS_FAILED);
		expect(screen.queryByText(/disk on fire|dismissal failed/)).toBeNull();
		expect(await screen.findByTestId("practice-dock")).toBeTruthy();
	});

	it("error state: while the Mac compacts, Submit thinking waits", async () => {
		const id = practiceWithProblem();
		mac.chats.get(id)!.compacting = true;
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(await screen.findByTestId("practice-thinking-field"), "My answer");
		expect(screen.getByTestId("practice-send")).toBeDisabled();
		expect(
			within(screen.getByTestId("practice-dock")).getByText(/making the history shorter/),
		).toBeTruthy();
	});

	it("error state: the turn after a thinking fails; the banner offers Try again and the problem stays", async () => {
		const id = practiceWithProblem();
		mac.turns.push((chatId) => {
			mac.chats.get(chatId)!.turnError = "boom";
			return [{ ...mac.assistant([]), stopReason: "error", errorMessage: "boom" }];
		});
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(await screen.findByTestId("practice-thinking-field"), "My answer");
		await fireEvent.press(screen.getByTestId("practice-send"));
		expect(await screen.findByTestId("retry-turn")).toBeTruthy();
		expect(screen.queryByText("boom")).toBeNull();
		expect(await screen.findByTestId("practice-dock")).toBeTruthy();
	});
});
