/**
 * src/lib/pairing.ts: payload parse (pin, https origins with new URL()),
 * pairing (first answer decides), reachability (401 = unpaired, only from a
 * server that passes the pin) and the remote fetch adapter.
 *
 * The fake network acts like the native PinnedFetch: each server has a
 * certificate pin, and a request whose pin does not match is refused
 * BEFORE the server receives it. `received` shows what each server got.
 */
import {
	PairingError,
	PinMismatchError,
	findReachableUrl,
	gatewayOrigin,
	isValidPin,
	pair,
	parsePairingPayload,
	remoteFetch,
	type Connection,
	type PinnedFetch,
} from "@/lib/pairing";

const CODE = "c".repeat(24);
const PIN = `sha256/${"A".repeat(42)}Q=`;
const OTHER_PIN = `sha256/${"B".repeat(42)}Q=`;
const TAILSCALE = "https://100.64.0.5:47821";
const LAN = "https://192.168.1.20:47821";
const payloadText = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		lh: 2,
		name: "Studio Mac",
		urls: [TAILSCALE, LAN],
		pin: PIN,
		code: CODE,
		...over,
	});

type Answer = Response | "unreachable" | "hang";
type Received = { url: string; authorization: string | null; body: unknown };

/** Servers by origin, each with its certificate pin. */
function fakeNetwork(servers: Record<string, { pin?: string; answer: Answer }>) {
	const received: Record<string, Received[]> = {};
	const attempts: { url: string; pin: string }[] = [];
	const fetchImpl: PinnedFetch = (url, init) => {
		attempts.push({ url, pin: init.pin });
		const origin = new URL(url).origin;
		const server = servers[origin];
		if (!server || server.answer === "unreachable")
			return Promise.reject(new TypeError("Network request failed"));
		// The verifier: the TLS handshake ends here when the pin is wrong.
		if ((server.pin ?? PIN) !== init.pin) return Promise.reject(new PinMismatchError());
		if (server.answer === "hang")
			return new Promise<Response>((_, reject) =>
				init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
			);
		(received[origin] ??= []).push({
			url,
			authorization: new Headers(init.headers).get("authorization"),
			body: init.body,
		});
		return Promise.resolve(server.answer.clone());
	};
	return { fetchImpl, received, attempts };
}
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PAIRED = {
	token: "t".repeat(43),
	deviceId: "dev_abc",
	protocol: 2,
	server: { name: "Studio Mac (server)", version: "0.6.1" },
};

describe("gatewayOrigin (new URL())", () => {
	it.each([
		[TAILSCALE, TAILSCALE],
		[`${LAN}/`, LAN],
		["https://[fd7a:115c:a1e0::1]:47821", "https://[fd7a:115c:a1e0::1]:47821"],
	])("accepts %s", (text, origin) => {
		expect(gatewayOrigin(text)).toBe(origin);
	});

	it.each([
		["plain http", "http://100.64.0.5:47821"],
		["another scheme", "ftp://100.64.0.5:47821"],
		["user info", "https://user:pw@100.64.0.5:47821"],
		["a path", "https://100.64.0.5:47821/phone"],
		["a query", "https://100.64.0.5:47821?x=1"],
		["a fragment", "https://100.64.0.5:47821#x"],
		["a space", "https://a b:47821"],
		["a default port written out", "https://100.64.0.5:443"],
		["no host", "https://"],
		["not text", 5],
		["a host that new URL() rewrites", "https://0x7f.1:47821"],
	])("refuses %s", (_name, text) => {
		expect(gatewayOrigin(text)).toBeNull();
	});
});

