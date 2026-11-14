/**
 * The Mac's notification channel (GET /api/events) through the Mac fetch.
 * The desktop uses EventSource; the phone reads the same SSE frames from a
 * streaming fetch, because every request must go through the pinned fetch.
 *
 * Frames: "event: <type>\ndata: <json>\n\n". The Mac sends ": ping" every
 * 25 seconds. Rules:
 * - After a drop, connect again: 1 s, 2 s, 5 s, then every 10 s.
 * - No byte in 60 s is a drop (a phone that changes network often gets no
 *   error, only silence).
 * - A 401 stops the channel: the Mac removed this phone. The connection
 *   monitor finds that out too and asks for a new pairing.
 * - Each new connection calls onOpen. Listeners read the truth again then,
 *   because events can be lost while the channel was down.
 */

export interface ServerEventMessage {
	type: string;
	payload: Record<string, unknown>;
}

export interface EventsChannelOptions {
	fetch: typeof globalThis.fetch;
	onEvent(event: ServerEventMessage): void;
	onOpen?(): void;
	onStop?(reason: "unpaired"): void;
	retryDelaysMs?: readonly number[];
	stallMs?: number;
}

export interface EventsChannel {
	close(): void;
}

export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000] as const;
export const STALL_MS = 60_000;

export function parseEventFrame(block: string): ServerEventMessage | null {
	let type = "";
	let data = "";
	for (const line of block.split("\n")) {
		if (line.startsWith("event: ")) type = line.slice("event: ".length).trim();
		else if (line.startsWith("data: ")) data += line.slice("data: ".length);
	}
	if (!type) return null;
	try {
		const payload = data ? (JSON.parse(data) as unknown) : {};
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
		return { type, payload: payload as Record<string, unknown> };
	} catch {
		return null;
	}
}

export function openEventsChannel(options: EventsChannelOptions): EventsChannel {
	const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
	const stallMs = options.stallMs ?? STALL_MS;
	let closed = false;
	/** Stops the open connection: aborts the request and cancels the reader. */
	let stopCurrent: (() => void) | null = null;
	let wakeUp: (() => void) | null = null;

	const safely = (fn: () => void) => {
		try {
			fn();
		} catch (e) {
			console.warn("events channel: a listener failed", e);
		}
	};

	async function connectOnce(): Promise<"opened" | "failed" | "unpaired"> {
		const controller = new AbortController();
		let stall: ReturnType<typeof setTimeout> | undefined;
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
		// Abort the request, and also cancel the reader: not every fetch ends
		// the body when its signal aborts.
		const stop = () => {
			controller.abort();
			void reader?.cancel().catch(() => {});
		};
		stopCurrent = stop;
		const arm = () => {
			clearTimeout(stall);
			stall = setTimeout(stop, stallMs);
		};
		let opened = false;
		try {
			arm();
			const res = await options.fetch("/api/events", {
				headers: { accept: "text/event-stream" },
				signal: controller.signal,
			});
			if (res.status === 401) return "unpaired";
			if (!res.ok || !res.body) return "failed";
			opened = true;
			safely(() => options.onOpen?.());
			reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done || closed) break;
					arm();
					buffer += decoder.decode(value, { stream: true });
					let end: number;
					while ((end = buffer.indexOf("\n\n")) >= 0) {
						const event = parseEventFrame(buffer.slice(0, end));
						buffer = buffer.slice(end + 2);
						if (event && !closed) safely(() => options.onEvent(event));
					}
				}
			} finally {
				await reader.cancel().catch(() => {});
				reader = null;
			}
		} catch {
			/* a drop, a stall or close(): the loop decides */
		} finally {
			clearTimeout(stall);
			if (stopCurrent === stop) stopCurrent = null;
		}
		return opened ? "opened" : "failed";
	}

	async function run() {
		let failures = 0;
		while (!closed) {
			const result = await connectOnce();
			if (closed) return;
			if (result === "unpaired") {
				closed = true;
				options.onStop?.("unpaired");
				return;
			}
			// A connection that opened and then ended starts the backoff again.
			failures = result === "opened" ? 0 : failures + 1;
			const delay = delays[Math.min(failures, delays.length - 1)]!;
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, delay);
				wakeUp = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			wakeUp = null;
		}
	}

	void run();
	return {
		close() {
			closed = true;
			stopCurrent?.();
			wakeUp?.();
		},
	};
}
