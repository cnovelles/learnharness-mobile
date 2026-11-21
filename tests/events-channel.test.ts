/**
 * The phone's /api/events reader: frames, pings, the reconnect after a drop
 * or a stall, and the stop on 401. Short real delays keep the test fast.
 */
import { openEventsChannel, parseEventFrame, type ServerEventMessage } from "@/lib/events-channel";

/** One fake /api/events connection that the test writes to and ends. */
function fakeStream() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
	const encoder = new TextEncoder();
	return {
		response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
		write: (text: string) => controller.enqueue(encoder.encode(text)),
		end: () => controller.close(),
	};
}

const until = async (check: () => boolean, ms = 2000) => {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await new Promise((r) => setTimeout(r, 5));
	}
};

describe("parseEventFrame", () => {
	it("reads the type and the JSON data", () => {
		expect(parseEventFrame('event: turn-started\ndata: {"chatId":"c1"}')).toEqual({
			type: "turn-started",
			payload: { chatId: "c1" },
		});
	});
	it("ignores pings, frames without a type and bad JSON", () => {
		expect(parseEventFrame(": ping")).toBeNull();
		expect(parseEventFrame('data: {"chatId":"c1"}')).toBeNull();
		expect(parseEventFrame("event: x\ndata: {oops")).toBeNull();
		expect(parseEventFrame("event: x\ndata: [1]")).toBeNull();
	});
	it("an event without data has an empty payload", () => {
		expect(parseEventFrame("event: chats-changed")).toEqual({ type: "chats-changed", payload: {} });
	});
});

describe("openEventsChannel", () => {
	it("delivers events split across chunks, skips pings, and connects again after a drop", async () => {
		const streams: ReturnType<typeof fakeStream>[] = [];
		const paths: string[] = [];
		const events: ServerEventMessage[] = [];
		let opens = 0;
		const channel = openEventsChannel({
			fetch: (async (input: RequestInfo | URL) => {
				paths.push(String(input));
				const s = fakeStream();
				streams.push(s);
				return s.response;
			}) as typeof fetch,
			onEvent: (e) => events.push(e),
			onOpen: () => opens++,
			retryDelaysMs: [5],
			stallMs: 1000,
		});
		await until(() => streams.length === 1);
		streams[0]!.write(": ping\n\nevent: turn-sta");
		streams[0]!.write('rted\ndata: {"chatId":"c1"}\n\n');
		await until(() => events.length === 1);
		expect(events[0]).toEqual({ type: "turn-started", payload: { chatId: "c1" } });

		streams[0]!.end(); // the Mac restarted or the network dropped
		await until(() => streams.length === 2);
		expect(opens).toBe(2);
		expect(paths).toEqual(["/api/events", "/api/events"]);
		streams[1]!.write('event: turn-settled\ndata: {"chatId":"c1"}\n\n');
		await until(() => events.length === 2);
		channel.close();
	});

	it("treats silence as a drop and connects again", async () => {
		let connections = 0;
		const channel = openEventsChannel({
			fetch: (async () => {
				connections++;
				return fakeStream().response; // never writes
			}) as typeof fetch,
			onEvent: () => {},
			retryDelaysMs: [5],
			stallMs: 30,
		});
		await until(() => connections >= 2);
		channel.close();
	});

	it("tries again after a failed request, and stops for good on close", async () => {
		let calls = 0;
		const channel = openEventsChannel({
			fetch: (async () => {
				calls++;
				throw new TypeError("Network request failed");
			}) as typeof fetch,
			onEvent: () => {},
			retryDelaysMs: [5],
		});
		await until(() => calls >= 3);
		channel.close();
		const after = calls;
		await new Promise((r) => setTimeout(r, 40));
		expect(calls).toBe(after);
	});

	it("stops on 401 (the Mac removed this phone)", async () => {
		let calls = 0;
		const stops: string[] = [];
		openEventsChannel({
			fetch: (async () => {
				calls++;
				return new Response("{}", { status: 401 });
			}) as typeof fetch,
			onEvent: () => {},
			onStop: (reason) => stops.push(reason),
			retryDelaysMs: [5],
		});
		await until(() => stops.length === 1);
		await new Promise((r) => setTimeout(r, 30));
		expect(calls).toBe(1);
		expect(stops).toEqual(["unpaired"]);
	});

	it("a listener that throws does not stop the channel", async () => {
		const s = fakeStream();
		const seen: string[] = [];
		const channel = openEventsChannel({
			fetch: (async () => s.response) as typeof fetch,
			onEvent: (e) => {
				seen.push(e.type);
				if (e.type === "a") throw new Error("bad listener");
			},
		});
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		await new Promise((r) => setTimeout(r, 5));
		s.write("event: a\n\nevent: b\n\n");
		await until(() => seen.length === 2);
		expect(seen).toEqual(["a", "b"]);
		warn.mockRestore();
		channel.close();
	});
});

it("close() ends an open connection that ignores its abort signal", async () => {
	const s = fakeStream();
	let connections = 0;
	const channel = openEventsChannel({
		fetch: (async () => {
			connections++;
			return s.response;
		}) as typeof fetch,
		onEvent: () => {},
		retryDelaysMs: [5],
	});
	await until(() => connections === 1);
	channel.close();
	await new Promise((r) => setTimeout(r, 30));
	expect(connections).toBe(1);
});