describe("parsePairingPayload", () => {
	it("reads the name, the https addresses, the pin and the code; ignores space around the text", () => {
		expect(parsePairingPayload(`  ${payloadText()}\n`)).toEqual({
			name: "Studio Mac",
			urls: [TAILSCALE, LAN],
			pin: PIN,
			code: CODE,
		});
	});

	it("reads text with curly double quotes (iOS smart punctuation changes typed quotes)", () => {
		const curly = payloadText()
			.replace(/"(?=[^"]*"[:,}\]])/g, "“")
			.replace(/"/g, "”");
		expect(curly).not.toContain('"');
		expect(parsePairingPayload(curly)).toEqual(parsePairingPayload(payloadText()));
	});

	it("refuses text that is not a pairing code", () => {
		expect(() => parsePairingPayload("hello")).toThrow(PairingError);
		expect(() => parsePairingPayload("{}")).toThrow("not a LearnHarness pairing code");
		expect(() => parsePairingPayload("null")).toThrow("not a LearnHarness pairing code");
	});

	it("refuses another protocol, including the plain HTTP protocol 1", () => {
		expect(() => parsePairingPayload(payloadText({ lh: 1 }))).toThrow(
			"different LearnHarness version",
		);
		expect(() => parsePairingPayload(payloadText({ lh: 3 }))).toThrow(
			"different LearnHarness version",
		);
	});

	it("refuses a payload without a valid pin", () => {
		for (const pin of [
			undefined,
			"",
			"sha256/short",
			`sha1/${"A".repeat(42)}Q=`,
			`sha256/${"A".repeat(43)}`,
			7,
		]) {
			expect(() => parsePairingPayload(payloadText({ pin }))).toThrow("no valid certificate pin");
		}
	});

	it("refuses a short or missing code", () => {
		expect(() => parsePairingPayload(payloadText({ code: "abc" }))).toThrow("incomplete");
		expect(() => parsePairingPayload(payloadText({ code: undefined }))).toThrow("incomplete");
	});

	it("keeps only https gateway origins, without duplicates, and refuses a payload with none", () => {
		const parsed = parsePairingPayload(
			payloadText({
				urls: [
					"http://10.0.0.2:47821",
					"https://10.0.0.2:47821",
					"https://10.0.0.2:47821/",
					"ftp://x",
					"https://h/path",
					5,
				],
			}),
		);
		expect(parsed.urls).toEqual(["https://10.0.0.2:47821"]);
		expect(() => parsePairingPayload(payloadText({ urls: [] }))).toThrow("no network address");
		expect(() => parsePairingPayload(payloadText({ urls: ["http://100.64.0.5:47821"] }))).toThrow(
			"no network address",
		);
	});

	it("uses a default name", () => {
		expect(parsePairingPayload(payloadText({ name: "" })).name).toBe("Mac");
	});
});

describe("pair", () => {
	const payload = parsePairingPayload(payloadText());

	it("posts the code and the device name with the pin, and returns the connection with the pin", async () => {
		const net = fakeNetwork({ [TAILSCALE]: { answer: json(200, PAIRED) } });
		const connection = await pair(payload, "Test iPhone", net.fetchImpl);
		expect(net.attempts).toEqual([{ url: `${TAILSCALE}/phone/v1/pair`, pin: PIN }]);
		expect(JSON.parse(String(net.received[TAILSCALE]![0]!.body))).toEqual({
			code: CODE,
			deviceName: "Test iPhone",
		});
		expect(connection).toMatchObject({
			name: "Studio Mac (server)",
			urls: payload.urls,
			pin: PIN,
			token: PAIRED.token,
			deviceId: "dev_abc",
		});
	});

	it("moves on from an unreachable address and puts the working address first", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { answer: "unreachable" },
			[LAN]: { answer: json(200, PAIRED) },
		});
		const connection = await pair(payload, "iPhone", net.fetchImpl);
		expect(net.attempts.map((a) => a.url)).toEqual([
			`${TAILSCALE}/phone/v1/pair`,
			`${LAN}/phone/v1/pair`,
		]);
		expect(connection.urls).toEqual([LAN, TAILSCALE]);
	});

	it("moves on from an address that does not answer in time", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { answer: "hang" },
			[LAN]: { answer: json(200, PAIRED) },
		});
		expect((await pair(payload, "iPhone", net.fetchImpl, 20)).urls[0]).toBe(LAN);
	});

	it("sends the code only to the server that passes the pin", async () => {
		// Another device at the Tailscale address (another network): it gets nothing.
		const net = fakeNetwork({
			[TAILSCALE]: { pin: OTHER_PIN, answer: json(200, { ...PAIRED, token: "stolen".repeat(8) }) },
			[LAN]: { answer: json(200, PAIRED) },
		});
		const connection = await pair(payload, "iPhone", net.fetchImpl);
		expect(net.received[TAILSCALE]).toBeUndefined();
		expect(connection.token).toBe(PAIRED.token);
		expect(connection.urls[0]).toBe(LAN);
	});

	it("says so when only devices with another certificate answer", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { pin: OTHER_PIN, answer: json(200, PAIRED) },
			[LAN]: { answer: "unreachable" },
		});
		await expect(pair(payload, "iPhone", net.fetchImpl)).rejects.toThrow(
			"but it is not Studio Mac. Nothing was sent.",
		);
		expect(net.received).toEqual({});
	});

	it("refuses a payload without a valid pin before it sends anything", async () => {
		const net = fakeNetwork({ [TAILSCALE]: { answer: json(200, PAIRED) } });
		await expect(pair({ ...payload, pin: "" }, "iPhone", net.fetchImpl)).rejects.toThrow(
			"no valid certificate pin",
		);
		expect(net.attempts).toEqual([]);
	});

	it("never sends the code to an http address, even when the payload object has one", async () => {
		const net = fakeNetwork({ "http://100.64.0.5:47821": { answer: json(200, PAIRED) } });
		await expect(
			pair({ ...payload, urls: ["http://100.64.0.5:47821"] }, "iPhone", net.fetchImpl),
		).rejects.toThrow("cannot reach");
		expect(net.attempts).toEqual([]);
	});

	it("stops at the first refusal: the code is one-use", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: {
				answer: json(401, {
					error: "The pairing code is not valid or has expired. Show a new QR code on the Mac.",
				}),
			},
			[LAN]: { answer: json(200, PAIRED) },
		});
		await expect(pair(payload, "iPhone", net.fetchImpl)).rejects.toThrow(
			"The pairing code is not valid or has expired",
		);
		expect(net.attempts).toHaveLength(1);
	});

	it("shows text written for the user for any other refusal, never the Mac's raw text", async () => {
		const net = fakeNetwork({ [TAILSCALE]: { answer: new Response("busy", { status: 503 }) } });
		await expect(pair(payload, "iPhone", net.fetchImpl)).rejects.toThrow(
			"The Mac refused the pairing. Show a new QR code on the Mac, and then try again.",
		);
		const raw = fakeNetwork({
			[TAILSCALE]: { answer: json(400, { error: "invalid JSON" }) },
		});
		await expect(pair(payload, "iPhone", raw.fetchImpl)).rejects.not.toThrow("invalid JSON");
	});

	it("tells the user to wait when the Mac's server is not ready (502)", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { answer: json(502, { error: "The LearnHarness server is not reachable." }) },
		});
		await expect(pair(payload, "iPhone", net.fetchImpl)).rejects.toThrow(
			"LearnHarness on the Mac is not ready.",
		);
	});

	it("refuses an invalid answer and another protocol", async () => {
		await expect(
			pair(
				payload,
				"iPhone",
				fakeNetwork({ [TAILSCALE]: { answer: json(200, { deviceId: "x" }) } }).fetchImpl,
			),
		).rejects.toThrow("invalid pairing answer");
		await expect(
			pair(
				payload,
				"iPhone",
				fakeNetwork({ [TAILSCALE]: { answer: json(200, { ...PAIRED, protocol: 1 }) } }).fetchImpl,
			),
		).rejects.toThrow("different phone protocol");
	});

	it("names the Mac when no address answers", async () => {
		await expect(pair(payload, "iPhone", fakeNetwork({}).fetchImpl)).rejects.toThrow(
			"The phone cannot reach Studio Mac.",
		);
	});
});

