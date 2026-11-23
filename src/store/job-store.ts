/**
 * JobStore on SQLite (issue 09), with the rules of the desktop's fs adapter
 * (`src/store/jobs.ts`): identity fields never change, an update without
 * `updatedAt` sets it to now, lists are newest activity first.
 */
import type { JobRecord, JobStore } from "@/lib/shared";

import type { OutboxWriter } from "./outbox";
import type { SqlDatabase } from "./sql";

const ID = /^[A-Za-z0-9_-]+$/;

export interface JobStoreDeps {
	db: SqlDatabase;
	outbox: OutboxWriter;
	now?: () => string;
	randomHex?: () => string;
}

export interface LocalJobStore extends JobStore {
	/** Writes a job record as it is, with no outbox row (the golden import, issue 10 sync). */
	importJob(record: JobRecord): void;
}

export function createJobStore(deps: JobStoreDeps): LocalJobStore {
	const { db, outbox } = deps;
	const now = deps.now ?? (() => new Date().toISOString());
	const randomHex =
		deps.randomHex ??
		(() => {
			const bytes = new Uint8Array(4);
			crypto.getRandomValues(bytes);
			return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		});

	function write(record: JobRecord, local = true): void {
		if (!ID.test(record.id)) throw new Error(`Invalid job id: ${record.id}`);
		db.run(
			`INSERT INTO jobs (id, chat_id, tool_call_id, updated_at, json) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at, json = excluded.json`,
			record.id,
			record.chatId,
			record.toolCallId,
			record.updatedAt,
			JSON.stringify(record),
		);
		if (local) outbox.add("job", record.id, "put");
	}

	function getJob(id: string): JobRecord | null {
		if (!ID.test(id)) return null;
		const row = db.first<{ json: string }>("SELECT json FROM jobs WHERE id = ?", id);
		return row ? (JSON.parse(row.json) as JobRecord) : null;
	}

	function listJobs(chatId: string): JobRecord[] {
		return db
			.all<{ json: string }>(
				"SELECT json FROM jobs WHERE chat_id = ? ORDER BY updated_at DESC, rowid DESC",
				chatId,
			)
			.map((row) => JSON.parse(row.json) as JobRecord);
	}

	return {
		createJob(init) {
			const stamp = now();
			const record: JobRecord = {
				id: `job_${Date.parse(stamp).toString(36)}_${randomHex()}`,
				kind: init.kind,
				chatId: init.chatId,
				toolCallId: init.toolCallId,
				...(init.input !== undefined ? { input: init.input } : {}),
				status: "running",
				activity: init.activity ?? "starting",
				createdAt: stamp,
				updatedAt: stamp,
				...(init.plugin ? { plugin: init.plugin } : {}),
			};
			db.transaction(() => write(record));
			return record;
		},
		getJob,
		updateJob(id, patch) {
			return db.transaction(() => {
				const record = getJob(id);
				if (!record) return null;
				const next: JobRecord = {
					...record,
					...patch,
					// Identity is immutable, also when a patch carries it at run time.
					id: record.id,
					kind: record.kind,
					chatId: record.chatId,
					toolCallId: record.toolCallId,
					createdAt: record.createdAt,
					updatedAt: patch.updatedAt ?? now(),
				};
				write(next);
				return next;
			});
		},
		importJob: (record) => write(record, false),
		listJobs,
		findJobByToolCallId(chatId, toolCallId) {
			return listJobs(chatId).find((j) => j.toolCallId === toolCallId) ?? null;
		},
		deleteJobsForChat(chatId) {
			return db.transaction(() => {
				const ids = db.all<{ id: string }>("SELECT id FROM jobs WHERE chat_id = ?", chatId);
				for (const { id } of ids) {
					db.run("DELETE FROM jobs WHERE id = ?", id);
					outbox.tombstone("job", id);
				}
				return ids.length;
			});
		},
	};
}
