/**
 * The Jest driver of the SQL seam (src/store/sql.ts): Node's built-in
 * `node:sqlite`, so the adapter tests run on a real SQLite. A file path
 * gives a real WAL database; ":memory:" is the default.
 */
import { withTransactions, type SqlDatabase } from "@/store/sql";

interface NodeStatement {
	run(...params: unknown[]): { changes: number | bigint };
	all(...params: unknown[]): Record<string, unknown>[];
}
interface NodeDatabase {
	exec(source: string): void;
	prepare(source: string): NodeStatement;
	close(): void;
}

export function openNodeDatabase(file = ":memory:"): SqlDatabase & { close(): void } {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { DatabaseSync } = require("node:sqlite") as {
		DatabaseSync: new (path: string) => NodeDatabase;
	};
	const db = new DatabaseSync(file);
	const sql = withTransactions({
		exec: (source) => db.exec(source),
		run: (source, params) => ({ changes: Number(db.prepare(source).run(...params).changes) }),
		// node:sqlite gives rows with a null prototype; copy them to plain objects.
		all: (source, params) =>
			db
				.prepare(source)
				.all(...params)
				.map((row) => ({ ...row })),
	});
	return { ...sql, close: () => db.close() };
}