describe("findReachableUrl", () => {
	const connection: Connection = {
		name: "Mac",
		urls: [TAILSCALE, LAN],
		pin: PIN,
		token: "tok_" + "x".repeat(30),
		deviceId: "dev_1",
		pairedAt: "2026-11-14T00:00:00Z",
	};

	it("pings with the token and the pin, and returns the first answering address", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { answer: "unreachable" },
			[LAN]: { answer: json(200, { ok: true }) },
		});
		expect(await findReachableUrl(connection, net.fetchImpl)).toEqual({ kind: "ok", url: LAN });
		expect(net.attempts[1]).toEqual({ url: `${LAN}/phone/v1/ping`, pin: PIN });
		expect(net.received[LAN]![0]!.authorization).toBe(`Bearer ${connection.token}`);
	});

	it("reports unpaired on a 401 from the Mac", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { answer: json(401, { error: "This phone is not paired" }) },
		});
		expect(await findReachableUrl(connection, net.fetchImpl)).toEqual({ kind: "unpaired" });
	});

	it("never sends the token to a server with another certificate, and its 401 does not unpair", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { pin: OTHER_PIN, answer: json(401, {}) },
			[LAN]: { pin: OTHER_PIN, answer: json(401, {}) },
		});
		expect(await findReachableUrl(connection, net.fetchImpl)).toEqual({
			kind: "unreachable",
			wrongCertificate: true,
		});
		expect(net.received).toEqual({});
	});

	it("passes a wrong-certificate address and uses the Mac at the next one", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { pin: OTHER_PIN, answer: json(200, {}) },
			[LAN]: { answer: json(200, { ok: true }) },
		});
		expect(await findReachableUrl(connection, net.fetchImpl)).toEqual({ kind: "ok", url: LAN });
		expect(net.received[TAILSCALE]).toBeUndefined();
	});

	it("reports unreachable when no address answers or all fail with other errors", async () => {
		expect(await findReachableUrl(connection, fakeNetwork({}).fetchImpl)).toEqual({
			kind: "unreachable",
			wrongCertificate: false,
		});
		const net = fakeNetwork({ [TAILSCALE]: { answer: json(502, {}) }, [LAN]: { answer: "hang" } });
		expect(await findReachableUrl(connection, net.fetchImpl, 20)).toEqual({
			kind: "unreachable",
			wrongCertificate: false,
		});
	});

	it("sends nothing for a stored connection without a valid pin or with http addresses", async () => {
		const net = fakeNetwork({
			[TAILSCALE]: { answer: json(200, {}) },
			"http://10.0.0.2:47821": { answer: json(200, {}) },
		});
		expect((await findReachableUrl({ ...connection, pin: "" }, net.fetchImpl)).kind).toBe(
			"unreachable",
		);
		expect(
			(await findReachableUrl({ ...connection, urls: ["http://10.0.0.2:47821"] }, net.fetchImpl))
				.kind,
		).toBe("unreachable");
		expect(net.attempts).toEqual([]);
	});
});

