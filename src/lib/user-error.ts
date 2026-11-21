/**
 * Error text for the screen. Rule (AGENTS.md): the phone never shows raw
 * server or exception text. Every error on screen is a UserMessage, and
 * describeError is the only function that makes one from an error.
 *
 * - userMessage(): text that phone code writes for the user (a literal).
 * - UserFacingError: an error that phone code throws with such text.
 * - describeError(): maps every other error. It reads the Mac's refusal
 *   envelopes, HTTP statuses and network failures. It logs anything that
 *   it does not know and shows a plain fallback.
 */
import {
	AUTH_PROVIDER_KEYS,
	CLAUDE_CODE_PROVIDER,
	MODELS_NOT_CONFIGURED_CODE,
	PROVIDER_KEY_MISSING_CODE,
} from "./shared";

declare const userMessageBrand: unique symbol;
/** Text written for the user. Only userMessage() and describeError() make one. */
export type UserMessage = string & { readonly [userMessageBrand]: true };

/** Marks text that phone code wrote for the user. Lint allows only literal or template text here. */
export function userMessage(text: string): UserMessage {
	return text as UserMessage;
}

/** An error that phone code throws with text written for the user. */
export class UserFacingError extends Error {
	readonly userMessage: UserMessage;
	constructor(text: UserMessage) {
		super(text);
		this.name = "UserFacingError";
		this.userMessage = text;
	}
}

const FALLBACK = userMessage("Something went wrong. Try again.");
const NOT_PAIRED = userMessage("This phone is not paired with the Mac anymore. Pair again.");
const DESKTOP_ONLY = userMessage(
	"The phone cannot do this yet. Use LearnHarness on the Mac for it.",
);
const MAC_NOT_READY = userMessage(
	"LearnHarness on the Mac is not ready. Wait a moment, and then try again.",
);
const NETWORK = userMessage(
	"The phone lost the connection to the Mac. Check that the Mac is on and that LearnHarness is open, and then try again.",
);
const STREAM_DROPPED = userMessage(
	"The connection to the Mac dropped before the turn ended. Try again.",
);

const BY_STATUS: Record<number, UserMessage> = {
	401: NOT_PAIRED,
	403: DESKTOP_ONLY,
	404: userMessage("The Mac does not have this anymore. Go back and refresh the list."),
	409: userMessage("The teacher is still busy with a turn. Wait a moment, and then try again."),
	413: userMessage("This is too long to send. Make it shorter, and then try again."),
	502: MAC_NOT_READY,
};

/**
 * The phone gateway's own refusal texts (fork electron/phone-access.cjs).
 * SessionModel keeps only the body text of a failed request, not its
 * status, so the phone matches these exact texts.
 */
const GATEWAY_BODIES: Record<string, UserMessage> = {
	"This phone is not paired, or its pairing was removed.": NOT_PAIRED,
	"This action is available only on the desktop.": DESKTOP_ONLY,
	"The LearnHarness server is not reachable.": MAC_NOT_READY,
};

/** Practice refusals (issue 06). The session screen offers a sync for them. */
export const PROBLEM_NOT_ACTIVE = userMessage(
	"This problem is not active anymore. Read the session again to see where it stands.",
);
export const PROBLEM_STILL_ACTIVE = userMessage(
	"A problem is still active. Read the session again to see it.",
);
export const PLUGIN_PROBLEM = userMessage(
	"This problem uses a plugin. Work on it in LearnHarness on the Mac.",
);
export const DISMISS_FAILED = userMessage("The phone could not dismiss the problem. Try again.");

/**
 * The Mac's input refusals (fork src/core/input-events.ts). The Mac answers
 * 400 with `{ error }`, and SessionModel keeps the body text.
 */
const MAC_INPUT_ERRORS: Record<string, UserMessage> = {
	"thinking input targets no active problem": PROBLEM_NOT_ACTIVE,
	"dismiss-problem input targets no active problem": PROBLEM_NOT_ACTIVE,
	"next input requires no active problem": PROBLEM_STILL_ACTIVE,
	"This problem requires its registered submission editor": PLUGIN_PROBLEM,
};

export const SYNC_FAILED = userMessage(
	"The phone could not read this session from the Mac. Try again.",
);

