/**
 * Pairing with the desktop fork's phone gateway (electron/phone-access.cjs).
 * Pure functions with an injectable fetch, so tests run without a phone.
 *
 * QR payload (protocol 2):
 * {"lh":2,"name":"<mac>","urls":["https://100.x.y.z:47821", ...],"pin":"sha256/<base64>","code":"<one-use code>"}
 *
 * The gateway has a self-signed certificate. The phone trusts no CA for it:
 * every request goes through a PinnedFetch, which checks the SHA-256 of the
 * server's public key (SPKI) against the pin from the QR code after the TLS
 * handshake and before it sends the request. So a device at a saved address
 * on another network never gets the pairing code or the token.
 */

export const PROTOCOL = 2;

export interface PairingPayload {
	name: string;
	urls: string[];
	/** "sha256/" + base64 SHA-256 of the gateway certificate's SPKI. */
	pin: string;
	code: string;
}

/** A paired desktop. The token is secret: keep it in the secure store only. */
export interface Connection {
	name: string;
	urls: string[];
	pin: string;
	token: string;
	deviceId: string;
	pairedAt: string;
}

export class PairingError extends Error {}

/** The server certificate does not have the pinned public key. Nothing was sent. */
export class PinMismatchError extends Error {
	constructor(message = "The server certificate does not match the pin.") {
		super(message);
		this.name = "PinMismatchError";
	}
}

/**
 * A fetch that pins. It must reject with PinMismatchError, before it sends a
 * byte of the request, when the server certificate's SPKI SHA-256 is not
 * `init.pin`. The app uses the native module (modules/pinned-fetch); tests
 * use a fake with an injected verifier.
 */
export type PinnedFetch = (url: string, init: RequestInit & { pin: string }) => Promise<Response>;

const PIN_PATTERN = /^sha256\/[A-Za-z0-9+/]{43}=$/;

export function isValidPin(pin: unknown): pin is string {
	return typeof pin === "string" && PIN_PATTERN.test(pin);
}

/**
 * A gateway address: https, a host and nothing else (no user info, path,
 * query or fragment). Returns the origin, or null when the text is not one.
 */
export function gatewayOrigin(text: unknown): string | null {
	if (typeof text !== "string") return null;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || !url.hostname) return null;
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== "/" && url.pathname !== "") return null;
	// `new URL` accepts "https://host:443/" too; keep the text exactly an origin.
	if (text.replace(/\/$/, "") !== url.origin) return null;
	return url.origin;
}

export function parsePairingPayload(text: string): PairingPayload {
	let raw: unknown;
	try {
		// iOS smart punctuation (and some apps that share text) change typed
		// straight quotes to curly ones. The payload has no other double quotes.
		raw = JSON.parse(text.trim().replace(/[“”„‟″]/g, '"'));
	} catch {
		throw new PairingError("This is not a LearnHarness pairing code.");
	}
	const value = raw as {
		lh?: unknown;
		name?: unknown;
		urls?: unknown;
		pin?: unknown;
		code?: unknown;
	};
	if (typeof value !== "object" || value === null || !("lh" in value))
		throw new PairingError("This is not a LearnHarness pairing code.");
	if (value.lh !== PROTOCOL)
		throw new PairingError(
			"This pairing code is from a different LearnHarness version. Update the app on the Mac and on the phone.",
		);
	if (typeof value.code !== "string" || value.code.length < 16)
		throw new PairingError("The pairing code is incomplete.");
	if (!isValidPin(value.pin))
		throw new PairingError(
			"The pairing code has no valid certificate pin. Show a new QR code on the Mac.",
		);
	const urls = Array.isArray(value.urls)
		? [...new Set(value.urls.map(gatewayOrigin).filter((u): u is string => u !== null))]
		: [];
	if (urls.length === 0)
		throw new PairingError(
			"The Mac has no network address. Connect it to Wi-Fi or Tailscale and show a new code.",
		);
	return {
		name: typeof value.name === "string" && value.name ? value.name : "Mac",
		urls,
		pin: value.pin,
		code: value.code,
	};
}

/** fetch with a timeout. A timeout means "address not reachable", not an answer. */
async function fetchWithTimeout(
	fetchImpl: PinnedFetch,
	url: string,
	init: RequestInit & { pin: string },
	ms: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function errorText(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { error?: unknown };
		if (typeof body.error === "string") return body.error;
	} catch {
		/* not JSON */
	}
	return `The Mac answered with status ${res.status}.`;
}

const isPinMismatch = (err: unknown) =>
	err instanceof PinMismatchError ||
	(err as { name?: unknown } | null)?.name === "PinMismatchError";

