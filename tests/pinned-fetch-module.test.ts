/**
 * modules/pinned-fetch/src (JS side of the native module) with a fake
 * native module: the request goes to native with the pin, events become a
 * streaming Response, a pin mismatch rejects with PinMismatchError, and an
 * abort cancels the native request. The Swift side has its own macOS test
 * (modules/pinned-fetch/tests/run-pin-check-test.sh).
 */
import { createPinnedFetch, decodeBase64, type NativePinnedFetch } from "../modules/pinned-fetch/src";
import { PinMismatchError } from "@/lib/pairing";

const PIN = `sha256/${"A".repeat(42)}Q=`;
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

function fakeNative() {
	const listeners = new Map<string, (e: any) => void>();
	const started: { id: string; url: string; method: string; headers: Record<string, string>; body: string | null; pin: string }[] = [];
	const cancelled: string[] = [];
	const native: NativePinnedFetch = {
		start: async (id, url, method, headers, body, pin) => void started.push({ id, url, method, headers, body, pin }),
		cancel: (id) => void cancelled.push(id),
		addListener: ((event: string, fn: (e: any) => void) => {
			listeners.set(event, fn);
			return { remove: () => listeners.delete(event) };
		}) as NativePinnedFetch["addListener"],
	};
	const emit = (event: string, payload: unknown) => listeners.get(event)!(payload);
	return { native, started, cancelled, emit };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

it("decodes base64 like Node", () => {
	for (const text of ["", "a", "ab", "abc", "data: {\"x\":1}\n\n", "Ångström 東京 🌊"]) {
		expect(Buffer.from(decodeBase64(b64(text))).toString("utf8")).toBe(text);
	}
});

it("sends method, headers, body and pin to native; the response and body come from events", async () => {
	const n = fakeNative();
	const fetch = createPinnedFetch(n.native);
	const pending = fetch("https://10.0.0.2:47821/api/chat", { method: "post", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: "{}", pin: PIN });
	await tick();
	expect(n.started).toEqual([{ id: expect.any(String), url: "https://10.0.0.2:47821/api/chat", method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: "{}", pin: PIN }]);
	const { id } = n.started[0]!;
	n.emit("pinnedFetchResponse", { id, status: 200, headers: [["Content-Type", "application/json"]] });
	const res = await pending;
	expect(res.ok).toBe(true);
	expect(res.headers.get("content-type")).toBe("application/json");
	n.emit("pinnedFetchData", { id, data: b64('{"ok":') });
	n.emit("pinnedFetchData", { id, data: b64("true}") });
	n.emit("pinnedFetchEnd", { id });
	expect(await res.json()).toEqual({ ok: true });
});

it("streams the body chunk by chunk (SSE)", async () => {
	const n = fakeNative();
	const res = await (async () => {
		const p = createPinnedFetch(n.native)("https://10.0.0.2:47821/api/events", { pin: PIN });
		await tick();
		n.emit("pinnedFetchResponse", { id: n.started[0]!.id, status: 200, headers: [["content-type", "text/event-stream"]] });
		return p;
	})();
	const { id } = n.started[0]!;
	const reader = res.body!.getReader();
	n.emit("pinnedFetchData", { id, data: b64("data: 1\n\n") });
	expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");
	n.emit("pinnedFetchData", { id, data: b64("data: 2\n\n") });
	expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 2\n\n");
	await reader.cancel();
	expect(n.cancelled).toEqual([id]);
});

it("a pin mismatch rejects with PinMismatchError", async () => {
	const n = fakeNative();
	const p = createPinnedFetch(n.native)("https://10.0.0.2:47821/phone/v1/ping", { headers: { authorization: "Bearer t" }, pin: PIN });
	await tick();
	n.emit("pinnedFetchEnd", { id: n.started[0]!.id, error: "pin-mismatch" });
	await expect(p).rejects.toBeInstanceOf(PinMismatchError);
});

it("refuses http URLs and non-string bodies before native gets anything", async () => {
	const n = fakeNative();
	const fetch = createPinnedFetch(n.native);
	await expect(fetch("http://10.0.0.2:47821/phone/v1/ping", { headers: { authorization: "Bearer t" }, pin: PIN })).rejects.toThrow("only https");
	await expect(fetch("https://10.0.0.2:47821/x", { method: "POST", body: new Uint8Array([1]) as unknown as BodyInit, pin: PIN })).rejects.toThrow("only string bodies");
	expect(n.started).toEqual([]);
});

it("an abort cancels the native request and rejects with AbortError", async () => {
	const n = fakeNative();
	const controller = new AbortController();
	const p = createPinnedFetch(n.native)("https://10.0.0.2:47821/phone/v1/ping", { pin: PIN, signal: controller.signal });
	await tick();
	controller.abort();
	const { id } = n.started[0]!;
	expect(n.cancelled).toEqual([id]);
	n.emit("pinnedFetchEnd", { id, error: "cancelled" });
	await expect(p).rejects.toMatchObject({ name: "AbortError" });
});

it("a network error after the response errors the body", async () => {
	const n = fakeNative();
	const p = createPinnedFetch(n.native)("https://10.0.0.2:47821/api/chats", { pin: PIN });
	await tick();
	const { id } = n.started[0]!;
	n.emit("pinnedFetchResponse", { id, status: 200, headers: [] });
	const res = await p;
	n.emit("pinnedFetchEnd", { id, error: "The network connection was lost." });
	await expect(res.text()).rejects.toThrow("Network request failed: The network connection was lost.");
});
