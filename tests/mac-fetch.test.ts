/**
 * The Mac fetch: one stable fetch for screens and the shared SessionModel.
 * Each call uses the address that the connection monitor uses now, so a
 * session keeps working when the phone moves from Wi-Fi to Tailscale.
 */
import { createMacFetch } from "@/lib/mac-fetch";
import type { ConnectionState } from "@/lib/connection-monitor";
import type { Connection, PinnedFetch } from "@/lib/pairing";

const PIN = `sha256/${"A".repeat(42)}Q=`;
const connection: Connection = {
	name: "Mac",
	urls: ["https://192.168.1.20:47821", "https://100.64.0.2:47821"],
	pin: PIN,
	token: "tok",
	deviceId: "d1",
	pairedAt: "2026-11-14T10:00:00.000Z",
};

function setup(initial: ConnectionState) {
	let state = initial;
	const calls: { url: string; init: RequestInit & { pin: string } }[] = [];
	const pinned: PinnedFetch = async (url, init) => {
		calls.push({ url, init });
		return new Response("{}");
	};
	const macFetch = createMacFetch({ state: () => state }, pinned);
	return { macFetch, calls, set: (s: ConnectionState) => (state = s) };
}

const connected = (url: string): ConnectionState => ({
	status: "connected",
	connection,
	url,
	checkedAt: "2026-11-14T10:00:00.000Z",
});

it("adds the address in use, the token and the pin", async () => {
	const { macFetch, calls } = setup(connected(connection.urls[1]!));
	await macFetch("/api/chats");
	expect(calls[0]!.url).toBe("https://100.64.0.2:47821/api/chats");
	expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer tok");
	expect(calls[0]!.init.pin).toBe(PIN);
});

it("follows a change of address between calls", async () => {
	const { macFetch, calls, set } = setup(connected(connection.urls[0]!));
	await macFetch("/api/chats");
	set(connected(connection.urls[1]!));
	await macFetch("/api/chats");
	expect(calls.map((c) => new URL(c.url).host)).toEqual(["192.168.1.20:47821", "100.64.0.2:47821"]);
});

it("while the monitor checks or cannot reach the Mac, uses the last address that worked", async () => {
	const { macFetch, calls, set } = setup(connected(connection.urls[1]!));
	await macFetch("/api/chats");
	set({ status: "unreachable", connection, checkedAt: "2026-11-14T10:01:00.000Z" });
	await macFetch("/api/chats/x");
	expect(calls[1]!.url).toBe("https://100.64.0.2:47821/api/chats/x");
});

it("with no address that worked yet, uses the first saved address", async () => {
	const { macFetch, calls } = setup({ status: "checking", connection });
	await macFetch("/api/chats");
	expect(calls[0]!.url).toBe("https://192.168.1.20:47821/api/chats");
});

it("refuses when the phone is not paired, and sends nothing", async () => {
	const { macFetch, calls } = setup({ status: "unpaired" });
	await expect(macFetch("/api/chats")).rejects.toThrow("This phone is not paired with a Mac.");
	expect(calls).toHaveLength(0);
});
