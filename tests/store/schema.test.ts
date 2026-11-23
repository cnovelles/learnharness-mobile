/**
 * Issue 09: the schema, WAL, and the open errors of the phone store.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openPhoneStore } from "@/store/local-store";
import { NewerSchemaError, SCHEMA_VERSION, migrate } from "@/store/schema";

import { makeTestStore } from "../helpers/local-store";
import { openNodeDatabase } from "../helpers/node-sql";

describe("local store schema", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-store-"));
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("uses WAL and keeps the data after a new open", () => {
		const file = path.join(dir, "store.db");
		const first = makeTestStore(file);
		expect(first.db.first("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
		const { id } = first.chats.createChat("Kept");
		first.close();
		const second = makeTestStore(file);
		expect(second.chats.getChat(id)!.title).toBe("Kept");
		expect(second.db.first("PRAGMA user_version")).toEqual({ user_version: SCHEMA_VERSION });
		second.close();
	});

	it("refuses a database from a newer build", () => {
		const db = openNodeDatabase(path.join(dir, "store.db"));
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
		expect(() => migrate(db)).toThrow(NewerSchemaError);
		db.close();
	});

	it("gives no store, and logs the reason, when the native module is missing", () => {
		// Jest has no ExpoSQLite native module, as an old dev build.
		const log = jest.fn();
		expect(openPhoneStore(log)).toBeNull();
		expect(log).toHaveBeenCalledTimes(1);
	});
});
