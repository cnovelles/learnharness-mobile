/**
 * The session screens (issue 03) with expo-router's test renderer and a
 * fake Mac behind the pinned fetch: the home list, a new session, the
 * streamed prober turn with a probe, the answer from the question dock,
 * and the next turn. The fake Mac keeps a native record and answers each
 * turn with a [DONE] stream; the shared SessionModel then reads the record.
 * The real stream format is covered by tests/integration (the real server).
 */
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, PROBE, type Rec, pairedConnection } from "./helpers/fake-mac";

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

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

it("home lists the Mac's sessions with their phase", async () => {
	mac.add("How the tides work");
	await renderRouter(APP, { initialUrl: "/" });
	expect(await screen.findByText("How the tides work")).toBeTruthy();
	expect(screen.getByText("Finding out what you know")).toBeTruthy();
});

it("a new session sends the first text, shows the probe, sends the answer and shows the next turn", async () => {
	mac.turns.push(() => [
		mac.assistant([
			{ type: "text", text: "Welcome. First a short question." },
			{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE },
		]),
	]);
	mac.turns.push(() => [mac.assistant([{ type: "text", text: "Good. The Moon it is." }])]);

	await renderRouter(APP, { initialUrl: "/" });
	await fireEvent.press(await screen.findByTestId("new-session"));
	await fireEvent.changeText(
		await screen.findByTestId("opening-text"),
		"Teach me how the tides work.",
	);
	await fireEvent.press(screen.getByTestId("start-session"));

	// The session screen sends the opening text once and shows the probe.
	expect(await screen.findByText("Welcome. First a short question.")).toBeTruthy();
	expect(await screen.findByTestId("dock-question")).toBeTruthy();
	expect(screen).toHavePathname("/session/chat_1");
	expect(mac.inputs).toEqual([{ type: "text", text: "Teach me how the tides work." }]);
	// In the transcript (the header shows the same text as the session title).
	expect(
		within(screen.getByTestId("transcript")).getByText("Teach me how the tides work."),
	).toBeTruthy();

	// The answer needs a choice. Then choose, set 90%, and send.
	expect(screen.getByTestId("submit-answer")).toBeDisabled();
	await fireEvent.press(screen.getByTestId("option-moon"));
	await fireEvent.press(screen.getByTestId("confidence-90"));
	await fireEvent.changeText(screen.getByTestId("thinking"), "Gravity of the Moon.");
	await fireEvent.press(screen.getByTestId("submit-answer"));

	expect(await screen.findByText("Good. The Moon it is.")).toBeTruthy();
	const answer = mac.inputs[1]!;
	expect(answer).toMatchObject({ type: "answer", toolCallId: "call_probe" });
	expect(answer.answer).toMatchObject({
		kind: "quiz",
		tool: "probe",
		correct: true,
		confidence: 90,
		thinking: "Gravity of the Moon.",
	});
	// The answered card replaces the dock; the composer waits for text.
	await waitFor(() => expect(screen.queryByTestId("dock-question")).toBeNull());
	expect(screen.getByText("CORRECT")).toBeTruthy();
	expect(screen.getByText("90% sure")).toBeTruthy();
	expect(await screen.findByTestId("composer")).toBeTruthy();
});

it("opening an existing session sends nothing", async () => {
	const id = mac.add("Old session", [
		{ role: "user", id: "u_old", content: "Hello", timestamp: 1 },
	]);
	mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Hello again." }]));
	await renderRouter(APP, { initialUrl: `/session/${id}` });
	expect(await screen.findByText("Hello again.")).toBeTruthy();
	await act(async () => {});
	expect(mac.inputs).toEqual([]);
});

it("a session that is gone shows a clear error", async () => {
	await renderRouter(APP, { initialUrl: "/session/chat_404" });
	expect(await screen.findByText("This session is not on the Mac any more.")).toBeTruthy();
});

it("a malformed question shows Ask again, which sends retry-question; the new question opens the dock", async () => {
	const { explanation: _e, ...noExplanation } = PROBE;
	const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
	const bad = mac.assistant([
		{ type: "toolCall", id: "call_bad", name: "probe", arguments: noExplanation },
	]);
	mac.chats.get(id)!.messages.push(bad);
	mac.turns.push(() => [
		mac.assistant([{ type: "toolCall", id: "call_good", name: "probe", arguments: PROBE }]),
	]);

	await renderRouter(APP, { initialUrl: `/session/${id}` });
	expect(await screen.findByText(/This question is not complete/)).toBeTruthy();
	expect(screen.queryByTestId("dock-question")).toBeNull();
	await fireEvent.press(screen.getByTestId("retry-question"));

	expect(await screen.findByTestId("dock-question")).toBeTruthy();
	expect(mac.inputs).toEqual([
		{ type: "retry-question", messageId: bad.id, contentIndex: 0, toolCallId: "call_bad" },
	]);
});

