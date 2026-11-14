/**
 * What an open session does with the Mac's events (the desktop's rules in
 * components/chat.tsx, for the phone):
 * - turn-started for this session, while the phone has no turn of its own
 *   open: attach to it. This shows turns that the Mac starts by itself, for
 *   example the teacher's turn after the probe, or a turn from the desktop.
 * - turn-settled or record-changed for this session, while no turn is
 *   open: read the record, then continue a turn that the record owes.
 * - The channel connected again: read the record. If a turn runs, attach.
 * While the phone has its own turn open, its own stream settles it.
 */
import type { EventHub } from "./server-events";
import type { SessionModel } from "./shared";

type Model = Pick<
	SessionModel,
	"chatId" | "status" | "resumeStream" | "readRecord" | "continueIfOwed"
>;

const idle = (model: Model) => model.status === "ready" || model.status === "error";

export function attachSessionEvents(model: Model, hub: EventHub): () => void {
	const mine = (payload: Record<string, unknown>) => payload.chatId === model.chatId;

	async function sync() {
		const snapshot = await model.readRecord().catch(() => undefined);
		if (!snapshot || !idle(model)) return;
		if (snapshot.turnInFlight) await model.resumeStream(false);
		else await model.continueIfOwed(snapshot.messages);
	}

	const stops = [
		hub.subscribe("turn-started", (p) => {
			if (mine(p) && idle(model)) void model.resumeStream();
		}),
		hub.subscribe("turn-settled", (p) => {
			if (mine(p) && idle(model)) void sync();
		}),
		hub.subscribe("record-changed", (p) => {
			if (mine(p) && idle(model)) void sync();
		}),
		hub.onResync(() => {
			if (idle(model)) void sync();
		}),
	];
	return () => stops.forEach((stop) => stop());
}
