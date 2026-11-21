/**
 * The Deepgram engine (src/lib/dictation-deepgram.ts): the token from the
 * Mac, each Mac answer as an engine code, and a run through the controller.
 */
import { createDictation, DICTATION_MESSAGES } from "../src/lib/dictation";
import { createDeepgramEngine, deepgramToken } from "../src/lib/dictation-deepgram";
import type { NativeDictation } from "../modules/dictation/src";

function response(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => {
			if (body === "not json") throw new SyntaxError("x");
			return body;
		},
	} as Response;
}

function macWith(status: number, body: unknown): typeof fetch {
	return (async (url: string) => {
		expect(url).toBe("/api/stt/token");
		return response(status, body);
	}) as unknown as typeof fetch;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
	try {
		await p;
		return "resolved";
	} catch (error) {
		return (error as Error).message;
	}
}

test("the token comes from the Mac; each Mac answer has its own code", async () => {
	expect(await deepgramToken(macWith(200, { token: "t-1" }))).toBe("t-1");
	expect(await codeOf(deepgramToken(macWith(503, { message: "No DEEPGRAM_API_KEY" })))).toBe(
		"deepgram-no-key",
	);
	expect(await codeOf(deepgramToken(macWith(502, { message: "grant failed (401)" })))).toBe(
		"deepgram-grant",
	);
	expect(await codeOf(deepgramToken(macWith(200, { token: "" })))).toBe("deepgram-grant");
	expect(await codeOf(deepgramToken(macWith(200, "not json")))).toBe("deepgram-grant");
	expect(await codeOf(deepgramToken(null))).toBe("mac-unreachable");
	const down = (async () => {
		throw new TypeError("Network request failed");
	}) as unknown as typeof fetch;
	expect(await codeOf(deepgramToken(down))).toBe("mac-unreachable");
});

type Listener = (e: Record<string, unknown>) => void;

function fakeNative() {
	const listeners = new Map<string, Set<Listener>>();
	const calls: unknown[][] = [];
	const native = {
		isSupported: () => false, // Deepgram does not need iOS 26
		microphonePermission: () => "granted",
		requestMicrophone: async () => true,
		status: async () => ({ engine: "none", locale: "", model: "unsupported" }),
		install: async () => {},
		start: async () => {},
		startFile: async () => {},
		startDeepgram: async (...args: unknown[]) => {
			calls.push(["startDeepgram", ...args]);
		},
		stop: async () => {
			calls.push(["stop"]);
		},
		cancel: async () => {
			calls.push(["cancel"]);
		},
		addListener(event: string, fn: Listener) {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event)!.add(fn);
			return { remove: () => listeners.get(event)!.delete(fn) };
		},
	} as unknown as NativeDictation;
	const emit = (event: string, body: Record<string, unknown>) => {
		for (const fn of [...(listeners.get(event) ?? [])]) fn(body);
	};
	return { native, calls, emit, listeners };
}

function setup(mac: typeof fetch | null) {
	const n = fakeNative();
	const engine = createDeepgramEngine(n.native, () => mac);
	const d = createDictation({
		engine: () => engine,
		language: async () => "multi",
		newId: () => "r1",
	});
	const got: string[] = [];
	return { ...n, d, got, deliver: (t: string) => got.push(t) };
}

test("a Deepgram run: the token and the language go to the native side; the finals come back", async () => {
	const s = setup(macWith(200, { token: "t-1" }));
	await s.d.start(Symbol("f"), s.deliver);
	expect(s.calls[0]).toEqual(["startDeepgram", "r1", "multi", "t-1"]);
	expect(s.d.getSnapshot().phase).toBe("listening");
	s.emit("speechText", { id: "other", text: "not mine" });
	s.emit("speechText", { id: "r1", text: "Two bulges." });
	await s.d.stop();
	s.emit("speechEnd", { id: "r1" });
	expect(s.got).toEqual(["Two bulges."]);
	// The listeners are gone after the end.
	expect([...s.listeners.values()].every((set) => set.size === 0)).toBe(true);
});

test("Deepgram works on an iPhone before iOS 26 (no on-device model needed)", async () => {
	const s = setup(macWith(200, { token: "t" }));
	await s.d.start(Symbol("f"), s.deliver);
	expect(s.d.getSnapshot().problem).toBeNull();
	expect(s.d.getSnapshot().phase).toBe("listening");
});

test("no Deepgram key on the Mac", async () => {
	const s = setup(macWith(503, {}));
	await s.d.start(Symbol("f"), s.deliver);
	expect(s.calls).toEqual([]);
	expect(s.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.deepgramNoKey);
});

test("the Mac is not reachable", async () => {
	const s = setup(null);
	await s.d.start(Symbol("f"), s.deliver);
	expect(s.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.deepgramMacUnreachable);
});

test("the token grant fails", async () => {
	const s = setup(macWith(502, {}));
	await s.d.start(Symbol("f"), s.deliver);
	expect(s.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.deepgramNoAnswer);
});

test("Deepgram refuses the socket", async () => {
	const s = setup(macWith(200, { token: "t" }));
	await s.d.start(Symbol("f"), s.deliver);
	s.emit("speechEnd", { id: "r1", error: "deepgram-refused" });
	expect(s.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.deepgramNoAnswer);
});

test("the connection drops: the text so far goes into the field, and the message says why", async () => {
	const s = setup(macWith(200, { token: "t" }));
	await s.d.start(Symbol("f"), s.deliver);
	s.emit("speechText", { id: "r1", text: "First half." });
	s.emit("speechEnd", { id: "r1", error: "deepgram-lost" });
	expect(s.got).toEqual(["First half."]);
	expect(s.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.deepgramLost);
});

test("the native start fails: the listeners go away and the code becomes a message", async () => {
	const s = setup(macWith(200, { token: "t" }));
	(s.native as { startDeepgram: unknown }).startDeepgram = async () => {
		throw Object.assign(new Error("deepgram-language"), { code: "ERR" });
	};
	await s.d.start(Symbol("f"), s.deliver);
	expect(s.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.deepgramLanguage);
	expect([...s.listeners.values()].every((set) => set.size === 0)).toBe(true);
});
