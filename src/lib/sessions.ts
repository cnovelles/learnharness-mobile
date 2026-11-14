/**
 * The session API on the Mac (mode 1), through remoteFetch (pinned, with the
 * token). Plain functions with an injected fetch, so tests and the Node
 * integration test use them without a phone.
 *
 * Start of a session, as on the desktop (components/start-session.ts):
 * create the session with the first text as its title, keep that text
 * here, open the session screen, and the screen sends it as the first input.
 */
import type { ChatListItem, LhMessage } from "./shared";

export class SessionApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "SessionApiError";
	}
}

/** Session ids go into URL paths. The Mac makes them from these characters only. */
const ID = /^[A-Za-z0-9_-]+$/;

export function isSessionId(id: unknown): id is string {
	return typeof id === "string" && ID.test(id);
}

async function failure(res: Response): Promise<SessionApiError> {
	let message = `The Mac answered with status ${res.status}.`;
	try {
		const body = (await res.json()) as { error?: unknown };
		if (typeof body.error === "string" && body.error) message = body.error;
	} catch {
		/* not JSON */
	}
	return new SessionApiError(message, res.status);
}

export async function listSessions(fetchImpl: typeof fetch): Promise<ChatListItem[]> {
	const res = await fetchImpl("/api/chats");
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as { chats?: unknown };
	if (!Array.isArray(body.chats)) return [];
	return body.chats.filter(
		(c): c is ChatListItem =>
			typeof c === "object" &&
			c !== null &&
			isSessionId((c as { id?: unknown }).id) &&
			typeof (c as { title?: unknown }).title === "string",
	);
}

/** The first text of new sessions, kept in memory until the session screen sends it. */
export class OpeningPrompts {
	private texts = new Map<string, string>();
	put(id: string, text: string) {
		this.texts.set(id, text);
	}
	/** Returns the text once, then forgets it, so a second screen mount sends nothing. */
	take(id: string): string | undefined {
		const text = this.texts.get(id);
		this.texts.delete(id);
		return text;
	}
}

export const openingPrompts = new OpeningPrompts();

export async function startSession(
	fetchImpl: typeof fetch,
	text: string,
	prompts: OpeningPrompts = openingPrompts,
): Promise<string> {
	const first = text.trim();
	if (!first) throw new SessionApiError("Write what you want to learn.");
	const res = await fetchImpl("/api/chats", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ title: first }),
	});
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as { id?: unknown };
	if (!isSessionId(body.id)) throw new SessionApiError("The Mac sent an invalid session.");
	prompts.put(body.id, first);
	return body.id;
}

export interface SessionRecord {
	id: string;
	title: string;
	messages: LhMessage[];
	turnInFlight: boolean;
	turnError?: string;
}

export async function readSession(fetchImpl: typeof fetch, id: string): Promise<SessionRecord> {
	if (!isSessionId(id)) throw new SessionApiError(`Not a session id: ${id}`);
	const res = await fetchImpl(`/api/chats/${id}`);
	if (res.status === 404)
		throw new SessionApiError("This session is not on the Mac any more.", 404);
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as {
		title?: unknown;
		messages?: unknown;
		turnInFlight?: unknown;
		turnError?: unknown;
	};
	return {
		id,
		title: typeof body.title === "string" ? body.title : "",
		messages: Array.isArray(body.messages) ? (body.messages as LhMessage[]) : [],
		turnInFlight: body.turnInFlight === true,
		...(typeof body.turnError === "string" ? { turnError: body.turnError } : {}),
	};
}
