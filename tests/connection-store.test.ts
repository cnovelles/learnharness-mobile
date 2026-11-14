/** src/lib/connection-store.ts against an in-memory expo-secure-store. */
import type { Connection } from "@/lib/pairing";

const mockItems = new Map<string, string>();
const mockOptionsSeen: unknown[] = [];
jest.mock("expo-secure-store", () => ({
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: jest.fn(
		async (key: string, options: unknown) => (
			mockOptionsSeen.push(options),
			mockItems.get(key) ?? null
		),
	),
	setItemAsync: jest.fn(
		async (key: string, value: string, options: unknown) => (
			mockOptionsSeen.push(options),
			void mockItems.set(key, value)
		),
	),
	deleteItemAsync: jest.fn(
		async (key: string, options: unknown) => (
			mockOptionsSeen.push(options),
			void mockItems.delete(key)
		),
	),
}));

// eslint-disable-next-line import/first
import { secureConnectionStore as store } from "@/lib/connection-store";

const CONNECTION: Connection = {
	name: "Studio Mac",
	urls: ["https://100.64.0.5:47821"],
	pin: `sha256/${"A".repeat(42)}Q=`,
	token: "t".repeat(43),
	deviceId: "dev_1",
	pairedAt: "2026-11-14T00:00:00.000Z",
};

beforeEach(() => {
	mockItems.clear();
	mockOptionsSeen.length = 0;
});

it("loads nothing before a pairing", async () => {
	expect(await store.load()).toBeNull();
});

it("saves, loads and forgets the connection", async () => {
	await store.save(CONNECTION);
	expect(await store.load()).toEqual(CONNECTION);
	await store.forget();
	expect(await store.load()).toBeNull();
	expect(mockItems.size).toBe(0);
});

it("keeps the token on this device only", async () => {
	await store.save(CONNECTION);
	await store.load();
	expect(mockOptionsSeen.length).toBeGreaterThan(0);
	for (const options of mockOptionsSeen) expect(options).toEqual({ keychainAccessible: 6 });
});

it("removes a damaged record and reports no connection", async () => {
	mockItems.set("lh.connection.v1", "{not json");
	expect(await store.load()).toBeNull();
	expect(mockItems.has("lh.connection.v1")).toBe(false);
	mockItems.set("lh.connection.v1", JSON.stringify({ ...CONNECTION, token: "" }));
	expect(await store.load()).toBeNull();
	expect(mockItems.size).toBe(0);
});

it("removes a protocol 1 record (plain HTTP, no pin): it can never connect safely", async () => {
	const { pin: _pin, ...withoutPin } = CONNECTION;
	mockItems.set(
		"lh.connection.v1",
		JSON.stringify({ ...withoutPin, urls: ["http://100.64.0.5:47821"] }),
	);
	expect(await store.load()).toBeNull();
	expect(mockItems.size).toBe(0);
	mockItems.set(
		"lh.connection.v1",
		JSON.stringify({ ...CONNECTION, urls: ["http://100.64.0.5:47821"] }),
	);
	expect(await store.load()).toBeNull();
	expect(mockItems.size).toBe(0);
});

it("refuses to save an incomplete connection", async () => {
	await expect(store.save({ ...CONNECTION, urls: [] })).rejects.toThrow("incomplete");
	await expect(store.save({ ...CONNECTION, pin: "" })).rejects.toThrow("incomplete");
	expect(mockItems.size).toBe(0);
});