/**
 * Try each address in order. The first address that answers (and passes the
 * pin) decides: a refusal there is final (the code is one-use). An
 * unreachable address, or one with another certificate, moves on.
 */
export async function pair(
	payload: PairingPayload,
	deviceName: string,
	fetchImpl: PinnedFetch,
	timeoutMs = 4000,
): Promise<Connection> {
	if (!isValidPin(payload.pin))
		throw new PairingError(
			"The pairing code has no valid certificate pin. Show a new QR code on the Mac.",
		);
	let mismatch = false;
	for (const candidate of payload.urls) {
		const url = gatewayOrigin(candidate);
		if (!url) continue;
		let res: Response;
		try {
			res = await fetchWithTimeout(
				fetchImpl,
				`${url}/phone/v1/pair`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: payload.code, deviceName }),
					pin: payload.pin,
				},
				timeoutMs,
			);
		} catch (err) {
			if (isPinMismatch(err)) mismatch = true;
			continue;
		}
		if (!res.ok) throw new PairingError(await errorText(res));
		const body = (await res.json()) as {
			token?: unknown;
			deviceId?: unknown;
			protocol?: unknown;
			server?: { name?: unknown };
		};
		if (typeof body.token !== "string" || typeof body.deviceId !== "string")
			throw new PairingError("The Mac sent an invalid pairing answer.");
		if (body.protocol !== PROTOCOL)
			throw new PairingError("The Mac runs a different phone protocol version.");
		// The address that answered goes first: it is the one that works now.
		const urls = [url, ...payload.urls.filter((u) => u !== url)];
		const name = typeof body.server?.name === "string" ? body.server.name : payload.name;
		return {
			name,
			urls,
			pin: payload.pin,
			token: body.token,
			deviceId: body.deviceId,
			pairedAt: new Date().toISOString(),
		};
	}
	if (mismatch)
		throw new PairingError(
			`A device answered at the address of ${payload.name}, but it is not ${payload.name}. Nothing was sent. Check the network, then show a new QR code on the Mac.`,
		);
	throw new PairingError(
		`The phone cannot reach ${payload.name}. Check that the phone and the Mac are on the same Wi-Fi or both on Tailscale.`,
	);
}

export type ReachResult =
	| { kind: "ok"; url: string }
	| { kind: "unpaired" } // the Mac (pin passed) answered and refused this token
	| { kind: "unreachable"; wrongCertificate: boolean }; // wrongCertificate: an address answered with another certificate

/** Find the first address that answers a ping with this token. A 401 counts
 * only from a server that passed the pin (the PinnedFetch guarantees it). */
export async function findReachableUrl(
	connection: Connection,
	fetchImpl: PinnedFetch,
	timeoutMs = 3000,
): Promise<ReachResult> {
	let wrongCertificate = false;
	if (!isValidPin(connection.pin)) return { kind: "unreachable", wrongCertificate };
	for (const candidate of connection.urls) {
		const url = gatewayOrigin(candidate);
		if (!url) continue;
		try {
			const res = await fetchWithTimeout(
				fetchImpl,
				`${url}/phone/v1/ping`,
				{ headers: { authorization: `Bearer ${connection.token}` }, pin: connection.pin },
				timeoutMs,
			);
			if (res.status === 401) return { kind: "unpaired" };
			if (res.ok) return { kind: "ok", url };
		} catch (err) {
			if (isPinMismatch(err)) wrongCertificate = true;
			/* try the next address */
		}
	}
	return { kind: "unreachable", wrongCertificate };
}

/**
 * The fetch that the shared SessionModel and the screens use. Upstream code
 * calls relative paths ("/api/chat"); this adds the Mac address, the token
 * and the pin.
 */
export function remoteFetch(
	baseUrl: string,
	connection: Pick<Connection, "token" | "pin">,
	fetchImpl: PinnedFetch,
): typeof globalThis.fetch {
	const origin = gatewayOrigin(baseUrl);
	if (!origin) throw new Error(`remoteFetch: not an https gateway address: ${baseUrl}`);
	if (!isValidPin(connection.pin)) throw new Error("remoteFetch: the connection has no valid pin");
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const path =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.pathname + input.search
					: input.url;
		if (!path.startsWith("/") || path.startsWith("//"))
			throw new Error(`remoteFetch: expected a relative path, got ${path}`);
		const headers = new Headers(init?.headers);
		headers.set("authorization", `Bearer ${connection.token}`);
		return fetchImpl(`${origin}${path}`, { ...init, headers, pin: connection.pin });
	}) as typeof globalThis.fetch;
}
