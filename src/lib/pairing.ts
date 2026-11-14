/**
 * Pairing with the desktop fork's phone gateway (electron/phone-access.cjs).
 * Pure functions with an injectable fetch, so tests run without a phone.
 *
 * QR payload: {"lh":1,"name":"<mac>","urls":["http://100.x.y.z:47821", ...],"code":"<one-use code>"}
 */

export const PROTOCOL = 1;

export interface PairingPayload {
	name: string;
	urls: string[];
	code: string;
}

/** A paired desktop. The token is secret: keep it in the secure store only. */
export interface Connection {
	name: string;
	urls: string[];
	token: string;
	deviceId: string;
	pairedAt: string;
}

export class PairingError extends Error {}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function parsePairingPayload(text: string): PairingPayload {
	let raw: unknown;
	try {
		raw = JSON.parse(text.trim());
	} catch {
		throw new PairingError("This is not a LearnHarness pairing code.");
	}
	const value = raw as { lh?: unknown; name?: unknown; urls?: unknown; code?: unknown };
	if (value?.lh !== PROTOCOL) throw new PairingError("This pairing code is from a different LearnHarness version.");
	if (typeof value.code !== "string" || value.code.length < 16) throw new PairingError("The pairing code is incomplete.");
	const urls = Array.isArray(value.urls) ? value.urls.filter((u): u is string => typeof u === "string" && /^https?:\/\/[^/\s]+$/.test(u)) : [];
	if (urls.length === 0) throw new PairingError("The Mac has no network address. Connect it to Wi-Fi or Tailscale and show a new code.");
	return { name: typeof value.name === "string" && value.name ? value.name : "Mac", urls, code: value.code };
}

/** fetch with a timeout. A timeout means "address not reachable", not an answer. */
async function fetchWithTimeout(fetchImpl: Fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
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

/**
 * Try each address in order. The first address that answers decides: a
 * refusal there is final (the code is one-use), an unreachable address moves
 * on to the next one.
 */
export async function pair(payload: PairingPayload, deviceName: string, fetchImpl: Fetch, timeoutMs = 4000): Promise<Connection> {
	for (const url of payload.urls) {
		let res: Response;
		try {
			res = await fetchWithTimeout(fetchImpl, `${url}/phone/v1/pair`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: payload.code, deviceName }),
			}, timeoutMs);
		} catch {
			continue;
		}
		if (!res.ok) throw new PairingError(await errorText(res));
		const body = (await res.json()) as { token?: unknown; deviceId?: unknown; protocol?: unknown; server?: { name?: unknown } };
		if (typeof body.token !== "string" || typeof body.deviceId !== "string") throw new PairingError("The Mac sent an invalid pairing answer.");
		if (body.protocol !== PROTOCOL) throw new PairingError("The Mac runs a different phone protocol version.");
		// The address that answered goes first: it is the one that works now.
		const urls = [url, ...payload.urls.filter((u) => u !== url)];
		const name = typeof body.server?.name === "string" ? body.server.name : payload.name;
		return { name, urls, token: body.token, deviceId: body.deviceId, pairedAt: new Date().toISOString() };
	}
	throw new PairingError(`The phone cannot reach ${payload.name}. Check that the phone and the Mac are on the same Wi-Fi or both on Tailscale.`);
}

export type ReachResult =
	| { kind: "ok"; url: string }
	| { kind: "unpaired" } // the Mac answered and refused this token
	| { kind: "unreachable" };

/** Find the first address that answers a ping with this token. */
export async function findReachableUrl(connection: Connection, fetchImpl: Fetch, timeoutMs = 3000): Promise<ReachResult> {
	for (const url of connection.urls) {
		try {
			const res = await fetchWithTimeout(fetchImpl, `${url}/phone/v1/ping`, { headers: { authorization: `Bearer ${connection.token}` } }, timeoutMs);
			if (res.status === 401) return { kind: "unpaired" };
			if (res.ok) return { kind: "ok", url };
		} catch {
			/* try the next address */
		}
	}
	return { kind: "unreachable" };
}

/**
 * The fetch that the shared SessionModel and the screens use. Upstream code
 * calls relative paths ("/api/chat"); this adds the Mac address and token.
 */
export function remoteFetch(baseUrl: string, token: string, fetchImpl: Fetch): typeof globalThis.fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
		if (!path.startsWith("/")) throw new Error(`remoteFetch: expected a relative path, got ${path}`);
		const headers = new Headers(init?.headers);
		headers.set("authorization", `Bearer ${token}`);
		return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
	}) as typeof globalThis.fetch;
}
