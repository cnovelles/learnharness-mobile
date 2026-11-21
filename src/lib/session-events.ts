/**
 * What an open session does with the Mac's events (the desktop's rules in
 * components/chat.tsx, for the phone):
 * - turn-started for this session, while the phone has no turn of its own
 *   open: attach to it. This shows turns that the Mac starts by itself, for
 *   example the teacher's turn after the probe, or a turn from the desktop.
 * - turn-settled or record-changed for this session, while no turn is
 *   open: read the record, then continue a turn that the record owes.
 * - compaction-changed for this session: tell the screen (onCompaction).
 * - The channel connected again (also when the app comes back to the
 *   foreground): read the record. If a turn runs, attach. If the read
 *   fails, tell the screen (onSyncError), so it can show Try again.
 * While the phone has its own turn open, its own stream settles it.
 */
import type { EventHub } from "./server-events";
import type { SessionModel, SessionRecordSnapshot } from "./shared";

type Model = Pick<
	SessionModel,
	"chatId" | "status" | "resumeStream" | "readRecord" | "continueIfOwed"
>;

export interface SessionEventHooks {
	/** Each record that a sync read (for example, to read `compacting`). */
	onSnapshot?(snapshot: SessionRecordSnapshot): void;
	/** A sync after a reconnect failed. */
	onSyncError?(error: unknown): void;
	/** The Mac started (true) or ended (false) a compaction of this session. */
	onCompaction?(running: boolean): void;
}

const idle = (model: Model) => model.status === "ready" || model.status === "error";

/**
 * Read the record, then attach to a running turn or continue an owed turn.
 * Returns false when the read failed (the error goes to onSyncError).
 */
export async function syncSession(model: Model, hooks: SessionEventHooks = {}): Promise<boolean> {
	let snapshot: SessionRecordSnapshot | undefined;
	try {
		snapshot = await model.readRecord();
	} catch (e) {
		hooks.onSyncError?.(e);
		return false;
	}
	if (!snapshot) return true;
	hooks.onSnapshot?.(snapshot);
	if (!idle(model)) return true;
	if (snapshot.turnInFlight) await model.resumeStream(false);
	else await model.continueIfOwed(snapshot.messages);
	return true;
}

export function attachSessionEvents(
	model: Model,
	hub: EventHub,
	hooks: SessionEventHooks = {},
): () => void {
	const mine = (payload: Record<string, unknown>) => payload.chatId === model.chatId;
	// Only a reconnect reports a failed read. A failed read after an event
	// is quiet: the next event or reconnect reads again.
	const quiet = { onSnapshot: hooks.onSnapshot };

	const stops = [
		hub.subscribe("turn-started", (p) => {
			if (mine(p) && idle(model)) void model.resumeStream();
		}),
		hub.subscribe("turn-settled", (p) => {
			if (mine(p) && idle(model)) void syncSession(model, quiet);
		}),
		hub.subscribe("record-changed", (p) => {
			if (mine(p) && idle(model)) void syncSession(model, quiet);
		}),
		hub.subscribe("compaction-changed", (p) => {
			if (mine(p) && typeof p.running === "boolean") hooks.onCompaction?.(p.running);
		}),
		hub.onResync(() => {
			if (idle(model)) void syncSession(model, hooks);
		}),
	];
	return () => stops.forEach((stop) => stop());
}
