/**
 * The session mirror for mode 1 and 2 (issue 09): it copies what the Mac
 * sends into the local store, with no outbox rows (the Mac already has it).
 * The screens still read the Mac; issue 10 and the offline mode read the copy.
 *
 * Rules:
 * - A session that was made or changed on the phone (origin `local`, or a
 *   waiting outbox row) is never overwritten or removed by the mirror.
 * - A list from the Mac removes the mirrored sessions that are not in it.
 * - A bad body is skipped. A store error turns the mirror off for this app
 *   run and is logged; the screens never see it.
 * - The writes wait a short time and run one at a time; a newer body for the
 *   same session replaces a waiting one, so a streaming lesson writes rarely.
 */
import type { ChatRecord, ChatSummary } from "@/lib/shared";

import { RECORD_FIELDS } from "./chat-store";
import type { LocalStore } from "./local-store";

export interface SessionMirror {
	/** A `GET /api/chats` body. */
	list(body: unknown): void;
	/** A `GET /api/chats/:id` body. */
	record(id: string, body: unknown): void;
}

const ID = /^[A-Za-z0-9_-]+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

const SUMMARY_LIVE_FIELDS = new Set(["busy", "compacting"]);

/** A list item of the Mac, without its live fields, or null when its shape is bad. */
export function summaryFromMac(item: unknown): ChatSummary | null {
	if (!isRecord(item)) return null;
	const { id, title, createdAt, updatedAt, kind, messageCount, phase } = item;
	if (typeof id !== "string" || !ID.test(id)) return null;
	if (typeof title !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string")
		return null;
	if (kind !== "teach" && kind !== "practice") return null;
	if (typeof messageCount !== "number" || typeof phase !== "string") return null;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(item)) {
		if (!SUMMARY_LIVE_FIELDS.has(key)) out[key] = value;
	}
	return out as unknown as ChatSummary;
}

/** A record answer of the Mac, with only the record fields, or null when its shape is bad. */
export function recordFromMac(id: string, body: unknown): ChatRecord | null {
	if (!ID.test(id) || !isRecord(body)) return null;
	if (body.id !== id || !Array.isArray(body.messages)) return null;
	if (
		typeof body.title !== "string" ||
		typeof body.createdAt !== "string" ||
		typeof body.updatedAt !== "string"
	)
		return null;
	if (!body.messages.every((m) => isRecord(m) && typeof m.id === "string")) return null;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (RECORD_FIELDS.has(key)) out[key] = value;
	}
	return out as unknown as ChatRecord;
}

export interface MirrorDeps {
	/** The store, opened on the first write. Null: the mirror stays off. */
	open: () => LocalStore | null;
	/** Runs a write later. Default: a 1 s timer. */
	schedule?: (task: () => void) => void;
	log?: (message: string, error?: unknown) => void;
}

export function createSessionMirror(deps: MirrorDeps): SessionMirror {
	// console.log, not console.warn: a warning shows a toast in dev builds,
	// and the toast covers buttons in the Maestro flows.
	const log = deps.log ?? ((message, error) => console.log(`[local store] ${message}`, error));
	const schedule = deps.schedule ?? ((task) => void setTimeout(task, 1000));
	let store: LocalStore | null | undefined;
	let off = false;
	const waiting = new Map<string, () => void>();
	let queued = false;

	function storeOrNull(): LocalStore | null {
		if (store === undefined) {
			store = deps.open();
			if (!store) off = true;
		}
		return store;
	}

	function enqueue(key: string, write: (s: LocalStore) => void): void {
		if (off) return;
		waiting.set(key, () => {
			const s = storeOrNull();
			if (!s) return;
			try {
				write(s);
			} catch (error) {
				off = true;
				log("mirror write failed; the mirror is off until the app starts again", error);
			}
		});
		if (queued) return;
		queued = true;
		schedule(() => {
			queued = false;
			const tasks = [...waiting.values()];
			waiting.clear();
			for (const task of tasks) if (!off) task();
		});
	}

	function isPhoneOwned(s: LocalStore, id: string): boolean {
		return s.chats.originOf(id) === "local" || s.outbox.has("chat", id);
	}

	return {
		list(body) {
			const items = isRecord(body) ? body.chats : undefined;
			if (!Array.isArray(items)) return;
			const summaries = items.map(summaryFromMac).filter((s): s is ChatSummary => s !== null);
			enqueue("list", (s) => {
				s.db.transaction(() => {
					const seen = new Set<string>();
					for (const summary of summaries) {
						seen.add(summary.id);
						if (!isPhoneOwned(s, summary.id)) s.chats.importSummary(summary, "mirror");
					}
					for (const { id } of s.chats.listChats()) {
						if (!seen.has(id) && !isPhoneOwned(s, id)) s.chats.forgetChat(id);
					}
				});
			});
		},
		record(id, body) {
			const record = recordFromMac(id, body);
			if (!record) return;
			enqueue(`record:${id}`, (s) => {
				if (isPhoneOwned(s, id)) return;
				s.chats.importChat(record, "mirror");
			});
		},
	};
}
