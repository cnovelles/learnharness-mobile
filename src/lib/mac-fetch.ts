/**
 * The Mac fetch: a stable fetch for the screens and the shared SessionModel
 * (mode 1). Each call reads the connection monitor and sends to the address
 * in use (remoteFetch adds the token and the pin). While the monitor checks
 * or cannot reach the Mac, it uses the last address that worked, so a
 * running stream is not cut because of one failed ping.
 */
import { mirroringFetch } from "@/store/mirror-fetch";
import type { SessionMirror } from "@/store/mirror";

import type { ConnectionMonitor } from "./connection-monitor";
import { remoteFetch, type PinnedFetch } from "./pairing";
import { userMessage } from "./user-error";

/** No paired Mac. A TypeError, as fetch rejects with one, with text for the screen. */
export class NotPairedError extends TypeError {
	readonly userMessage = userMessage("This phone is not paired with a Mac. Pair it first.");
	constructor() {
		super("This phone is not paired with a Mac.");
		this.name = "NotPairedError";
	}
}

/**
 * `mirror` (issue 09): the session mirror gets the session list and record
 * bodies that the screens read. Null: no mirror.
 */
export function createMacFetch(
	monitor: Pick<ConnectionMonitor, "state">,
	pinned: PinnedFetch,
	mirror: SessionMirror | null = null,
): typeof globalThis.fetch {
	let last: { token: string; url: string } | null = null;
	const macFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const state = monitor.state();
		if (!("connection" in state)) return Promise.reject(new NotPairedError());
		const { connection } = state;
		if (state.status === "connected") last = { token: connection.token, url: state.url };
		const url = last?.token === connection.token ? last.url : connection.urls[0]!;
		return remoteFetch(url, connection, pinned)(input, init);
	}) as typeof globalThis.fetch;
	return mirror ? mirroringFetch(macFetch, mirror) : macFetch;
}
