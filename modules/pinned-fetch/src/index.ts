/**
 * JS side of the local Expo module "PinnedFetch" (ios/PinnedFetchModule.swift).
 * `createPinnedFetch(native)` turns the native events into a fetch that
 * returns a streaming Response-like object. The pin check happens in Swift,
 * before the request leaves the phone; a failed check rejects with
 * PinMismatchError (src/lib/pairing.ts).
 */
import { PinMismatchError, type PinnedFetch } from "../../../src/lib/pairing";

export interface NativePinnedFetch {
	start(id: string, url: string, method: string, headers: Record<string, string>, body: string | null, pin: string): Promise<void>;
	cancel(id: string): void;
	addListener(event: "pinnedFetchResponse", fn: (e: { id: string; status: number; headers: string[][] }) => void): { remove(): void };
	addListener(event: "pinnedFetchData", fn: (e: { id: string; data: string }) => void): { remove(): void };
	addListener(event: "pinnedFetchEnd", fn: (e: { id: string; error?: string }) => void): { remove(): void };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

export function decodeBase64(text: string): Uint8Array {
	const clean = text.replace(/=+$/, "");
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0;
	let value = 0;
	let o = 0;
	for (const ch of clean) {
		const n = B64_INDEX.get(ch);
		if (n === undefined) throw new Error("pinned fetch: bad base64 from native");
		value = (value << 6) | n;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (value >> bits) & 0xff;
		}
	}
	return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

class AbortError extends Error {
	constructor() {
		super("The request was aborted.");
		this.name = "AbortError";
	}
}

/** The body: chunks from native, read once, as a stream or as a whole. */
class BodyQueue {
	private chunks: Uint8Array[] = [];
	private waiting: ((r: { chunk?: Uint8Array; done: boolean; error?: Error }) => void) | null = null;
	private ended = false;
	private failure: Error | null = null;

	push(chunk: Uint8Array) {
		if (this.waiting) {
			const w = this.waiting;
			this.waiting = null;
			w({ chunk, done: false });
		} else this.chunks.push(chunk);
	}
	end(error: Error | null) {
		this.ended = true;
		this.failure = error;
		if (this.waiting) {
			const w = this.waiting;
			this.waiting = null;
			w({ done: true, error: error ?? undefined });
		}
	}
	next(): Promise<{ chunk?: Uint8Array; done: boolean; error?: Error }> {
		const chunk = this.chunks.shift();
		if (chunk) return Promise.resolve({ chunk, done: false });
		if (this.ended) return Promise.resolve({ done: true, error: this.failure ?? undefined });
		return new Promise((resolve) => (this.waiting = resolve));
	}
}

class PinnedResponse {
	readonly ok: boolean;
	readonly headers: Headers;
	bodyUsed = false;
	private stream: ReadableStream<Uint8Array> | null = null;

	constructor(
		readonly status: number,
		headers: string[][],
		readonly url: string,
		private readonly queue: BodyQueue,
		private readonly cancel: () => void,
	) {
		this.ok = status >= 200 && status < 300;
		this.headers = new Headers(headers.map(([k, v]) => [k, v] as [string, string]));
	}

	get statusText() {
		return "";
	}

	get body(): ReadableStream<Uint8Array> {
		if (this.stream) return this.stream;
		this.bodyUsed = true;
		const queue = this.queue;
		const cancel = this.cancel;
		this.stream = new ReadableStream<Uint8Array>({
			async pull(controller) {
				const r = await queue.next();
				if (r.error) controller.error(r.error);
				else if (r.done) controller.close();
				else controller.enqueue(r.chunk!);
			},
			cancel() {
				cancel();
			},
		});
		return this.stream;
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		if (this.bodyUsed) throw new TypeError("Body already used.");
		this.bodyUsed = true;
		const chunks: Uint8Array[] = [];
		for (;;) {
			const r = await this.queue.next();
			if (r.error) throw r.error;
			if (r.done) break;
			chunks.push(r.chunk!);
		}
		const all = concat(chunks);
		return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
	}

	async text(): Promise<string> {
		return new TextDecoder().decode(await this.arrayBuffer());
	}

	async json(): Promise<unknown> {
		return JSON.parse(await this.text());
	}
}

function headersRecord(init: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	new Headers(init).forEach((value, name) => (out[name] = value));
	return out;
}

let counter = 0;

/** A PinnedFetch on top of the native module (or a fake of it in tests). */
export function createPinnedFetch(native: NativePinnedFetch): PinnedFetch {
	type Pending = {
		resolve: (r: Response) => void;
		reject: (e: Error) => void;
		url: string;
		queue: BodyQueue;
		answered: boolean;
		cleanup: () => void;
	};
	const pending = new Map<string, Pending>();

	native.addListener("pinnedFetchResponse", ({ id, status, headers }) => {
		const p = pending.get(id);
		if (!p || p.answered) return;
		p.answered = true;
		p.resolve(new PinnedResponse(status, headers, p.url, p.queue, () => native.cancel(id)) as unknown as Response);
	});
	native.addListener("pinnedFetchData", ({ id, data }) => {
		pending.get(id)?.queue.push(decodeBase64(data));
	});
	native.addListener("pinnedFetchEnd", ({ id, error }) => {
		const p = pending.get(id);
		if (!p) return;
		pending.delete(id);
		p.cleanup();
		const failure =
			error === undefined
				? null
				: error === "pin-mismatch"
					? new PinMismatchError()
					: error === "cancelled"
						? new AbortError()
						: new TypeError(`Network request failed: ${error}`);
		if (!p.answered) {
			p.answered = true;
			p.reject(failure ?? new TypeError("Network request failed: no response"));
		}
		p.queue.end(failure);
	});

	return (url, init) => {
		if (!/^https:\/\//i.test(url)) return Promise.reject(new TypeError(`pinned fetch: only https URLs are allowed: ${url}`));
		if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
			return Promise.reject(new TypeError("pinned fetch: only string bodies are supported"));
		}
		const signal = init.signal;
		if (signal?.aborted) return Promise.reject(new AbortError());
		const id = `pf_${++counter}`;
		return new Promise<Response>((resolve, reject) => {
			const onAbort = () => native.cancel(id);
			signal?.addEventListener("abort", onAbort);
			const entry: Pending = { resolve, reject, url, queue: new BodyQueue(), answered: false, cleanup: () => signal?.removeEventListener("abort", onAbort) };
			pending.set(id, entry);
			native.start(id, url, (init.method ?? "GET").toUpperCase(), headersRecord(init.headers), (init.body as string | null | undefined) ?? null, init.pin).catch((err: unknown) => {
				pending.delete(id);
				entry.cleanup();
				reject(err instanceof Error ? err : new TypeError(String(err)));
			});
		});
	};
}
