/**
 * The small SQLite seam of the local store (issue 09). The adapters use only
 * this interface, so the same code runs on `expo-sqlite` on the phone
 * (`expo-sql.ts`) and on `node:sqlite` in Jest (`tests/helpers/node-sql.ts`).
 * All calls are synchronous, because the shared storage ports of the fork
 * (`src/core/ports.ts`) are synchronous.
 */

export type SqlValue = string | number | null;

export interface SqlRunResult {
	/** The number of rows that the statement changed. */
	changes: number;
}

/** The driver calls. `transaction` is added by `withTransactions`. */
export interface SqlDriver {
	exec(source: string): void;
	run(source: string, params: readonly SqlValue[]): SqlRunResult;
	all(source: string, params: readonly SqlValue[]): Record<string, unknown>[];
}

export interface SqlDatabase {
	exec(source: string): void;
	run(source: string, ...params: SqlValue[]): SqlRunResult;
	all<T = Record<string, unknown>>(source: string, ...params: SqlValue[]): T[];
	first<T = Record<string, unknown>>(source: string, ...params: SqlValue[]): T | null;
	/**
	 * Runs `task` in one transaction. A nested call uses a savepoint, so an
	 * adapter method can call another one. An error rolls back and is thrown.
	 */
	transaction<T>(task: () => T): T;
}

/** Makes a SqlDatabase from a driver. The transaction rules are the same for both drivers. */
export function withTransactions(driver: SqlDriver): SqlDatabase {
	let depth = 0;
	return {
		exec: (source) => driver.exec(source),
		run: (source, ...params) => driver.run(source, params),
		all: <T>(source: string, ...params: SqlValue[]) => driver.all(source, params) as T[],
		first: <T>(source: string, ...params: SqlValue[]) =>
			(driver.all(source, params)[0] as T | undefined) ?? null,
		transaction<T>(task: () => T): T {
			const savepoint = `sp_${depth}`;
			driver.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
			depth++;
			try {
				const result = task();
				depth--;
				driver.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
				return result;
			} catch (error) {
				depth--;
				if (depth === 0) driver.exec("ROLLBACK");
				else driver.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
				throw error;
			}
		},
	};
}
