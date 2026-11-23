/**
 * The phone driver of the SQL seam: `expo-sqlite` with its sync API.
 * The module is loaded only when the store opens. An old dev build has no
 * ExpoSQLite native module; then `openPhoneDatabase` throws and the caller
 * turns the store off (see `local-store.ts`). An import at the top of this
 * file would crash the whole app on such a build.
 */
import { withTransactions, type SqlDatabase } from "./sql";

type ExpoSqlite = typeof import("expo-sqlite");

export function openPhoneDatabase(name: string): SqlDatabase {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const sqlite = require("expo-sqlite") as ExpoSqlite;
	const db = sqlite.openDatabaseSync(name);
	return withTransactions({
		exec: (source) => db.execSync(source),
		run: (source, params) => ({ changes: db.runSync(source, [...params]).changes }),
		all: (source, params) => db.getAllSync<Record<string, unknown>>(source, [...params]),
	});
}
