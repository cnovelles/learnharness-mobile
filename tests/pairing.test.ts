/**
 * src/lib/pairing.ts: payload parse, pairing (first answer decides),
 * reachability (401 = unpaired) and the remote fetch adapter. A fake fetch
 * stands in for the Mac's phone gateway (electron/phone-access.cjs).
 */
import { PairingError, findReachableUrl, pair, parsePairingPayload, remoteFetch, type Connection } from "@/lib/pairing";

const CODE = "c".repeat(24);
const payloadText = (over: Record<string, unknown> = {}) =>
	JSON.stringify({ lh: 1, name: "Studio Mac", urls: ["http://100.64.0.5:47821", "http://192.168.1.20:47821"], code: CODE, ...over });

type Call = { url: string; init?: RequestInit };
/** A fetch whose answer depends on the URL. "unreachable" rejects like a network error. */
function fakeFetch(answers: Record<string, Response | "unreachable" | "hang">) {
	const calls: Call[] = [];
	const fetchImpl = (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		const host = Object.keys(answers).find((prefix) => url.startsWith(prefix));
		const answer = host ? answers[host] : "unreachable";
		if (answer === "unreachable") return Promise.reject(new TypeError("Network request failed"));
		if (answer === "hang")
			return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
		return Promise.resolve(answer.clone());
	};
	return { fetchImpl, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PAIRED = { token: "t".repeat(43), deviceId: "dev_abc", protocol: 1, server: { name: "Studio Mac (server)", version: "0.4.1" } };

describe("parsePairingPayload", () => {
	it("reads a valid payload, ignoring surrounding whitespace", () => {
		expect(parsePairingPayload(`  ${payloadText()}\n`)).toEqual({ name: "Studio Mac", urls: ["http://100.64.0.5:47821", "http://192.168.1.20:47821"], code: CODE });
	});

	it("refuses text that is not JSON", () => {
		expect(() => parsePairingPayload("hello")).toThrow(new PairingError("This is not a LearnHarness pairing code."));
	});

	it("refuses another protocol version", () => {
		expect(() => parsePairingPayload(payloadText({ lh: 2 }))).toThrow("different LearnHarness version");
	});

	it("refuses a short or missing code", () => {
		expect(() => parsePairingPayload(payloadText({ code: "short" }))).toThrow("incomplete");
		expect(() => parsePairingPayload(payloadText({ code: undefined }))).toThrow("incomplete");
	});

	it("keeps only plain http(s) origins and refuses a payload with none", () => {
		const parsed = parsePairingPayload(payloadText({ urls: ["http://10.0.0.2:47821", "ftp://x", "http://a b", "http://h/path", 5] }));
		expect(parsed.urls).toEqual(["http://10.0.0.2:47821"]);
		expect(() => parsePairingPayload(payloadText({ urls: [] }))).toThrow("no network address");
	});

	it("uses \"Mac\" when the name is missing", () => {
		expect(parsePairingPayload(payloadText({ name: "" })).name).toBe("Mac");
	});
});

describe("pair", () => {
	const payload = parsePairingPayload(payloadText());

	it("posts the code and device name and returns the connection", async () => {
		const { fetchImpl, calls } = fakeFetch({ "http://100.64.0.5": json(200, PAIRED) });
		const connection = await pair(payload, "Ana's iPhone", fetchImpl);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("http://100.64.0.5:47821/phone/v1/pair");
		expect(calls[0].init?.method).toBe("POST");
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({ code: CODE, deviceName: "Ana's iPhone" });
		expect(connection).toMatchObject({ name: "Studio Mac (server)", urls: payload.urls, token: PAIRED.token, deviceId: "dev_abc" });
		expect(Number.isNaN(Date.parse(connection.pairedAt))).toBe(false);
	});

	it("moves past an unreachable address and puts the answering one first", async () => {
		const { fetchImpl, calls } = fakeFetch({ "http://100.64.0.5": "unreachable", "http://192.168.1.20": json(200, PAIRED) });
		const connection = await pair(payload, "iPhone", fetchImpl);
		expect(calls.map((c) => c.url)).toEqual(["http://100.64.0.5:47821/phone/v1/pair", "http://192.168.1.20:47821/phone/v1/pair"]);
		expect(connection.urls).toEqual(["http://192.168.1.20:47821", "http://100.64.0.5:47821"]);
	});

	it("treats a timeout as unreachable", async () => {
		const { fetchImpl } = fakeFetch({ "http://100.64.0.5": "hang", "http://192.168.1.20": json(200, PAIRED) });
		const connection = await pair(payload, "iPhone", fetchImpl, 20);
		expect(connection.urls[0]).toBe("http://192.168.1.20:47821");
	});

	it("stops at the first answer: a refusal there is final, the next address is not tried", async () => {
		const { fetchImpl, calls } = fakeFetch({
			"http://100.64.0.5": json(401, { error: "The pairing code is not valid or has expired. Show a new QR code on the Mac." }),
			"http://192.168.1.20": json(200, PAIRED),
		});
		await expect(pair(payload, "iPhone", fetchImpl)).rejects.toThrow("The pairing code is not valid or has expired");
		expect(calls).toHaveLength(1);
	});

	it("gives a status message when the refusal has no JSON error", async () => {
		const { fetchImpl } = fakeFetch({ "http://100.64.0.5": new Response("busy", { status: 503 }) });
		await expect(pair(payload, "iPhone", fetchImpl)).rejects.toThrow("The Mac answered with status 503.");
	});

	it("refuses an invalid answer and another protocol", async () => {
		await expect(pair(payload, "iPhone", fakeFetch({ "http://100.64.0.5": json(200, { deviceId: "x" }) }).fetchImpl)).rejects.toThrow("invalid pairing answer");
		await expect(pair(payload, "iPhone", fakeFetch({ "http://100.64.0.5": json(200, { ...PAIRED, protocol: 2 }) }).fetchImpl)).rejects.toThrow("different phone protocol");
	});

	it("names the Mac when no address answers", async () => {
		await expect(pair(payload, "iPhone", fakeFetch({}).fetchImpl)).rejects.toThrow("The phone cannot reach Studio Mac.");
	});
});

describe("findReachableUrl", () => {
	const connection: Connection = { name: "Mac", urls: ["http://100.64.0.5:47821", "http://192.168.1.20:47821"], token: "tok_" + "x".repeat(30), deviceId: "dev_1", pairedAt: "2026-11-14T00:00:00Z" };

	it("pings with the token and returns the first answering address", async () => {
		const { fetchImpl, calls } = fakeFetch({ "http://100.64.0.5": "unreachable", "http://192.168.1.20": json(200, { ok: true }) });
		expect(await findReachableUrl(connection, fetchImpl)).toEqual({ kind: "ok", url: "http://192.168.1.20:47821" });
		expect(calls[1].url).toBe("http://192.168.1.20:47821/phone/v1/ping");
		expect(new Headers(calls[1].init?.headers).get("authorization")).toBe(`Bearer ${connection.token}`);
	});

	it("reports unpaired on 401", async () => {
		const { fetchImpl } = fakeFetch({ "http://100.64.0.5": json(401, { error: "This phone is not paired" }) });
		expect(await findReachableUrl(connection, fetchImpl)).toEqual({ kind: "unpaired" });
	});

	it("reports unreachable when no address answers or all fail with other errors", async () => {
		expect(await findReachableUrl(connection, fakeFetch({}).fetchImpl)).toEqual({ kind: "unreachable" });
		const { fetchImpl } = fakeFetch({ "http://100.64.0.5": json(502, {}), "http://192.168.1.20": "hang" });
		expect(await findReachableUrl(connection, fetchImpl, 20)).toEqual({ kind: "unreachable" });
	});
});

describe("remoteFetch", () => {
	it("adds the base URL and the token, and keeps the caller's method, body and headers", async () => {
		const { fetchImpl, calls } = fakeFetch({ "http://10.0.0.2": json(200, {}) });
		const f = remoteFetch("http://10.0.0.2:47821", "secret-token", fetchImpl);
		await f("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
		expect(calls[0].url).toBe("http://10.0.0.2:47821/api/chat");
		const headers = new Headers(calls[0].init?.headers);
		expect(headers.get("authorization")).toBe("Bearer secret-token");
		expect(headers.get("content-type")).toBe("application/json");
		expect(calls[0].init?.method).toBe("POST");
		expect(calls[0].init?.body).toBe("{}");
	});

	it("accepts a URL object path with a query", async () => {
		const { fetchImpl, calls } = fakeFetch({ "http://10.0.0.2": json(200, {}) });
		await remoteFetch("http://10.0.0.2:47821", "t", fetchImpl)(new URL("http://ignored/api/chats?x=1"));
		expect(calls[0].url).toBe("http://10.0.0.2:47821/api/chats?x=1");
	});

	it("refuses an absolute URL, so the token never goes to another host", () => {
		const { fetchImpl, calls } = fakeFetch({});
		expect(() => remoteFetch("http://10.0.0.2:47821", "t", fetchImpl)("https://evil.example/api")).toThrow("expected a relative path");
		expect(calls).toHaveLength(0);
	});
});
