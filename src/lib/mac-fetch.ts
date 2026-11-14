/**
 * The Mac fetch: a stable fetch for the screens and the shared SessionModel
 * (mode 1). Each call reads the connection monitor and sends to the address
 * in use (remoteFetch adds the token and the pin). While the monitor checks
 * or cannot reach the Mac, it uses the last address that worked, so a
 * running stream is not cut because of one failed ping.
 */
import type { ConnectionMonitor } from "./connection-monitor";
import { remoteFetch, type PinnedFetch } from "./pairing";

export function createMacFetch(
	monitor: Pick<ConnectionMonitor, "state">,
	pinned: PinnedFetch,
): typeof globalThis.fetch {
	let last: { token: string; url: string } | null = null;
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const state = monitor.state();
		if (!("connection" in state))
			return Promise.reject(new TypeError("This phone is not paired with a Mac."));
		const { connection } = state;
		if (state.status === "connected") last = { token: connection.token, url: state.url };
		const url = last?.token === connection.token ? last.url : connection.urls[0]!;
		return remoteFetch(url, connection, pinned)(input, init);
	}) as typeof globalThis.fetch;
}
