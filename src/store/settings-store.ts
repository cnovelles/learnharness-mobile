/**
 * SettingsStore on SQLite (issue 09): the one user settings record. Each
 * read and write goes through the desktop's `sanitizeUserSettings`, as the
 * fs adapter does. A bad stored record reads as null (first-boot defaults).
 * The desktop's file access guard is not here: the phone has no file tools.
 */
import { sanitizeUserSettings, type SettingsStore } from "@/lib/shared";

import type { OutboxWriter } from "./outbox";
import type { SqlDatabase } from "./sql";

const KEY = "user";

export function createSettingsStore(db: SqlDatabase, outbox: OutboxWriter): SettingsStore {
	return {
		readSettings() {
			const row = db.first<{ json: string }>("SELECT json FROM settings WHERE key = ?", KEY);
			if (!row) return null;
			try {
				return sanitizeUserSettings(JSON.parse(row.json));
			} catch {
				return null;
			}
		},
		writeSettings(raw) {
			const settings = sanitizeUserSettings(raw);
			if (!settings) throw new Error("settings record must be a JSON object");
			db.transaction(() => {
				db.run(
					"INSERT INTO settings (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json",
					KEY,
					JSON.stringify(settings),
				);
				outbox.add("settings", KEY, "put");
			});
		},
	};
}
