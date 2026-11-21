/**
 * src/lib/connection-monitor.ts: start, ping timing (open, foreground,
 * every 30 s), 401 → forget + "pair again", pairing and forgetting.
 */
import type { ConnectionStore } from "@/lib/connection-store";
import {
	createConnectionMonitor,
	PING_INTERVAL_MS,
	REMOVED_MESSAGE,
	type ConnectionState,
} from "@/lib/connection-monitor";
import { PinMismatchError, type Connection } from "@/lib/pairing";

const PIN = `sha256/${"A".repeat(42)}Q=`;
const CONNECTION: Connection = {
	name: "Studio Mac",
	urls: ["https://100.64.0.5:47821", "https://192.168.1.20:47821"],
	pin: PIN,
	token: "t".repeat(43),
	deviceId: "dev_1",
	pairedAt: "2026-11-14T00:00:00.000Z",
};

function memoryStore(initial: Connection | null = null) {
	let value = initial;
	const store: ConnectionStore & { value: () => Connection | null } = {
		load: async () => value,
		save: async (c) => void (value = c),
		forget: async () => void (value = null),
		value: () => value,
	};
	return store;
}

/** The Mac: answers pings by status; counts them. "impostor": another certificate at its addresses. */
function mac(initial: number | "down" | "impostor" = 200) {
	let status: number | "down" | "impostor" = initial;
	const pings: string[] = [];
	const fetchImpl = async (url: string, init: RequestInit & { pin: string }) => {
		if (status === "impostor" || init.pin !== PIN) throw new PinMismatchError();
		if (url.endsWith("/phone/v1/ping")) {
			pings.push(url);
			if (status === "down") throw new TypeError("Network request failed");
			return new Response(JSON.stringify({ ok: status === 200 }), { status });
		}
		if (url.endsWith("/phone/v1/pair")) {
			const body = JSON.parse(String(init.body));
			if (body.code !== "c".repeat(24))
				return new Response(
					JSON.stringify({ error: "The pairing code is not valid or has expired." }),
					{ status: 401 },
				);
			return new Response(
				JSON.stringify({
					token: "n".repeat(43),
					deviceId: "dev_new",
					protocol: 2,
					server: { name: "Studio Mac" },
				}),
				{ status: 200 },
			);
		}
		throw new Error(`unexpected ${url}`);
	};
	return { fetchImpl, pings, set: (s: number | "down" | "impostor") => (status = s) };
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("starts unpaired when nothing is stored, and does not ping", async () => {
	const m = mac();
	const monitor = createConnectionMonitor({ store: memoryStore(), fetchImpl: m.fetchImpl });
	expect(monitor.state()).toEqual({ status: "loading" });
	await monitor.start();
	expect(monitor.state()).toEqual({ status: "unpaired" });
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS * 3);
	expect(m.pings).toHaveLength(0);
	monitor.stop();
});

it("pings on start and reports connected with the address in use", async () => {
	const m = mac();
	const monitor = createConnectionMonitor({
		store: memoryStore(CONNECTION),
		fetchImpl: m.fetchImpl,
	});
	const seen: ConnectionState["status"][] = [];
	monitor.subscribe((s) => seen.push(s.status));
	await monitor.start();
	expect(seen).toEqual(["checking", "connected"]);
	expect(monitor.state()).toMatchObject({ status: "connected", url: CONNECTION.urls[0] });
	monitor.stop();
});

it("pings every 30 seconds in the foreground, not in the background, and at once on return", async () => {
	const m = mac();
	const monitor = createConnectionMonitor({
		store: memoryStore(CONNECTION),
		fetchImpl: m.fetchImpl,
	});
	await monitor.start();
	expect(m.pings).toHaveLength(1);
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
	expect(m.pings).toHaveLength(2);
	monitor.setForeground(false);
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS * 4);
	expect(m.pings).toHaveLength(2);
	monitor.setForeground(true);
	await flush();
	expect(m.pings).toHaveLength(3);
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
	expect(m.pings).toHaveLength(4);
	monitor.stop();
});

