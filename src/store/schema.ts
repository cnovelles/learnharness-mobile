/**
 * The local store schema (issue 09). `migrate` runs on each open. It uses
 * `PRAGMA user_version`: each entry of MIGRATIONS moves the database one
 * version up, in one transaction. Never change an entry that shipped; add a
 * new one.
 */
import type { SqlDatabase } from "./sql";

const MIGRATIONS: readonly string[] = [
	`
	CREATE TABLE chats (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		kind TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		version INTEGER,
		settings_json TEXT,
		tree_json TEXT,
		turns_json TEXT,
		extractions_json TEXT,
		side_chats_json TEXT,
		-- Record fields that this build does not know, kept as they are.
		extra_json TEXT,
		-- 'local': made on the phone; 'mirror': a copy of the Mac's record.
		origin TEXT NOT NULL
	);
	CREATE TABLE messages (
		chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		seq INTEGER NOT NULL,
		id TEXT NOT NULL,
		role TEXT NOT NULL,
		json TEXT NOT NULL,
		PRIMARY KEY (chat_id, seq),
		UNIQUE (chat_id, id)
	);
	-- The summary index: one session list row for each session, written with
	-- the record. No foreign key: the mirror can list a session before it
	-- has the record.
	CREATE TABLE chat_summaries (
		chat_id TEXT PRIMARY KEY,
		updated_at TEXT NOT NULL,
		json TEXT NOT NULL,
		origin TEXT NOT NULL
	);
	CREATE INDEX chat_summaries_updated ON chat_summaries (updated_at);
	CREATE TABLE image_snapshots (
		chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		snapshot_id TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		PRIMARY KEY (chat_id, snapshot_id)
	);
	CREATE TABLE graph_nodes (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, json TEXT NOT NULL);
	CREATE INDEX graph_nodes_id ON graph_nodes (id);
	CREATE TABLE graph_chains (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
	CREATE TABLE graph_checkpoints (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
	CREATE TABLE graph_coverage (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
	CREATE TABLE graph_sources (id TEXT PRIMARY KEY, json TEXT NOT NULL);
	CREATE TABLE graph_positions (node_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL);
	CREATE TABLE jobs (
		id TEXT PRIMARY KEY,
		chat_id TEXT NOT NULL,
		tool_call_id TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		json TEXT NOT NULL
	);
	CREATE INDEX jobs_chat ON jobs (chat_id, updated_at);
	CREATE TABLE settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
	CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
	-- Changes made on the phone that the Mac does not have yet (issue 10 sends
	-- them). One row for each changed entity. Each new change of the entity
	-- adds 1 to revision.
	CREATE TABLE outbox (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		entity TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		op TEXT NOT NULL,
		revision INTEGER NOT NULL,
		created_at TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		UNIQUE (entity, entity_id)
	);
	CREATE TABLE tombstones (
		entity TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		deleted_at TEXT NOT NULL,
		PRIMARY KEY (entity, entity_id)
	);
	`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** A database that a newer app build wrote. This build must not change it. */
export class NewerSchemaError extends Error {
	constructor(readonly found: number) {
		super(`The local store has schema version ${found}; this build knows ${SCHEMA_VERSION}.`);
		this.name = "NewerSchemaError";
	}
}

export function migrate(db: SqlDatabase): void {
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	const row = db.first<{ user_version: number }>("PRAGMA user_version");
	const current = Number(row?.user_version ?? 0);
	if (current > SCHEMA_VERSION) throw new NewerSchemaError(current);
	for (let version = current; version < SCHEMA_VERSION; version++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[version]!);
			db.exec(`PRAGMA user_version = ${version + 1}`);
		});
	}
}
