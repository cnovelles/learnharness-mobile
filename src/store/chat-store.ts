/**
 * ChatStore on SQLite (issue 09). It implements the fork's port
 * (`src/core/ports.ts`) with the same rules as the desktop's fs adapter
 * (`src/store/chats.ts`):
 * - a rename, a settings change and a plan tree change do not change `updatedAt`;
 * - usage appends are idempotent (turn id, extraction `startedAt`);
 * - a record with a newer schema version reads as absent;
 * - an image snapshot id must be the SHA-256 of its bytes.
 *
 * Storage: one row for each message; `saveMessages` rewrites only the rows
 * from the first changed message. The summary index (`chat_summaries`) is
 * written in the same transaction, so `listChats` never reads messages.
 * Each local write adds an outbox row; `importChat` (the mirror and the
 * golden import) does not.
 */
import {
	CURRENT_CHAT_VERSION,
	activeProblemOf,
	danglingQuestionOf,
	phaseAt3Lh,
	problemCountOf,
	type ChatRecord,
	type ChatStore,
	type ChatSummary,
	type ImageSnapshot,
	type LhMessage,
} from "@/lib/shared";

import { imageFileName, sha256OfBase64, type ImageFiles } from "./image-files";
import type { OutboxWriter } from "./outbox";
import type { SqlDatabase } from "./sql";

export type Origin = "local" | "mirror";

/** The record fields that have their own column. Other fields go to `extra_json`. */
export const RECORD_FIELDS: ReadonlySet<string> = new Set([
	"id",
	"title",
	"kind",
	"createdAt",
	"updatedAt",
	"version",
	"messages",
	"imageSnapshots",
	"settings",
	"tree",
	"turns",
	"extractions",
	"sideChats",
]);

const ID = /^[A-Za-z0-9_-]+$/;

export interface ChatStoreDeps {
	db: SqlDatabase;
	files: ImageFiles;
	outbox: OutboxWriter;
	now?: () => string;
	/** 8 random hex characters for a new session id. */
	randomHex?: () => string;
}

export interface LocalChatStore extends ChatStore {
	/**
	 * Writes a whole record as it is (keeps `updatedAt` and `version`), with no
	 * outbox row. For the mirror and the golden import. A record with a newer
	 * schema version is refused (false). A record with no `imageSnapshots`
	 * keeps the stored images.
	 */
	importChat(record: ChatRecord, origin: Origin): boolean;
	/** Writes one session list row as it is, with no record (the mirror's list). */
	importSummary(summary: ChatSummary, origin: Origin): void;
	/** Removes a session with no tombstone and no outbox row (the mirror). */
	forgetChat(id: string): void;
	/** The origin of a session's list row, or null. */
	originOf(id: string): Origin | null;
}

interface ChatRow {
	id: string;
	title: string;
	kind: string | null;
	created_at: string;
	updated_at: string;
	version: number | null;
	settings_json: string | null;
	tree_json: string | null;
	turns_json: string | null;
	extractions_json: string | null;
	side_chats_json: string | null;
	extra_json: string | null;
	origin: Origin;
}

