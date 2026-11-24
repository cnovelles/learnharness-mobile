/**
 * The phone driver of the SQL seam: `expo-sqlite` with its sync API.
 *
 * An old dev build has no ExpoSQLite native module. Then `expo-sqlite`
 * throws while it loads. In the app, Metro sends an error that a lazy
 * `require` throws to `ErrorUtils.reportFatalError` (a red screen in a dev
 * build, a stop in a Release build), so a `try` around the `require` does
 * not catch it. Thus this file checks for the native module first and
 * throws a normal error; the caller turns the store off (see
 * `local-store.ts`). An import of `expo-sqlite` at the top of this file
 * would crash the whole app on such a build.
 */
import { requireOptionalNativeModule } from "expo";

import { withTransactions, type SqlDatabase } from "./sql";

type ExpoSqlite = typeof import("expo-sqlite");

export function openPhoneDatabase(name: string): SqlDatabase {
	if (!requireOptionalNativeModule("ExpoSQLite"))
		throw new Error("This app build has no ExpoSQLite native module.");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const sqlite = require("expo-sqlite") as ExpoSqlite;
	const db = sqlite.openDatabaseSync(name);
	return withTransactions({
		exec: (source) => db.execSync(source),
		run: (source, params) => ({ changes: db.runSync(source, [...params]).changes }),
		all: (source, params) => db.getAllSync<Record<string, unknown>>(source, [...params]),
	});
}
