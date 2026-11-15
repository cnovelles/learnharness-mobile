/**
 * The messages that an island page sends to the app (issue 05 slice C). The
 * page scripts are in scripts/island-pages/. A page shows model text, so the
 * app reads each message as untrusted: only the known shapes pass, and a
 * height must be a finite number in range (error state 11).
 */

/** A taller page is wrong: the app ignores the height. */
export const MAX_ISLAND_HEIGHT = 10000;

export type IslandErrorKind = "data" | "load" | "parse";

export type IslandMessage =
	| { type: "height"; height: number }
	| { type: "link"; index: number }
	| { type: "longpress" }
	| { type: "rendered" }
	| { type: "error"; kind: IslandErrorKind };

const ERROR_KINDS: readonly string[] = ["data", "load", "parse"];

/** The message, or null for anything that is not a known message. */
export function parseIslandMessage(raw: unknown): IslandMessage | null {
	if (typeof raw !== "string" || raw.length > 1000) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const message = value as Record<string, unknown>;
	switch (message.type) {
		case "height": {
			const height = message.height;
			if (typeof height !== "number" || !Number.isFinite(height)) return null;
			if (height <= 0 || height > MAX_ISLAND_HEIGHT) return null;
			return { type: "height", height: Math.ceil(height) };
		}
		case "link": {
			const index = message.index;
			if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
			return { type: "link", index };
		}
		case "longpress":
			return { type: "longpress" };
		case "rendered":
			return { type: "rendered" };
		case "error":
			return typeof message.kind === "string" && ERROR_KINDS.includes(message.kind)
				? { type: "error", kind: message.kind as IslandErrorKind }
				: null;
		default:
			return null;
	}
}