it("a turn that the Mac starts by itself (the teacher after the probe) shows without a reopen", async () => {
	const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
	mac.chats
		.get(id)!
		.messages.push(
			mac.assistant([{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE }]),
		);
	// The answer turn: the prober closes the probe. The Mac then wakes the teacher.
	mac.turns.push(() => [
		mac.assistant([{ type: "text", text: "Good. The teacher takes over now." }]),
	]);

	await renderRouter(APP, { initialUrl: `/session/${id}` });
	await fireEvent.press(await screen.findByTestId("option-moon"));
	await fireEvent.press(screen.getByTestId("submit-answer"));
	expect(await screen.findByText("Good. The teacher takes over now.")).toBeTruthy();
	await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));

	// The Mac's wake turn: it saves the teacher's text and announces the turn.
	mac.chats
		.get(id)!
		.messages.push(mac.assistant([{ type: "text", text: "The Moon makes two bulges." }]));
	await act(async () => {
		mac.emit("turn-started", { chatId: id });
		mac.emit("turn-settled", { chatId: id });
	});
	expect(await screen.findByText("The Moon makes two bulges.")).toBeTruthy();
	expect(mac.inputs.map((i) => i.type)).toEqual(["answer"]);
});

describe("error states", () => {
	const OPENING = "Teach me how the tides work.";

	it("a text that the Mac refuses (no model set) shows a clear message, keeps the text, and Try again sends the text again, not a retry", async () => {
		mac.refuseNext = {
			status: 503,
			body: {
				error: "No model configured — set up your models first",
				code: "models_not_configured",
				missing: ["strong"],
			},
		};
		mac.turns.push(() => [
			mac.assistant([{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE }]),
		]);

		await renderRouter(APP, { initialUrl: "/" });
		await fireEvent.press(await screen.findByTestId("new-session"));
		await fireEvent.changeText(await screen.findByTestId("opening-text"), OPENING);
		await fireEvent.press(screen.getByTestId("start-session"));

		expect(await screen.findByText(/Your Mac has no Strong model set\./)).toBeTruthy();
		// No raw server text, and no phone-only bubble for the refused text.
		expect(screen.queryByText(/models_not_configured|No model configured/)).toBeNull();
		expect(within(screen.getByTestId("transcript")).queryByText(OPENING)).toBeNull();
		// The text is back in the composer.
		expect(screen.getByTestId("composer").props.value).toBe(OPENING);

		await fireEvent.press(screen.getByTestId("retry-turn"));
		expect(await screen.findByTestId("dock-question")).toBeTruthy();
		expect(mac.inputs).toEqual([
			{ type: "text", text: OPENING },
			{ type: "text", text: OPENING },
		]);
		expect(screen.queryByTestId("session-error")).toBeNull();
	});

	it("a saved turn that failed shows plain text, not the raw error, and Try again sends retry", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.turnError = "500 upstream_error: provider exploded at line 42";
		// The saved record ends in the failed response (stopReason "error").
		mac.chats
			.get(id)!
			.messages.push({ ...mac.assistant([]), stopReason: "error", errorMessage: "exploded" });
		mac.turns.push(() => [mac.assistant([{ type: "text", text: "Here we go again." }])]);

		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
		expect(screen.queryByText(/provider exploded/)).toBeNull();

		await fireEvent.press(screen.getByTestId("retry-turn"));
		expect(await screen.findByText("Here we go again.")).toBeTruthy();
		expect(mac.inputs).toEqual([{ type: "retry" }]);
	});

	it("a route that the gateway refuses shows that the phone cannot do it yet", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Ask me." }]));
		mac.refuseNext = {
			status: 403,
			body: { error: "This action is available only on the desktop." },
		};

		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.changeText(await screen.findByTestId("composer"), "Why?");
		await fireEvent.press(screen.getByTestId("send"));
		expect(
			await screen.findByText("The phone cannot do this yet. Use LearnHarness on the Mac for it."),
		).toBeTruthy();
		expect(screen.getByTestId("composer").props.value).toBe("Why?");
	});
});

