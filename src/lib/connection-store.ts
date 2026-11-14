/**
 * The paired Mac, kept in the iOS Keychain (expo-secure-store). The device
 * token is a secret, so the whole connection record lives there and nowhere
 * else. "This device only": the token does not go into backups or to
 * another phone.
 */
import * as SecureStore from "expo-secure-store";
import type { Connection } from "./pairing";

const KEY = "lh.connection.v1";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export interface ConnectionStore {
	load(): Promise<Connection | null>;
	save(connection: Connection): Promise<void>;
	forget(): Promise<void>;
}

function isConnection(value: unknown): value is Connection {
	const c = value as Partial<Connection> | null;
	return (
		!!c &&
		typeof c.name === "string" &&
		typeof c.token === "string" &&
		c.token.length > 0 &&
		typeof c.deviceId === "string" &&
		typeof c.pairedAt === "string" &&
		Array.isArray(c.urls) &&
		c.urls.length > 0 &&
		c.urls.every((u) => typeof u === "string")
	);
}

export const secureConnectionStore: ConnectionStore = {
	async load() {
		const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
		if (raw === null) return null;
		try {
			const parsed: unknown = JSON.parse(raw);
			if (isConnection(parsed)) return parsed;
		} catch {
			/* damaged record: remove it below */
		}
		// A damaged record can never connect. Remove it, so the phone asks to pair again.
		await SecureStore.deleteItemAsync(KEY, OPTIONS);
		return null;
	},
	async save(connection) {
		if (!isConnection(connection)) throw new Error("connection store: refusing an incomplete connection");
		await SecureStore.setItemAsync(KEY, JSON.stringify(connection), OPTIONS);
	},
	async forget() {
		await SecureStore.deleteItemAsync(KEY, OPTIONS);
	},
};
