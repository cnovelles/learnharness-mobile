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
import { UserFacingError, userMessage } from "./user-error";

/**
 * A request to the Mac failed. `message` is raw server text for the log;
 * the screen shows describeError(), which reads `status` and `body`.
 */
export class SessionApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		/** The parsed JSON body of the answer, when it had one. */
		readonly body?: unknown,
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

export async function failure(res: Response): Promise<SessionApiError> {
	let message = `The Mac answered with status ${res.status}.`;
	let body: unknown;
	try {
		body = await res.json();
		const error = (body as { error?: unknown } | null)?.error;
		if (typeof error === "string" && error) message = error;
	} catch {
		/* not JSON */
	}
	return new SessionApiError(message, res.status, body);
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

/** A teaching session or a practice session (fork `kind: "practice"`). */
export type SessionKind = "teach" | "practice";

export async function startSession(
	fetchImpl: typeof fetch,
	text: string,
	prompts: OpeningPrompts = openingPrompts,
	kind: SessionKind = "teach",
): Promise<string> {
	const first = text.trim();
	if (!first)
		throw new UserFacingError(
			kind === "practice"
				? userMessage("Write what you want to practice.")
				: userMessage("Write what you want to learn."),
		);
	const res = await fetchImpl("/api/chats", {
		method: "POST",
		headers: { "content-type": "application/json" },
		// The Mac makes a practice session only for `kind: "practice"`.
		body: JSON.stringify(kind === "practice" ? { title: first, kind } : { title: first }),
	});
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as { id?: unknown };
	if (!isSessionId(body.id))
		throw new UserFacingError(userMessage("The Mac sent an invalid session."));
	prompts.put(body.id, first);
	return body.id;
}

export interface SessionRecord {
	id: string;
	title: string;
	/** A record without a kind is a teaching session (as on the Mac). */
	kind: SessionKind;
	messages: LhMessage[];
	turnInFlight: boolean;
	turnError?: string;
	/** The Mac makes the history shorter now (compaction). */
	compacting: boolean;
}

export async function readSession(fetchImpl: typeof fetch, id: string): Promise<SessionRecord> {
	if (!isSessionId(id)) throw new SessionApiError(`Not a session id: ${id}`);
	const res = await fetchImpl(`/api/chats/${id}`);
	if (res.status === 404)
		throw new UserFacingError(userMessage("This session is not on the Mac any more."));
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as {
		title?: unknown;
		kind?: unknown;
		messages?: unknown;
		turnInFlight?: unknown;
		turnError?: unknown;
		compacting?: unknown;
	};
	return {
		id,
		title: typeof body.title === "string" ? body.title : "",
		kind: body.kind === "practice" ? "practice" : "teach",
		messages: Array.isArray(body.messages) ? (body.messages as LhMessage[]) : [],
		turnInFlight: body.turnInFlight === true,
		compacting: body.compacting === true,
		...(typeof body.turnError === "string" ? { turnError: body.turnError } : {}),
	};
}