describe("teach-phase checks", () => {
	const CHECK = { ...PROBE, type: "check", nodeId: "bulges" };

	/** A session in the teach phase whose last turn taught and then asked a check. */
	function teachSession() {
		const id = mac.add("Tides", [
			{ role: "user", id: "u_1", content: "Teach me tides.", timestamp: 1 },
		]);
		const chat = mac.chats.get(id)!;
		const done = mac.assistant([
			{ type: "toolCall", id: "pd", name: "probe_done", arguments: { assessment: {} } },
		]);
		chat.messages.push(
			done,
			{
				role: "toolResult",
				id: "r_pd",
				toolCallId: "pd",
				toolName: "probe_done",
				content: [{ type: "text", text: "ok" }],
				details: { ok: true },
				isError: false,
				timestamp: 2,
			},
			{ role: "user", id: "u_2", content: "The plan is fine.", timestamp: 3 },
			mac.assistant([
				{ type: "text", text: "The Moon pulls the near side of the ocean more." },
				{ type: "toolCall", id: "call_check", name: "quiz", arguments: CHECK },
			]),
		);
		return id;
	}

	it("waits behind Check your understanding with the reading field; the answer carries the reading thinking", async () => {
		const id = teachSession();
		mac.turns.push(() => [mac.assistant([{ type: "text", text: "Right. Next step." }])]);
		await renderRouter(APP, { initialUrl: `/session/${id}` });

		expect(await screen.findByText("Check your understanding")).toBeTruthy();
		expect(screen.queryByTestId("dock-question")).toBeNull();
		await fireEvent.changeText(
			screen.getByTestId("reading-thinking"),
			"The near side is pulled more.",
		);
		await fireEvent.press(screen.getByTestId("reveal-open"));

		expect(await screen.findByTestId("dock-question")).toBeTruthy();
		expect(screen.queryByTestId("reading-thinking")).toBeNull();
		await fireEvent.press(screen.getByTestId("option-moon"));
		await fireEvent.press(screen.getByTestId("submit-answer"));

		expect(await screen.findByText("Right. Next step.")).toBeTruthy();
		expect(mac.inputs[0]).toMatchObject({ type: "answer", toolCallId: "call_check" });
		expect((mac.inputs[0]!.answer as Rec).readingThinking).toBe("The near side is pulled more.");
	});

	it("an answer that the Mac refuses keeps the open check, the choice and the reading thinking", async () => {
		const id = teachSession();
		mac.refuseNext = {
			status: 503,
			body: { error: "x", code: "models_not_configured", missing: ["strong"] },
		};
		mac.turns.push(() => [mac.assistant([{ type: "text", text: "Right. Next step." }])]);
		await renderRouter(APP, { initialUrl: `/session/${id}` });

		await fireEvent.changeText(await screen.findByTestId("reading-thinking"), "Near side.");
		await fireEvent.press(screen.getByTestId("reveal-open"));
		await fireEvent.press(await screen.findByTestId("option-moon"));
		await fireEvent.press(screen.getByTestId("submit-answer"));

		expect(await screen.findByText(/Your Mac has no Strong model set\./)).toBeTruthy();
		expect(await screen.findByTestId("dock-question")).toBeTruthy();
		expect(screen.getByTestId("option-moon").props.accessibilityState).toMatchObject({
			selected: true,
		});

		// The second send carries the same reading thinking.
		await fireEvent.press(screen.getByTestId("submit-answer"));
		expect(await screen.findByText("Right. Next step.")).toBeTruthy();
		expect((mac.inputs[1]!.answer as Rec).readingThinking).toBe("Near side.");
	});
});

