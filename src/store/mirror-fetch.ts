/**
 * The one hook of the session mirror (issue 09): it wraps the Mac fetch.
 * After a successful `GET /api/chats` or `GET /api/chats/:id`, the body
 * that the screen reads (with `json()` or `text()`) also goes to the mirror.
 * The body is read once, by the screen; the mirror gets it after that. Any
 * other request, and any failure, passes through unchanged.
 */
import type { SessionMirror } from "./mirror";

const RECORD_PATH = /^\/api\/chats\/([A-Za-z0-9_-]+)$/;

/** The path without a query. The screens and SessionModel send relative path strings. */
function pathOf(input: RequestInfo | URL): string {
	const raw = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
	return raw.split("?")[0]!;
}

/** Gives the parsed body to `deliver` once, after the caller reads it. */
function tap(res: Response, deliver: (body: unknown) => void): Response {
	const readText = res.text.bind(res);
	let done = false;
	const once = (body: unknown) => {
		if (done) return;
		done = true;
		deliver(body);
	};
	try {
		Object.defineProperty(res, "text", {
			configurable: true,
			value: async () => {
				const text = await readText();
				try {
					once(JSON.parse(text));
				} catch {
					/* not JSON: the mirror skips it */
				}
				return text;
			},
		});
		Object.defineProperty(res, "json", {
			configurable: true,
			value: async () => {
				const body: unknown = JSON.parse(await readText());
				once(body);
				return body;
			},
		});
	} catch {
		/* a response that cannot take the hook: no mirror for it */
	}
	return res;
}

export function mirroringFetch(fetchImpl: typeof fetch, mirror: SessionMirror): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const res = await fetchImpl(input, init);
		const method = (init?.method ?? "GET").toUpperCase();
		if (!res.ok || method !== "GET") return res;
		const path = pathOf(input);
		if (path === "/api/chats") return tap(res, (body) => mirror.list(body));
		const match = RECORD_PATH.exec(path);
		if (match) return tap(res, (body) => mirror.record(match[1]!, body));
		return res;
	}) as typeof fetch;
}
