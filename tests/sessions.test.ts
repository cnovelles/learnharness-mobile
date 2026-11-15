/**
 * The session API client: list, start (with the opening prompt hand-over)
 * and read. A fake fetch plays the Mac's answers.
 */
import {
	OpeningPrompts,
	SessionApiError,
	listSessions,
	readSession,
	startSession,
} from "@/lib/sessions";

type Call = { path: string; init?: RequestInit };

function fakeFetch(answer: (call: Call) => Response) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const call = { path: String(input), init };
		calls.push(call);
		return answer(call);
	}) as typeof fetch;
	return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const item = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	title: `Session ${id}`,
	createdAt: "2026-11-14T10:00:00.000Z",
	updatedAt: "2026-11-14T11:00:00.000Z",
	messageCount: 4,
	busy: false,
	compacting: false,
	...extra,
});

describe("listSessions", () => {
	it("returns the Mac's session list in the Mac's order", async () => {
		const { fetchImpl, calls } = fakeFetch(() =>
			json({ chats: [item("b"), item("a", { busy: true })] }),
		);
		const list = await listSessions(fetchImpl);
		expect(calls[0]!.path).toBe("/api/chats");
		expect(list.map((c) => c.id)).toEqual(["b", "a"]);
		expect(list[1]!.busy).toBe(true);
	});

	it("drops entries without an id or a title", async () => {
		const { fetchImpl } = fakeFetch(() =>
			json({ chats: [item("ok"), { title: "no id" }, { id: "x" }, null] }),
		);
		expect((await listSessions(fetchImpl)).map((c) => c.id)).toEqual(["ok"]);
	});

	it("reports the Mac's error text", async () => {
		const { fetchImpl } = fakeFetch(() => json({ error: "Forbidden" }, 403));
		await expect(listSessions(fetchImpl)).rejects.toThrow(new SessionApiError("Forbidden", 403));
	});

	it("reports a status when the answer is not JSON", async () => {
		const { fetchImpl } = fakeFetch(() => new Response("oops", { status: 502 }));
		await expect(listSessions(fetchImpl)).rejects.toThrow("The Mac answered with status 502.");
	});
});

describe("startSession", () => {
	it("creates the session with the first text as its title and keeps the text for the session screen", async () => {
		const prompts = new OpeningPrompts();
		const { fetchImpl, calls } = fakeFetch(() => json({ id: "chat_1", title: "Tides" }));
		const id = await startSession(fetchImpl, "  Teach me how the tides work.  ", prompts);
		expect(id).toBe("chat_1");
		expect(calls[0]!.path).toBe("/api/chats");
		expect(calls[0]!.init?.method).toBe("POST");
		expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
			title: "Teach me how the tides work.",
		});
		expect(prompts.take("chat_1")).toBe("Teach me how the tides work.");
		expect(prompts.take("chat_1")).toBeUndefined();
	});

	it("practice: sends kind practice, so the Mac opens the practice agent", async () => {
		const prompts = new OpeningPrompts();
		const { fetchImpl, calls } = fakeFetch(() => json({ id: "chat_2", title: "Recurrences" }));
		const id = await startSession(fetchImpl, " Linear recurrences ", prompts, "practice");
		expect(id).toBe("chat_2");
		expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
			title: "Linear recurrences",
			kind: "practice",
		});
		expect(prompts.take("chat_2")).toBe("Linear recurrences");
	});

	it("practice: refuses empty text with the practice wording", async () => {
		const { fetchImpl, calls } = fakeFetch(() => json({}));
		await expect(startSession(fetchImpl, " ", new OpeningPrompts(), "practice")).rejects.toThrow(
			"Write what you want to practice.",
		);
		expect(calls).toHaveLength(0);
	});

	it("refuses empty text without a request", async () => {
		const { fetchImpl, calls } = fakeFetch(() => json({}));
		await expect(startSession(fetchImpl, "   ", new OpeningPrompts())).rejects.toThrow(
			"Write what you want to learn.",
		);
		expect(calls).toHaveLength(0);
	});

	it("refuses an answer with an unsafe id (the id goes into paths)", async () => {
		const { fetchImpl } = fakeFetch(() => json({ id: "../settings" }));
		await expect(startSession(fetchImpl, "x", new OpeningPrompts())).rejects.toThrow(
			"The Mac sent an invalid session.",
		);
	});
});

describe("readSession", () => {
	it("returns the record, the running-turn flag, the compaction flag and a kept failure", async () => {
		const messages = [{ role: "user", id: "u1", content: "hi", timestamp: 1 }];
		const { fetchImpl, calls } = fakeFetch(() =>
			json({
				id: "c1",
				title: "T",
				messages,
				turnInFlight: true,
				turnError: "Rate limit",
				compacting: true,
			}),
		);
		const record = await readSession(fetchImpl, "c1");
		expect(calls[0]!.path).toBe("/api/chats/c1");
		expect(record).toEqual({
			id: "c1",
			title: "T",
			kind: "teach",
			messages,
			turnInFlight: true,
			turnError: "Rate limit",
			compacting: true,
		});
	});

	it("reads kind practice; any other kind reads as a teaching session", async () => {
		const practice = fakeFetch(() => json({ id: "c1", kind: "practice", messages: [] }));
		expect((await readSession(practice.fetchImpl, "c1")).kind).toBe("practice");
		const odd = fakeFetch(() => json({ id: "c1", kind: "quiz", messages: [] }));
		expect((await readSession(odd.fetchImpl, "c1")).kind).toBe("teach");
	});

	it("error state: a compaction flag that is not true reads as false", async () => {
		const { fetchImpl } = fakeFetch(() => json({ id: "c1", messages: [], compacting: "yes" }));
		expect((await readSession(fetchImpl, "c1")).compacting).toBe(false);
	});

	it("refuses an unsafe id without a request", async () => {
		const { fetchImpl, calls } = fakeFetch(() => json({}));
		await expect(readSession(fetchImpl, "a/b")).rejects.toThrow("Not a session id: a/b");
		expect(calls).toHaveLength(0);
	});

	it("says that the session is gone on 404", async () => {
		const { fetchImpl } = fakeFetch(() => json({ error: "Not found" }, 404));
		await expect(readSession(fetchImpl, "c1")).rejects.toThrow(
			"This session is not on the Mac any more.",
		);
	});
});