describe("phase, lesson plan and answered cards (slice B)", () => {
	const TREE = {
		nodes: [
			{ id: "pull", title: "Uneven pull" },
			{ id: "bulges", title: "Two bulges" },
		],
		edges: [{ from: "pull", to: "bulges" }],
		version: 1,
	};
	const result = (id: string, toolCallId: string, toolName: string, details: unknown) => ({
		role: "toolResult",
		id,
		toolCallId,
		toolName,
		content: [{ type: "text", text: "ok" }],
		details,
		isError: false,
		timestamp: 2,
	});

	/** A session after the probe: handoff, plan, and (optional) a first check. */
	function plannedSession({ withCheck }: { withCheck: boolean }) {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		const chat = mac.chats.get(id)!;
		chat.messages.push(
			mac.assistant([{ type: "toolCall", id: "pd", name: "probe_done", arguments: {} }]),
			result("r_pd", "pd", "probe_done", { ok: true }),
			{
				role: "custom",
				id: `steer_probe_${id}`,
				customType: "probe-handoff",
				content: "hand off",
				display: true,
				details: { chatId: id },
				timestamp: 3,
			},
			mac.assistant([
				{ type: "text", text: "Here is the plan." },
				{ type: "toolCall", id: "p1", name: "plan_init", arguments: { mermaid: "graph TD" } },
			]),
			result("r_p1", "p1", "plan_init", { ok: true, tree: TREE }),
			// The teacher presents the plan after the tool result. (A record that ends in
			// a tool result makes the phone ask the Mac to continue.)
			mac.assistant([{ type: "text", text: "Does this plan look right?" }]),
		);
		if (withCheck)
			chat.messages.push(
				{ role: "user", id: "u_2", content: "Go.", timestamp: 4 },
				mac.assistant([
					{ type: "text", text: "The pull is uneven." },
					{
						type: "toolCall",
						id: "call_check",
						name: "quiz",
						arguments: { ...PROBE, type: "predict", nodeId: "pull" },
					},
				]),
			);
		return id;
	}

	it("the header shows the phase; a new session is Probing and has no Plan button", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats.get(id)!.messages.push(mac.assistant([{ type: "text", text: "Hi." }]));
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("Hi.")).toBeTruthy();
		expect(screen.getByTestId("session-phase")).toHaveTextContent("PROBING");
		expect(screen.queryByTestId("open-plan")).toBeNull();
	});

	it("after the plan: Planning, the plan divider with the step count, and the Plan sheet with upcoming steps", async () => {
		const id = plannedSession({ withCheck: false });
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("Here is the plan.")).toBeTruthy();
		expect(screen.getByTestId("session-phase")).toHaveTextContent("PLANNING");
		expect(screen.getByText("PLAN · 2 STEPS")).toBeTruthy();

		await fireEvent.press(screen.getByTestId("open-plan"));
		expect(await screen.findByTestId("plan-sheet")).toBeTruthy();
		expect(screen.getByTestId("plan-step-status-pull")).toHaveTextContent("Next");
		expect(screen.getByTestId("plan-step-status-bulges")).toHaveTextContent("Next");
		await fireEvent.press(screen.getByTestId("plan-close"));
		await waitFor(() => expect(screen.queryByTestId("plan-sheet")).toBeNull());
	});

	it("the plan row in the transcript opens the same sheet", async () => {
		const id = plannedSession({ withCheck: false });
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		await fireEvent.press(await screen.findByTestId("plan-p1"));
		expect(await screen.findByTestId("plan-step-pull")).toBeTruthy();
	});

	it("after the first check: Teaching, the teach divider, the check's step is current, and the answered card", async () => {
		const id = plannedSession({ withCheck: true });
		mac.turns.push(() => [mac.assistant([{ type: "text", text: "Next step." }])]);
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByTestId("dock-question")).toBeTruthy();
		expect(screen.getByTestId("session-phase")).toHaveTextContent("TEACHING");
		expect(screen.getByTestId("phase-divider-teach")).toBeTruthy();

		await fireEvent.press(screen.getByTestId("open-plan"));
		expect(screen.getByTestId("plan-step-status-pull")).toHaveTextContent("Now");
		await fireEvent.press(screen.getByTestId("plan-close"));

		await fireEvent.press(screen.getByTestId("option-wind"));
		await fireEvent.press(screen.getByTestId("submit-answer"));
		expect(await screen.findByText("Next step.")).toBeTruthy();
		expect(screen.getByText("PREDICTION")).toBeTruthy();
		expect(screen.getByText("INCORRECT")).toBeTruthy();
		// The explanation waits behind Why.
		expect(screen.queryByText(PROBE.explanation)).toBeNull();
		await fireEvent.press(screen.getByTestId("why-call_check"));
		expect(screen.getByText(PROBE.explanation)).toBeTruthy();
	});

	it("error state: a malformed answer record shows a plain line and no raw data", async () => {
		const id = mac.add("Tides", [{ role: "user", id: "u_1", content: "Tides", timestamp: 1 }]);
		mac.chats
			.get(id)!
			.messages.push(
				mac.assistant([{ type: "toolCall", id: "call_probe", name: "probe", arguments: PROBE }]),
				result("r_bad", "call_probe", "probe", { weird: "secret_raw_value" }),
				mac.assistant([{ type: "text", text: "Moving on." }]),
			);
		await renderRouter(APP, { initialUrl: `/session/${id}` });
		expect(await screen.findByText("Answered. The phone cannot show this answer.")).toBeTruthy();
		expect(screen.queryByText(/secret_raw_value/)).toBeNull();
	});
});
