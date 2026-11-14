/**
 * The fake Mac for the session screen tests: one session store, scripted
 * turns, a turn that runs until release(), and logs of the inputs, steers,
 * aborts and dismissals. It answers each turn with a [DONE] stream; the
 * shared SessionModel then reads the record. The real stream format is
 * covered by tests/integration (the real server).
 */
export const PIN = `sha256/${"A".repeat(42)}Q=`;
export const MAC = "https://192.168.1.20:47821";
export const TOKEN = "t".repeat(43);

export const PROBE = {
	question: "What mainly causes the ocean tides on Earth?",
	options: [
		{ label: "The gravity of the Moon", value: "moon" },
		{ label: "The wind over the oceans", value: "wind" },
	],
	explanation: "The Moon's gravity pulls the near side of the oceans more than the far side.",
	correctAnswer: "moon",
};

export type Rec = Record<string, unknown>;

/** The stored pairing that the screen tests start with. */
export function pairedConnection(): string {
	return JSON.stringify({
		name: "Studio Mac",
		urls: [MAC],
		pin: PIN,
		token: TOKEN,
		deviceId: "dev_1",
		pairedAt: "2026-11-14T00:00:00.000Z",
	});
}

export class FakeMac {
	chats = new Map<
		string,
		{ title: string; messages: Rec[]; turnError?: string; compacting?: boolean }
	>();
	inputs: Rec[] = [];
	/** The next POST /api/chat gets this answer and saves nothing (a gate refusal). */
	refuseNext: { status: number; body: Rec } | null = null;
	turns: ((chatId: string, input: Rec) => Rec[])[] = [];
	/** Hold the next turn's stream open until release() (a turn that runs). */
	holdNext = false;
	private held: ReadableStreamDefaultController<Uint8Array> | null = null;
	steers: Rec[] = [];
	aborts: Rec[] = [];
	dismissals: Rec[] = [];
	/** Answers for the next steer, abort or dismiss request. */
	steerAnswer: { status: number; body: Rec } | null = null;
	abortAnswer: { status: number; body: Rec } | null = null;
	dismissAnswer: { status: number; body: Rec } | null = null;
	/** The next N record reads fail with 500. */
	failRecordReads = 0;
	private seq = 0;

	get holding() {
		return this.held !== null;
	}

	/** End the held turn: save `messages`, then close the stream. */
	release(chatId: string, messages: Rec[] = []) {
		this.chats.get(chatId)!.messages.push(...messages);
		const c = this.held;
		this.held = null;
		try {
			// turn-settled: the model's clean end of a stream (no recovery read).
			c?.enqueue(new TextEncoder().encode('data: {"type":"turn-settled"}\n\ndata: [DONE]\n\n'));
			c?.close();
		} catch {
			/* the phone closed it already */
		}
	}
	private listeners: ReadableStreamDefaultController<Uint8Array>[] = [];

	/** Send one event on every open /api/events connection. */
	emit(type: string, payload: Rec) {
		const bytes = new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
		for (const c of this.listeners) c.enqueue(bytes);
	}

	get eventListeners() {
		return this.listeners.length;
	}

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
		if (p === "/api/events") {
			const body = new ReadableStream<Uint8Array>({
				start: (c) => void this.listeners.push(c),
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		}
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
		const steer = p.match(/^\/api\/chats\/([^/]+)\/steer$/);
		if (steer && method === "POST") {
			const input = (JSON.parse(String(init?.body)) as { input: Rec }).input;
			this.steers.push(input);
			if (this.steerAnswer) {
				const { status, body } = this.steerAnswer;
				this.steerAnswer = null;
				return this.json(body, status);
			}
			this.chats
				.get(steer[1]!)!
				.messages.push({ role: "user", id: input.id, content: input.text, timestamp: Date.now() });
			return this.json({ ok: true });
		}
		if (p === "/api/activity/abort" && method === "POST") {
			this.aborts.push(JSON.parse(String(init?.body)) as Rec);
			if (this.abortAnswer) {
				const { status, body } = this.abortAnswer;
				this.abortAnswer = null;
				return this.json(body, status);
			}
			return this.json({ ok: true });
		}
		const dismiss = p.match(/^\/api\/chats\/([^/]+)\/dismiss$/);
		if (dismiss && method === "POST") {
			const input = (JSON.parse(String(init?.body)) as { input: Rec }).input;
			this.dismissals.push(input);
			if (this.dismissAnswer) {
				const { status, body } = this.dismissAnswer;
				this.dismissAnswer = null;
				return this.json(body, status);
			}
			const answer = input.answer as Rec;
			this.chats.get(dismiss[1]!)!.messages.push({
				role: "toolResult",
				id: `r_${++this.seq}`,
				toolCallId: input.toolCallId,
				toolName: answer.tool ?? "quiz",
				content: [{ type: "text", text: "skipped" }],
				details: answer,
				isError: false,
				timestamp: Date.now(),
			});
			return this.json({ ok: true });
		}
		const record = p.match(/^\/api\/chats\/([^/]+)$/);
		if (record && this.failRecordReads > 0) {
			this.failRecordReads--;
			return this.json({ error: "disk on fire" }, 500);
		}
		if (record) {
			const chat = this.chats.get(record[1]!);
			if (!chat) return this.json({ error: "Not found" }, 404);
			return this.json({
				id: record[1],
				title: chat.title,
				messages: chat.messages,
				turnInFlight: false,
				compacting: chat.compacting === true,
				...(chat.turnError ? { turnError: chat.turnError } : {}),
			});
		}
		if (/^\/api\/chats\/[^/]+\/stream$/.test(p)) return this.done();
		if (p === "/api/jobs") return this.json({ turnInFlight: false, jobs: [] });
		if (p === "/api/chat" && method === "POST") {
			const body = JSON.parse(String(init?.body)) as { chatId: string; input: Rec };
			this.inputs.push(body.input);
			if (this.refuseNext) {
				const { status, body: refusal } = this.refuseNext;
				this.refuseNext = null;
				return this.json(refusal, status);
			}
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
			if (this.holdNext) {
				this.holdNext = false;
				const stream = new ReadableStream<Uint8Array>({ start: (c) => void (this.held = c) });
				return new Response(stream, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return this.done();
		}
		return this.json({ error: `fake Mac: no route ${method} ${p}` }, 500);
	};
}
