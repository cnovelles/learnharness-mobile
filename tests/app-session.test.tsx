/**
 * The session screens (issue 03) with expo-router's test renderer and a
 * fake Mac behind the pinned fetch: the home list, a new session, the
 * streamed prober turn with a probe, the answer from the question dock,
 * and the next turn. The fake Mac keeps a native record and answers each
 * turn with a [DONE] stream; the shared SessionModel then reads the record.
 * The real stream format is covered by tests/integration (the real server).
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

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
	nativePinnedFetch: () => (url: string, init: RequestInit) =>
		(globalThis.fetch as typeof fetch)(url, init),
}));
jest.mock("expo-camera", () => ({
	CameraView: () => null,
	useCameraPermissions: () => [{ granted: false }, async () => ({ granted: false })],
}));

const APP = path.resolve(__dirname, "../src/app");
const PIN = `sha256/${"A".repeat(42)}Q=`;
const MAC = "https://192.168.1.20:47821";

const PROBE = {
	question: "What mainly causes the ocean tides on Earth?",
	options: [
		{ label: "The gravity of the Moon", value: "moon" },
		{ label: "The wind over the oceans", value: "wind" },
	],
	explanation: "The Moon's gravity pulls the near side of the oceans more than the far side.",
	correctAnswer: "moon",
};

type Rec = Record<string, unknown>;

/** The fake Mac: one session store, scripted turns, and a log of POST /api/chat inputs. */
class FakeMac {
	chats = new Map<string, { title: string; messages: Rec[] }>();
	inputs: Rec[] = [];
	turns: ((chatId: string, input: Rec) => Rec[])[] = [];
	private seq = 0;

	add(title: string, messages: Rec[] = []) {
		const id = `chat_${++this.seq}`;
		this.chats.set(id, { title, messages });
		return id;
	}

	assistant(content: Rec[]): Rec {
		return {
			role: "assistant",
			id: `m_${++this.seq}`,
			content,
			api: "openai-completions",
			provider: "custom",
			model: "fake",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
			timestamp: Date.now(),
		};
	}

	private json(body: unknown, status = 200) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}

	private done() {
		return new Response("data: [DONE]\n\n", {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}

	handle = async (url: string, init?: RequestInit): Promise<Response> => {
		const u = new URL(url);
		expect(u.origin).toBe(MAC);
		expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${"t".repeat(43)}`);
		const method = (init?.method ?? "GET").toUpperCase();
		const p = u.pathname;
		if (p === "/phone/v1/ping") return this.json({ ok: true });
		if (p === "/api/chats" && method === "GET")
			return this.json({
				chats: [...this.chats].map(([id, c]) => ({
					id,
					title: c.title,
					createdAt: "2026-11-14T10:00:00.000Z",
					updatedAt: "2026-11-14T10:00:00.000Z",
					kind: "teach",
					messageCount: c.messages.length,
					phase: "probe",
					pendingQuestion: false,
					pendingProblem: false,
					busy: false,
					compacting: false,
				})),
			});
		if (p === "/api/chats" && method === "POST") {
			const body = JSON.parse(String(init?.body)) as { title: string };
			const id = this.add(body.title);
			return this.json({ id, title: body.title });
		}
		const record = p.match(/^\/api\/chats\/([^/]+)$/);
		if (record) {
			const chat = this.chats.get(record[1]!);
			if (!chat) return this.json({ error: "Not found" }, 404);
			return this.json({
				id: record[1],
				title: chat.title,
				messages: chat.messages,
				turnInFlight: false,
			});
		}
		if (/^\/api\/chats\/[^/]+\/stream$/.test(p)) return this.done();
		if (p === "/api/jobs") return this.json({ turnInFlight: false, jobs: [] });
		if (p === "/api/chat" && method === "POST") {
			const body = JSON.parse(String(init?.body)) as { chatId: string; input: Rec };
			this.inputs.push(body.input);
			const chat = this.chats.get(body.chatId)!;
			const now = Date.now();
			if (body.input.type === "text")
				chat.messages.push({
					role: "user",
					id: `u_${++this.seq}`,
					content: body.input.text,
					timestamp: now,
				});
			if (body.input.type === "answer") {
				const answer = body.input.answer as Rec;
				chat.messages.push({
					role: "toolResult",
					id: `r_${++this.seq}`,
					toolCallId: body.input.toolCallId,
					toolName: answer.tool,
					content: [{ type: "text", text: JSON.stringify(answer) }],
					details: answer,
					isError: false,
					timestamp: now,
				});
			}
			const turn = this.turns.shift();
			if (turn) chat.messages.push(...turn(body.chatId, body.input));
			return this.done();
		}
		return this.json({ error: `fake Mac: no route ${method} ${p}` }, 500);
	};
}

let mac: FakeMac;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set(
		"lh.connection.v1",
		JSON.stringify({
			name: "Studio Mac",
			urls: [MAC],
			pin: PIN,
			token: "t".repeat(43),
			deviceId: "dev_1",
			pairedAt: "2026-11-14T00:00:00.000Z",
		}),
	);
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
	expect(screen.getByText("Teach me how the tides work.")).toBeTruthy();

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
	expect(
		screen.getByText(/Your answer: The gravity of the Moon \(90% sure\)\. Correct\./),
	).toBeTruthy();
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
