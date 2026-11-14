/**
 * Connection state for the paired Mac. Plain TypeScript (no React), so tests
 * drive it with a fake store, a fake fetch and fake timers.
 *
 * Pings: when the app starts, when it returns to the foreground, and every
 * 30 seconds while it is in the foreground. A 401 means the Mac removed this
 * phone: the monitor deletes the stored token and asks for a new pairing.
 * Every request is pinned (PinnedFetch): a 401 can come only from the Mac.
 * A server with another certificate gets nothing and makes the state
 * "unreachable" with `wrongCertificate`; the pairing stays.
 */
import type { ConnectionStore } from "./connection-store";
import {
	findReachableUrl,
	pair,
	parsePairingPayload,
	type Connection,
	type PinnedFetch,
} from "./pairing";

export const PING_INTERVAL_MS = 30_000;

export const REMOVED_MESSAGE = "This phone was removed on the Mac. Pair again.";

export type ConnectionState =
	| { status: "loading" }
	| { status: "unpaired"; message?: string }
	| { status: "checking"; connection: Connection; url?: string }
	| { status: "connected"; connection: Connection; url: string; checkedAt: string }
	| {
			status: "unreachable";
			connection: Connection;
			checkedAt: string;
			wrongCertificate?: boolean;
	  };

export interface ConnectionMonitor {
	state(): ConnectionState;
	subscribe(listener: (state: ConnectionState) => void): () => void;
	/** Read the store and ping. Call once. */
	start(): Promise<void>;
	/** The app went to the background or came back. */
	setForeground(foreground: boolean): void;
	/** Ping now. Resolves after the state is updated. */
	check(): Promise<void>;
	/** Parse pairing text (QR or paste), pair, save. Throws PairingError. */
	pairWith(text: string, deviceName: string): Promise<void>;
	/** Delete the stored connection on this phone. */
	forget(): Promise<void>;
	stop(): void;
}

export function createConnectionMonitor({
	store,
	fetchImpl,
	now = () => new Date(),
	intervalMs = PING_INTERVAL_MS,
}: {
	store: ConnectionStore;
	fetchImpl: PinnedFetch;
	now?: () => Date;
	intervalMs?: number;
}): ConnectionMonitor {
	let current: ConnectionState = { status: "loading" };
	const listeners = new Set<(state: ConnectionState) => void>();
	let timer: ReturnType<typeof setInterval> | null = null;
	let foreground = true;
	let stopped = false;
	let generation = 0; // a newer pair/forget makes older ping results stale
	let inFlight: Promise<void> | null = null;

	function set(next: ConnectionState) {
		current = next;
		for (const listener of listeners) listener(next);
	}

	function connectionOf(state: ConnectionState): Connection | null {
		return "connection" in state ? state.connection : null;
	}

	function schedule() {
		if (timer) clearInterval(timer);
		timer = null;
		if (stopped || !foreground || !connectionOf(current)) return;
		timer = setInterval(() => void check(), intervalMs);
	}

	async function runCheck() {
		const connection = connectionOf(current);
		if (!connection) return;
		const mine = generation;
		// The state stays as it is during a check: no flicker every 30 seconds.
		const result = await findReachableUrl(connection, fetchImpl);
		if (mine !== generation || stopped) return;
		const checkedAt = now().toISOString();
		if (result.kind === "ok") set({ status: "connected", connection, url: result.url, checkedAt });
		else if (result.kind === "unreachable")
			set({
				status: "unreachable",
				connection,
				checkedAt,
				...(result.wrongCertificate ? { wrongCertificate: true } : {}),
			});
		else {
			generation++;
			await store.forget();
			set({ status: "unpaired", message: REMOVED_MESSAGE });
			schedule();
		}
	}

	function check(): Promise<void> {
		// One ping at a time: a second caller waits for the running one.
		inFlight ??= runCheck().finally(() => {
			inFlight = null;
		});
		return inFlight;
	}

	return {
		state: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start() {
			const connection = await store.load();
			if (stopped) return;
			if (!connection) {
				set({ status: "unpaired" });
				return;
			}
			set({ status: "checking", connection });
			schedule();
			await check();
		},
		setForeground(next) {
			if (next === foreground) return;
			foreground = next;
			schedule();
			if (next) void check();
		},
		check,
		async pairWith(text, deviceName) {
			const payload = parsePairingPayload(text);
			const connection = await pair(payload, deviceName, fetchImpl);
			await store.save(connection);
			generation++;
			set({
				status: "connected",
				connection,
				url: connection.urls[0]!,
				checkedAt: now().toISOString(),
			});
			schedule();
		},
		async forget() {
			generation++;
			await store.forget();
			set({ status: "unpaired" });
			schedule();
		},
		stop() {
			stopped = true;
			if (timer) clearInterval(timer);
			timer = null;
			listeners.clear();
		},
	};
}
