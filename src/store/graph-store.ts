/**
 * GraphStore on SQLite (issue 09), with the rules of the desktop's fs
 * adapter (`src/store/graph.ts`):
 * - the ledgers keep append order, and a read skips a line with a bad shape;
 * - a node id can have more than one line (a link-append); readers merge;
 * - `upsertSource` keeps the source's usage log; `appendSourceUsage` is
 *   idempotent per `startedAt`;
 * - `rewriteLedgers` replaces each given ledger in one transaction;
 * - a store stamped with a newer graph format refuses reads (it throws).
 *
 * Each local write adds an outbox row: one for each new ledger line, one
 * for a source, one for the positions, one for a whole-ledger rewrite.
 */
import {
	CURRENT_GRAPH_FORMAT_VERSION,
	type CoverageEntry,
	type GraphChain,
	type GraphNode,
	type GraphStore,
	type NotesSource,
	type Position,
	type SessionCheckpoint,
} from "@/lib/shared";

import type { OutboxEntity, OutboxWriter } from "./outbox";
import type { SqlDatabase } from "./sql";

type Ledger = "graph_nodes" | "graph_chains" | "graph_checkpoints" | "graph_coverage";

const LEDGER_ENTITY: Record<Ledger, OutboxEntity> = {
	graph_nodes: "graph-node",
	graph_chains: "graph-chain",
	graph_checkpoints: "graph-checkpoint",
	graph_coverage: "graph-coverage",
};

const FORMAT_KEY = "graph_format";

/** The graph data was written by a newer build. The same text as the desktop's guard. */
export class NewerGraphFormatError extends Error {
	constructor(found: number) {
		super(
			`Graph data is stamped with format version ${found}, but this build understands only ${CURRENT_GRAPH_FORMAT_VERSION}.`,
		);
		this.name = "NewerGraphFormatError";
	}
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}
const isString = (v: unknown): v is string => typeof v === "string";
const isProvenancePoint = (v: unknown) =>
	isRecord(v) && isString(v.chatId) && isString(v.messageId);

const isGraphNode = (v: unknown): v is GraphNode =>
	isRecord(v) &&
	isString(v.id) &&
	isString(v.name) &&
	isString(v.statement) &&
	Array.isArray(v.aliases) &&
	v.aliases.every(isString) &&
	isString(v.createdAt) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint);

const isGraphChain = (v: unknown): v is GraphChain =>
	isRecord(v) &&
	isString(v.id) &&
	Array.isArray(v.premises) &&
	v.premises.length > 0 &&
	v.premises.every(isString) &&
	isString(v.conclusion) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint) &&
	isString(v.createdAt);

const isCheckpoint = (v: unknown): v is SessionCheckpoint =>
	isRecord(v) && isString(v.chatId) && isString(v.foldedAt);

const isCoverageEntry = (v: unknown): v is CoverageEntry =>
	isRecord(v) &&
	isString(v.chatId) &&
	isString(v.fp) &&
	typeof v.tokens === "number" &&
	isString(v.foldedAt);

const isNotesSource = (v: unknown): v is NotesSource =>
	isRecord(v) && isString(v.id) && isString(v.filePath) && isString(v.importedAt);

/** The id column of a node line. A line with no id gets "" (the read skips it). */
function nodeIdOf(record: unknown): string {
	const id = isRecord(record) ? record.id : undefined;
	return typeof id === "string" ? id : "";
}

function parseLine(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return undefined;
	}
}