describe("remoteFetch", () => {
	const auth = { token: "secret-token", pin: PIN };

	it("adds the base URL, the token and the pin, and keeps the caller's method, body and headers", async () => {
		const net = fakeNetwork({ [LAN]: { answer: json(200, {}) } });
		const f = remoteFetch(LAN, auth, net.fetchImpl);
		await f("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(net.attempts).toEqual([{ url: `${LAN}/api/chat`, pin: PIN }]);
		expect(net.received[LAN]![0]).toEqual({
			url: `${LAN}/api/chat`,
			authorization: "Bearer secret-token",
			body: "{}",
		});
	});

	it("accepts a URL object path with a query", async () => {
		const net = fakeNetwork({ [LAN]: { answer: json(200, {}) } });
		await remoteFetch(LAN, auth, net.fetchImpl)(new URL("http://ignored/api/chats?x=1"));
		expect(net.attempts[0]!.url).toBe(`${LAN}/api/chats?x=1`);
	});

	it("refuses an absolute or protocol-relative URL, so the token never goes to another host", () => {
		const net = fakeNetwork({});
		const f = remoteFetch(LAN, auth, net.fetchImpl);
		expect(() => f("https://evil.example/api")).toThrow("expected a relative path");
		expect(() => f("//evil.example/api")).toThrow("expected a relative path");
		expect(net.attempts).toHaveLength(0);
	});

	it("refuses an http base URL and a missing pin", () => {
		const net = fakeNetwork({});
		expect(() => remoteFetch("http://10.0.0.2:47821", auth, net.fetchImpl)).toThrow(
			"not an https gateway address",
		);
		expect(() => remoteFetch(LAN, { token: "t", pin: "" }, net.fetchImpl)).toThrow("no valid pin");
	});

	it("isValidPin matches the gateway format", () => {
		expect(isValidPin(PIN)).toBe(true);
		expect(isValidPin(PIN.replace("sha256/", "sha256//"))).toBe(false);
	});
});