it("reports unreachable, then connected again when the Mac comes back", async () => {
	const m = mac("down");
	const monitor = createConnectionMonitor({
		store: memoryStore(CONNECTION),
		fetchImpl: m.fetchImpl,
	});
	await monitor.start();
	expect(monitor.state().status).toBe("unreachable");
	m.set(200);
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
	expect(monitor.state().status).toBe("connected");
	monitor.stop();
});

it("a 401 deletes the stored token, asks to pair again and stops pinging", async () => {
	const m = mac();
	const store = memoryStore(CONNECTION);
	const monitor = createConnectionMonitor({ store, fetchImpl: m.fetchImpl });
	await monitor.start();
	m.set(401);
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
	expect(monitor.state()).toEqual({ status: "unpaired", message: REMOVED_MESSAGE });
	expect(store.value()).toBeNull();
	const count = m.pings.length;
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS * 3);
	expect(m.pings).toHaveLength(count);
	monitor.stop();
});

it("two checks at the same time send one ping", async () => {
	const m = mac();
	const monitor = createConnectionMonitor({
		store: memoryStore(CONNECTION),
		fetchImpl: m.fetchImpl,
	});
	await monitor.start();
	await Promise.all([monitor.check(), monitor.check()]);
	expect(m.pings).toHaveLength(2);
	monitor.stop();
});

it("pairs from pairing text, saves the connection and starts pinging", async () => {
	const m = mac();
	const store = memoryStore();
	const monitor = createConnectionMonitor({ store, fetchImpl: m.fetchImpl });
	await monitor.start();
	await monitor.pairWith(
		JSON.stringify({
			lh: 2,
			name: "Studio Mac",
			urls: ["https://192.168.1.20:47821"],
			pin: PIN,
			code: "c".repeat(24),
		}),
		"Sim iPhone",
	);
	expect(monitor.state()).toMatchObject({ status: "connected", url: "https://192.168.1.20:47821" });
	expect(store.value()).toMatchObject({ token: "n".repeat(43), deviceId: "dev_new" });
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
	expect(m.pings).toHaveLength(1);
	monitor.stop();
});

it("a refused pairing keeps the unpaired state and stores nothing", async () => {
	const m = mac();
	const store = memoryStore();
	const monitor = createConnectionMonitor({ store, fetchImpl: m.fetchImpl });
	await monitor.start();
	await expect(
		monitor.pairWith(
			JSON.stringify({
				lh: 2,
				name: "Mac",
				urls: ["https://192.168.1.20:47821"],
				pin: PIN,
				code: "x".repeat(24),
			}),
			"iPhone",
		),
	).rejects.toThrow("not valid");
	expect(monitor.state().status).toBe("unpaired");
	expect(store.value()).toBeNull();
	monitor.stop();
});

it("forget deletes the connection and stops pinging", async () => {
	const m = mac();
	const store = memoryStore(CONNECTION);
	const monitor = createConnectionMonitor({ store, fetchImpl: m.fetchImpl });
	await monitor.start();
	await monitor.forget();
	expect(monitor.state()).toEqual({ status: "unpaired" });
	expect(store.value()).toBeNull();
	await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2);
	expect(m.pings).toHaveLength(1);
	monitor.stop();
});

it("another certificate at the Mac's addresses keeps the pairing and reports wrongCertificate", async () => {
	const m = mac("impostor");
	const store = memoryStore(CONNECTION);
	const monitor = createConnectionMonitor({ store, fetchImpl: m.fetchImpl });
	await monitor.start();
	expect(monitor.state()).toMatchObject({ status: "unreachable", wrongCertificate: true });
	expect(await store.load()).toEqual(CONNECTION);
	expect(m.pings).toEqual([]);
	m.set(200);
	await monitor.check();
	expect(monitor.state().status).toBe("connected");
	expect("wrongCertificate" in monitor.state()).toBe(false);
	monitor.stop();
});

it("a ping that ends after forget does not bring the connection back", async () => {
	let release!: () => void;
	const slow = async () => {
		await new Promise<void>((r) => (release = r));
		return new Response("{}", { status: 200 });
	};
	const monitor = createConnectionMonitor({ store: memoryStore(CONNECTION), fetchImpl: slow });
	const started = monitor.start();
	await flush();
	await monitor.forget();
	release();
	await started;
	expect(monitor.state()).toEqual({ status: "unpaired" });
	monitor.stop();
});
