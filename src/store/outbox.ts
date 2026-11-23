/**
 * The outbox (issue 09): the changes made on the phone that the Mac does
 * not have yet. Issue 10 sends them and merges them.
 *
 * Rules:
 * - The adapters add a row in the same transaction as the change, so a
 *   crash never keeps a change without its row.
 * - One row for each entity (a session, a job, a ledger line, …). A second
 *   change of the same entity does not add a row: it adds 1 to `revision`.
 * - `confirm` removes the row only when its revision is still the one that
 *   was sent. A change made during a send keeps the row, so it is sent again.
 * - Mirror writes (copies of the Mac's data) never add rows.
 */
import type { SqlDatabase } from "./sql";

export type OutboxEntity =
	| "chat"
	| "job"
	| "settings"
	| "graph-node"
	| "graph-chain"
	| "graph-checkpoint"
	| "graph-coverage"
	| "graph-ledger"
	| "graph-source"
	| "graph-positions";

/** `put`: send the current entity. `delete`: send a tombstone. `rewrite`: replace a whole ledger. */
export type OutboxOp = "put" | "delete" | "rewrite";

export interface OutboxEntry {
	seq: number;
	entity: OutboxEntity;
	entityId: string;
	op: OutboxOp;
	revision: number;
	createdAt: string;
	attempts: number;
}

export interface Outbox {
	/** The waiting changes, oldest first. */
	pending(limit?: number): OutboxEntry[];
	/** The number of waiting changes (the "waiting count" of issue 10). */
	count(): number;
	/** The Mac has the change at `revision`. True when the row was removed. */
	confirm(entity: OutboxEntity, entityId: string, revision: number): boolean;
	/** A send of this row failed; it stays in the outbox. */
	markAttempt(seq: number): void;
	/** Whether this entity has a waiting change. */
	has(entity: OutboxEntity, entityId: string): boolean;
}

/** The write side, for the adapters. */
export interface OutboxWriter {
	add(entity: OutboxEntity, entityId: string, op: OutboxOp): void;
	/** Removes the waiting rows of one entity type (a whole-ledger rewrite replaces them). */
	drop(entity: OutboxEntity): void;
	/** Records a delete made on the phone, and adds its `delete` row. */
	tombstone(entity: OutboxEntity, entityId: string): void;
}

interface Row {
	seq: number;
	entity: OutboxEntity;
	entity_id: string;
	op: OutboxOp;
	revision: number;
	created_at: string;
	attempts: number;
}

export function createOutbox(
	db: SqlDatabase,
	now: () => string = () => new Date().toISOString(),
): Outbox & OutboxWriter {
	return {
		add(entity, entityId, op) {
			db.run(
				`INSERT INTO outbox (entity, entity_id, op, revision, created_at, attempts)
				 VALUES (?, ?, ?, 1, ?, 0)
				 ON CONFLICT (entity, entity_id) DO UPDATE SET
				   op = excluded.op, revision = outbox.revision + 1, attempts = 0`,
				entity,
				entityId,
				op,
				now(),
			);
		},
		drop(entity) {
			db.run("DELETE FROM outbox WHERE entity = ?", entity);
		},
		tombstone(entity, entityId) {
			db.run(
				"INSERT OR REPLACE INTO tombstones (entity, entity_id, deleted_at) VALUES (?, ?, ?)",
				entity,
				entityId,
				now(),
			);
			this.add(entity, entityId, "delete");
		},
		pending(limit = 1000) {
			return db.all<Row>("SELECT * FROM outbox ORDER BY seq LIMIT ?", limit).map((row) => ({
				seq: Number(row.seq),
				entity: row.entity,
				entityId: row.entity_id,
				op: row.op,
				revision: Number(row.revision),
				createdAt: row.created_at,
				attempts: Number(row.attempts),
			}));
		},
		count() {
			return Number(db.first<{ n: number }>("SELECT COUNT(*) AS n FROM outbox")?.n ?? 0);
		},
		confirm(entity, entityId, revision) {
			return (
				db.run(
					"DELETE FROM outbox WHERE entity = ? AND entity_id = ? AND revision = ?",
					entity,
					entityId,
					revision,
				).changes > 0
			);
		},
		markAttempt(seq) {
			db.run("UPDATE outbox SET attempts = attempts + 1 WHERE seq = ?", seq);
		},
		has(entity, entityId) {
			return (
				db.first(
					"SELECT 1 AS x FROM outbox WHERE entity = ? AND entity_id = ?",
					entity,
					entityId,
				) !== null
			);
		},
	};
}

/** A writer that records nothing: the mirror and the golden import use it. */
export const NO_OUTBOX: OutboxWriter = { add() {}, drop() {}, tombstone() {} };