function defaultRandomHex(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseOr<T>(json: string | null): T | undefined {
	return json === null ? undefined : (JSON.parse(json) as T);
}

function jsonOrNull(value: unknown): string | null {
	return value === undefined ? null : JSON.stringify(value);
}

/**
 * The session list row of a record, the same as the desktop's `listChats`:
 * the record without its large parts, plus the folds. Null when a fold
 * throws (the desktop drops such a record from the list).
 */
export function summaryOf(record: ChatRecord): ChatSummary | null {
	const {
		messages,
		tree: _tree,
		turns: _turns,
		extractions: _extractions,
		imageSnapshots: _images,
		sideChats: _sideChats,
		...rest
	} = record;
	try {
		return {
			...rest,
			kind: rest.kind ?? "teach",
			messageCount: messages.length,
			phase: phaseAt3Lh(messages),
			pendingQuestion: danglingQuestionOf(messages) !== null,
			pendingProblem: activeProblemOf(messages) !== null,
			problemCount: problemCountOf(messages),
		};
	} catch {
		return null;
	}
}

export function createChatStore(deps: ChatStoreDeps): LocalChatStore {
	const { db, files, outbox } = deps;
	const now = deps.now ?? (() => new Date().toISOString());
	const randomHex = deps.randomHex ?? defaultRandomHex;

	function checkId(id: string): void {
		if (!ID.test(id)) throw new Error(`Invalid chat id: ${id}`);
	}

	function readRow(id: string): ChatRow | null {
		if (!ID.test(id)) return null;
		return db.first<ChatRow>("SELECT * FROM chats WHERE id = ?", id);
	}

	function readMessages(id: string): LhMessage[] {
		return db
			.all<{ json: string }>("SELECT json FROM messages WHERE chat_id = ? ORDER BY seq", id)
			.map((row) => JSON.parse(row.json) as LhMessage);
	}

	function readImages(id: string): Record<string, ImageSnapshot> | undefined {
		const rows = db.all<{
			snapshot_id: string;
			mime_type: ImageSnapshot["mimeType"];
			width: number;
			height: number;
		}>(
			"SELECT snapshot_id, mime_type, width, height FROM image_snapshots WHERE chat_id = ? ORDER BY rowid",
			id,
		);
		if (rows.length === 0) return undefined;
		const out: Record<string, ImageSnapshot> = {};
		for (const row of rows) {
			// A row whose file is gone reads as absent (error state: missing image file).
			const data = files.read(imageFileName(row.snapshot_id, row.mime_type));
			if (data === null) continue;
			out[row.snapshot_id] = {
				mimeType: row.mime_type,
				data,
				width: Number(row.width),
				height: Number(row.height),
			};
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}

	function recordOf(row: ChatRow): ChatRecord | null {
		if (row.version !== null && Number(row.version) > CURRENT_CHAT_VERSION) return null;
		const record: ChatRecord = {
			...(parseOr<Record<string, unknown>>(row.extra_json) ?? {}),
			id: row.id,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			messages: readMessages(row.id),
		};
		const images = readImages(row.id);
		if (images) record.imageSnapshots = images;
		if (row.kind !== null) record.kind = row.kind as ChatRecord["kind"];
		const settings = parseOr<ChatRecord["settings"]>(row.settings_json);
		if (settings !== undefined) record.settings = settings;
		const tree = parseOr<ChatRecord["tree"]>(row.tree_json);
		if (tree !== undefined) record.tree = tree;
		const turns = parseOr<ChatRecord["turns"]>(row.turns_json);
		if (turns !== undefined) record.turns = turns;
		const extractions = parseOr<ChatRecord["extractions"]>(row.extractions_json);
		if (extractions !== undefined) record.extractions = extractions;
		const sideChats = parseOr<ChatRecord["sideChats"]>(row.side_chats_json);
		if (sideChats !== undefined) record.sideChats = sideChats;
		if (row.version !== null) record.version = Number(row.version);
		return record;
	}

	function getChat(id: string): ChatRecord | null {
		const row = readRow(id);
		return row ? recordOf(row) : null;
	}

	function mustGet(id: string): ChatRecord {
		const record = getChat(id);
		if (!record) throw new Error(`Chat not found: ${id}`);
		return record;
	}

	function writeSummary(record: ChatRecord, origin: Origin): void {
		const summary = summaryOf(record);
		if (!summary) {
			db.run("DELETE FROM chat_summaries WHERE chat_id = ?", record.id);
			return;
		}
		importSummary(summary, origin);
	}

	function importSummary(summary: ChatSummary, origin: Origin): void {
		db.run(
			`INSERT INTO chat_summaries (chat_id, updated_at, json, origin) VALUES (?, ?, ?, ?)
			 ON CONFLICT (chat_id) DO UPDATE SET
			   updated_at = excluded.updated_at, json = excluded.json, origin = excluded.origin`,
			summary.id,
			summary.updatedAt,
			JSON.stringify(summary),
			origin,
		);
	}

	/** Writes the record row (not the messages, not the images). */
	function writeRow(record: ChatRecord, origin: Origin): void {
		const extra: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(record)) {
			if (!RECORD_FIELDS.has(key)) extra[key] = value;
		}
		db.run(
			`INSERT INTO chats (id, title, kind, created_at, updated_at, version, settings_json, tree_json,
			   turns_json, extractions_json, side_chats_json, extra_json, origin)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET
			   title = excluded.title, kind = excluded.kind, created_at = excluded.created_at,
			   updated_at = excluded.updated_at, version = excluded.version,
			   settings_json = excluded.settings_json, tree_json = excluded.tree_json,
			   turns_json = excluded.turns_json, extractions_json = excluded.extractions_json,
			   side_chats_json = excluded.side_chats_json, extra_json = excluded.extra_json,
			   origin = excluded.origin`,
			record.id,
			record.title,
			record.kind ?? null,
			record.createdAt,
			record.updatedAt,
			record.version ?? null,
			jsonOrNull(record.settings),
			jsonOrNull(record.tree),
			jsonOrNull(record.turns),
			jsonOrNull(record.extractions),
			jsonOrNull(record.sideChats),
			Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
			origin,
		);
	}

	/** Rewrites the message rows from the first message that changed. */
	function writeMessages(id: string, messages: readonly LhMessage[]): void {
		const stored = db.all<{ json: string }>(
			"SELECT json FROM messages WHERE chat_id = ? ORDER BY seq",
			id,
		);
		const next = messages.map((m) => JSON.stringify(m));
		let first = 0;
		while (first < stored.length && first < next.length && stored[first]!.json === next[first])
			first++;
		if (first === stored.length && first === next.length) return;
		db.run("DELETE FROM messages WHERE chat_id = ? AND seq >= ?", id, first);
		for (let seq = first; seq < next.length; seq++) {
			const message = messages[seq]!;
			db.run(
				"INSERT INTO messages (chat_id, seq, id, role, json) VALUES (?, ?, ?, ?, ?)",
				id,
				seq,
				message.id,
				message.role,
				next[seq]!,
			);
		}
	}

	/** A snapshot id is a file name: only a SHA-256 of the bytes, with a known type. */
	function isValidImage(snapshotId: string, image: ImageSnapshot): boolean {
		return (
			/^[a-f0-9]{64}$/.test(snapshotId) &&
			(image?.mimeType === "image/png" || image?.mimeType === "image/jpeg") &&
			typeof image.data === "string" &&
			sha256OfBase64(image.data) === snapshotId
		);
	}

	function writeImage(id: string, snapshotId: string, image: ImageSnapshot): void {
		if (!isValidImage(snapshotId, image)) throw new Error("Invalid image snapshot identity");
		// The file first: a crash after it leaves a file with no row, never a row with no file.
		files.write(imageFileName(snapshotId, image.mimeType), image.data);
		db.run(
			`INSERT OR IGNORE INTO image_snapshots (chat_id, snapshot_id, mime_type, width, height)
			 VALUES (?, ?, ?, ?, ?)`,
			id,
			snapshotId,
			image.mimeType,
			image.width,
			image.height,
		);
	}

	function originOf(id: string): Origin | null {
		return (
			db.first<{ origin: Origin }>("SELECT origin FROM chat_summaries WHERE chat_id = ?", id)
				?.origin ?? null
		);
	}

	/** A local write: the row and summary as `local`, plus an outbox row. */
	function commitLocal(record: ChatRecord): void {
		const stamped = { ...record, version: CURRENT_CHAT_VERSION };
		writeRow(stamped, "local");
		writeSummary(stamped, "local");
		outbox.add("chat", record.id, "put");
	}

	function removeImageFiles(id: string): void {
		const rows = db.all<{ snapshot_id: string; mime_type: ImageSnapshot["mimeType"] }>(
			"SELECT snapshot_id, mime_type FROM image_snapshots WHERE chat_id = ?",
			id,
		);
		for (const row of rows) {
			// Another session can show the same picture: keep a file that is still used.
			const used = db.first(
				"SELECT 1 AS x FROM image_snapshots WHERE snapshot_id = ? AND chat_id <> ?",
				row.snapshot_id,
				id,
			);
			if (!used) files.remove(imageFileName(row.snapshot_id, row.mime_type));
		}
	}

	function removeRows(id: string): boolean {
		removeImageFiles(id);
		const removed = db.run("DELETE FROM chats WHERE id = ?", id).changes > 0;
		const listed = db.run("DELETE FROM chat_summaries WHERE chat_id = ?", id).changes > 0;
		return removed || listed;
	}

	return {
		createChat(title, kind) {
			const stamp = now();
			const record: ChatRecord = {
				id: `chat_${Date.parse(stamp).toString(36)}_${randomHex()}`,
				title: title.trim() || "Untitled session",
				createdAt: stamp,
				updatedAt: stamp,
				messages: [],
				...(kind === "practice" ? { kind: "practice" as const } : {}),
			};
			db.transaction(() => commitLocal(record));
			return { ...record, version: CURRENT_CHAT_VERSION };
		},

		getChat,

		listChats() {
			return db
				.all<{ json: string }>("SELECT json FROM chat_summaries ORDER BY updated_at DESC")
				.map((row) => JSON.parse(row.json) as ChatSummary);
		},

		saveMessages(id, messages) {
			db.transaction(() => {
				const record = mustGet(id);
				writeMessages(id, messages);
				commitLocal({ ...record, messages, updatedAt: now() });
			});
		},

		saveImageSnapshot(id, snapshotId, image) {
			if (!isValidImage(snapshotId, image)) throw new Error("Invalid image snapshot identity");
			db.transaction(() => {
				const record = mustGet(id);
				if (record.imageSnapshots?.[snapshotId]) return;
				writeImage(id, snapshotId, image);
				// The image is part of the record: stamp the version as the desktop does.
				commitLocal(record);
			});
		},

		saveTree(id, tree) {
			db.transaction(() => commitLocal({ ...mustGet(id), tree }));
		},

		appendTurnUsage(id, entry) {
			db.transaction(() => {
				const record = mustGet(id);
				if (record.turns?.some((t) => t.id === entry.id)) return;
				commitLocal({ ...record, turns: [...(record.turns ?? []), entry] });
			});
		},

		appendExtractionUsage(id, entry) {
			db.transaction(() => {
				const record = mustGet(id);
				if (record.extractions?.some((r) => r.startedAt === entry.startedAt)) return;
				commitLocal({ ...record, extractions: [...(record.extractions ?? []), entry] });
			});
		},

		saveSettings(id, settings) {
			db.transaction(() => commitLocal({ ...mustGet(id), settings }));
		},

		renameChat(id, title) {
			return db.transaction(() => {
				const record = { ...mustGet(id), title: title.trim() || "Untitled session" };
				commitLocal(record);
				return { ...record, version: CURRENT_CHAT_VERSION };
			});
		},

		deleteChat(id) {
			if (!ID.test(id)) return false;
			return db.transaction(() => {
				if (!readRow(id)) return false;
				removeRows(id);
				outbox.tombstone("chat", id);
				return true;
			});
		},

		updateSideChats(id, update) {
			return db.transaction(() => {
				const record = getChat(id);
				if (!record) return null;
				const next = update(record.sideChats ?? []);
				const { sideChats: _old, ...rest } = record;
				commitLocal(next.length > 0 ? { ...rest, sideChats: next } : rest);
				return next;
			});
		},

		importChat(record, origin) {
			checkId(record.id);
			if (typeof record.version === "number" && record.version > CURRENT_CHAT_VERSION) return false;
			db.transaction(() => {
				writeRow(record, origin);
				writeMessages(record.id, record.messages);
				// The Mac's record answer has no image bytes: keep the stored images then.
				if (record.imageSnapshots) {
					db.run("DELETE FROM image_snapshots WHERE chat_id = ?", record.id);
					for (const [snapshotId, image] of Object.entries(record.imageSnapshots)) {
						// An entry with a bad id, type or hash is skipped, never written as a file.
						if (isValidImage(snapshotId, image)) writeImage(record.id, snapshotId, image);
					}
				}
				writeSummary(record, origin);
			});
			return true;
		},

		importSummary(summary, origin) {
			checkId(summary.id);
			importSummary(summary, origin);
		},

		forgetChat(id) {
			if (!ID.test(id)) return;
			db.transaction(() => void removeRows(id));
		},

		originOf,
	};
}