/** SessionModel's own error texts (fork session-core.ts). */
const SESSION_MODEL_TEXTS: Record<string, UserMessage> = {
	"The connection dropped before the turn completed.": STREAM_DROPPED,
	"Could not sync the saved session.": SYNC_FAILED,
};

/** SessionModel's error texts with a status: "The steer failed (500)." */
const SESSION_MODEL_PATTERNS: [RegExp, UserMessage][] = [
	[
		/^The steer failed \((\d+)\)\.$/,
		userMessage("The teacher did not get your message. Try again."),
	],
	[/^The dismissal failed \((\d+)\)\.$/, DISMISS_FAILED],
];

function fromPattern(message: string): UserMessage | null {
	for (const [pattern, text] of SESSION_MODEL_PATTERNS) {
		const m = pattern.exec(message);
		if (!m) continue;
		const status = Number(m[1]);
		// Some statuses have a better text (for example, 401: pair again).
		return status === 401 || status === 403 || status === 502 ? BY_STATUS[status]! : text;
	}
	return null;
}

const SLOT_LABELS: Record<string, string> = { strong: "Strong", cheap: "Cheap", vision: "Vision" };

function slotList(slots: string[]): string {
	const names = slots.map((s) => SLOT_LABELS[s] ?? s);
	return names.length <= 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The Mac's machine-readable refusal envelopes (fork src/core/settings.ts). */
function fromEnvelope(body: unknown): UserMessage | null {
	if (typeof body !== "object" || body === null) return null;
	const b = body as { code?: unknown; missing?: unknown; provider?: unknown; error?: unknown };
	if (
		b.code === MODELS_NOT_CONFIGURED_CODE &&
		Array.isArray(b.missing) &&
		b.missing.length > 0 &&
		b.missing.every((s) => typeof s === "string")
	) {
		return userMessage(
			`Your Mac has no ${slotList(b.missing)} model set. In LearnHarness on the Mac, open Settings, select a model, and then send your message again.`,
		);
	}
	if (b.code === PROVIDER_KEY_MISSING_CODE && typeof b.provider === "string") {
		if (b.provider === CLAUDE_CODE_PROVIDER)
			return userMessage(
				"Claude Code is not set up on your Mac. In LearnHarness on the Mac, open Settings → Providers and set it up.",
			);
		const label = AUTH_PROVIDER_KEYS.find((p) => p.id === b.provider)?.label ?? b.provider;
		return userMessage(
			`The ${label} API key is missing on your Mac. In LearnHarness on the Mac, open Settings → Keys and add it.`,
		);
	}
	if (typeof b.error === "string" && GATEWAY_BODIES[b.error]) return GATEWAY_BODIES[b.error];
	if (typeof b.error === "string" && MAC_INPUT_ERRORS[b.error]) return MAC_INPUT_ERRORS[b.error];
	return null;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function defaultLog(raw: unknown) {
	console.warn("[user-error] unmapped error:", raw);
}

/**
 * The text that the screen shows for an error. Accepts any thrown value
 * and SessionModel's `{ message }` error state.
 */
export function describeError(
	error: unknown,
	log: (raw: unknown) => void = defaultLog,
): UserMessage {
	if (typeof error === "object" && error !== null) {
		const e = error as {
			userMessage?: unknown;
			status?: unknown;
			body?: unknown;
			message?: unknown;
		};
		// Errors that phone code threw with text written for the user.
		if (
			error instanceof UserFacingError ||
			(error instanceof Error && typeof e.userMessage === "string")
		)
			return e.userMessage as UserMessage;
		// SessionApiError and other HTTP errors: the body first, then the status.
		if (typeof e.status === "number") {
			const known = fromEnvelope(e.body) ?? BY_STATUS[e.status];
			if (known) return known;
		}
		// fetch rejects with a TypeError when the network fails.
		if (error instanceof TypeError) return NETWORK;
		if (typeof e.message === "string" && e.message) {
			const known =
				SESSION_MODEL_TEXTS[e.message] ??
				GATEWAY_BODIES[e.message] ??
				fromPattern(e.message) ??
				fromEnvelope(parseJson(e.message));
			if (known) return known;
		}
	}
	log(error);
	return FALLBACK;
}