export function createGraphStore(db: SqlDatabase, outbox: OutboxWriter): GraphStore {
	function assertFormat(): void {
		const row = db.first<{ value: string }>("SELECT value FROM meta WHERE key = ?", FORMAT_KEY);
		const version = row ? Number(row.value) : null;
		if (version !== null && version > CURRENT_GRAPH_FORMAT_VERSION)
			throw new NewerGraphFormatError(version);
	}

	function stampFormat(): void {
		db.run(
			"INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
			FORMAT_KEY,
			String(CURRENT_GRAPH_FORMAT_VERSION),
		);
	}

	function append(ledger: Ledger, record: unknown): void {
		db.transaction(() => {
			stampFormat();
			const json = JSON.stringify(record);
			const result =
				ledger === "graph_nodes"
					? db.first<{ seq: number }>(
							"INSERT INTO graph_nodes (id, json) VALUES (?, ?) RETURNING seq",
							nodeIdOf(record),
							json,
						)
					: db.first<{ seq: number }>(
							`INSERT INTO ${ledger} (json) VALUES (?) RETURNING seq`,
							json,
						);
			outbox.add(LEDGER_ENTITY[ledger], String(result!.seq), "put");
		});
	}

	function read<T>(ledger: Ledger, isValid: (v: unknown) => v is T): T[] {
		assertFormat();
		return db
			.all<{ json: string }>(`SELECT json FROM ${ledger} ORDER BY seq`)
			.map((row) => parseLine(row.json))
			.filter(isValid);
	}

	function readSourceMap(): Map<string, NotesSource> {
		assertFormat();
		const out = new Map<string, NotesSource>();
		for (const row of db.all<{ id: string; json: string }>(
			"SELECT id, json FROM graph_sources ORDER BY rowid",
		)) {
			const value = parseLine(row.json);
			if (isNotesSource(value)) out.set(row.id, value);
		}
		return out;
	}

	function writeSource(source: NotesSource): void {
		stampFormat();
		db.run(
			"INSERT INTO graph_sources (id, json) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json",
			source.id,
			JSON.stringify(source),
		);
		outbox.add("graph-source", source.id, "put");
	}

	return {
		appendNode: (node) => append("graph_nodes", node),
		readNodes: () => read("graph_nodes", isGraphNode),
		appendChain: (chain) => append("graph_chains", chain),
		readChains: () => read("graph_chains", isGraphChain),
		appendCheckpoint: (checkpoint) => append("graph_checkpoints", checkpoint),
		readCheckpoints: () => read("graph_checkpoints", isCheckpoint),
		appendCoverage: (entry) => append("graph_coverage", entry),
		readCoverage: () => read("graph_coverage", isCoverageEntry),

		upsertSource(source) {
			db.transaction(() => {
				const prev = readSourceMap().get(source.id);
				writeSource(prev ? { ...source, extractions: prev.extractions } : source);
			});
		},
		readSources: () => [...readSourceMap().values()],
		deleteSources(ids) {
			if (ids.size === 0) return 0;
			return db.transaction(() => {
				const all = readSourceMap();
				let removed = 0;
				for (const id of ids) {
					if (!all.has(id)) continue;
					db.run("DELETE FROM graph_sources WHERE id = ?", id);
					outbox.tombstone("graph-source", id);
					removed++;
				}
				return removed;
			});
		},
		appendSourceUsage(id, entry) {
			db.transaction(() => {
				const source = readSourceMap().get(id);
				if (!source) return;
				if (source.extractions?.some((r) => r.startedAt === entry.startedAt)) return;
				writeSource({ ...source, extractions: [...(source.extractions ?? []), entry] });
			});
		},

		readPositions() {
			const out: Record<string, Position> = {};
			for (const row of db.all<{ node_id: string; x: number; y: number }>(
				"SELECT node_id, x, y FROM graph_positions ORDER BY rowid",
			)) {
				const x = Number(row.x);
				const y = Number(row.y);
				if (Number.isFinite(x) && Number.isFinite(y)) out[row.node_id] = { x, y };
			}
			return out;
		},
		writePositions(positions) {
			db.transaction(() => {
				db.run("DELETE FROM graph_positions");
				for (const [id, p] of Object.entries(positions)) {
					db.run("INSERT INTO graph_positions (node_id, x, y) VALUES (?, ?, ?)", id, p.x, p.y);
				}
				outbox.add("graph-positions", "all", "put");
			});
		},

		rewriteLedgers(next) {
			const tables = {
				nodes: "graph_nodes",
				chains: "graph_chains",
				coverage: "graph_coverage",
				checkpoints: "graph_checkpoints",
			} as const;
			db.transaction(() => {
				for (const [key, records] of Object.entries(next) as [keyof typeof tables, unknown[]][]) {
					const table = tables[key];
					db.run(`DELETE FROM ${table}`);
					for (const record of records) {
						const json = JSON.stringify(record);
						if (table === "graph_nodes")
							db.run("INSERT INTO graph_nodes (id, json) VALUES (?, ?)", nodeIdOf(record), json);
						else db.run(`INSERT INTO ${table} (json) VALUES (?)`, json);
					}
					// The rewrite replaces the waiting lines of this ledger.
					outbox.drop(LEDGER_ENTITY[table]);
					outbox.add("graph-ledger", key, "rewrite");
				}
			});
		},
	};
}
