/**
 * Issue 09: the ChatStore adapter on a real SQLite. The rules come from the
 * desktop's fs adapter (`../learnharness/src/store/chats.ts`).
 */
import { CURRENT_CHAT_VERSION, type ChatRecord, type LhMessage } from "@/lib/shared";
import { sha256OfBase64 } from "@/store/image-files";

import { makeTestStore } from "../helpers/local-store";

function user(id: string, text: string): LhMessage {
	return { id, role: "user", content: text, timestamp: 1 } as LhMessage;
}

const PNG = "iVBORw0KGgo="; // eight bytes are enough: the store checks only the hash

describe("ChatStore on SQLite", () => {
	let store: ReturnType<typeof makeTestStore>;
	beforeEach(() => {
		store = makeTestStore();
	});
	afterEach(() => store.close());

	it("creates a session, reads it back, and lists it", () => {
		const created = store.chats.createChat("  Bayes  ");
		expect(created.id).toMatch(/^chat_[a-z0-9]+_[0-9a-f]{8}$/);
		expect(created.title).toBe("Bayes");
		expect(created.version).toBe(CURRENT_CHAT_VERSION);
		expect(store.chats.getChat(created.id)).toEqual(created);
		expect(store.chats.listChats()).toEqual([
			{
				id: created.id,
				title: "Bayes",
				createdAt: created.createdAt,
				updatedAt: created.updatedAt,
				version: CURRENT_CHAT_VERSION,
				kind: "teach",
				messageCount: 0,
				phase: "probe",
				pendingQuestion: false,
				pendingProblem: false,
				problemCount: 0,
			},
		]);
	});

	it("marks a practice session and gives an empty title a name", () => {
		const created = store.chats.createChat("  ", "practice");
		expect(created.title).toBe("Untitled session");
		expect(created.kind).toBe("practice");
		expect(store.chats.listChats()[0]!.kind).toBe("practice");
	});

	it("saves messages, one row each, and updates the list row", () => {
		const { id } = store.chats.createChat("A");
		const messages = [user("m1", "one"), user("m2", "two")];
		store.chats.saveMessages(id, messages);
		expect(store.chats.getChat(id)!.messages).toEqual(messages);
		expect(store.db.all("SELECT id FROM messages WHERE chat_id = ? ORDER BY seq", id)).toEqual([
			{ id: "m1" },
			{ id: "m2" },
		]);
		expect(store.chats.listChats()[0]!.messageCount).toBe(2);
	});

	it("rewrites only the rows from the first changed message", () => {
		const { id } = store.chats.createChat("A");
		store.chats.saveMessages(id, [user("m1", "one"), user("m2", "two")]);
		const rowid = () =>
			store.db.first<{ r: number }>(
				"SELECT rowid AS r FROM messages WHERE chat_id = ? AND id = 'm1'",
				id,
			)!.r;
		const before = rowid();
		store.chats.saveMessages(id, [user("m1", "one"), user("m2", "two, changed"), user("m3", "3")]);
		expect(rowid()).toBe(before);
		expect(store.chats.getChat(id)!.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
		// A shorter list (compaction) removes the rows after it.
		store.chats.saveMessages(id, [user("c1", "summary")]);
		expect(store.chats.getChat(id)!.messages.map((m) => m.id)).toEqual(["c1"]);
	});

	it("changes updatedAt for messages, not for a rename, settings or the plan tree", () => {
		const { id, updatedAt } = store.chats.createChat("A");
		store.chats.renameChat(id, "B");
		store.chats.saveSettings(id, { strongModel: { provider: "openai", model: "x" } } as never);
		store.chats.saveTree(id, { nodes: [] } as never);
		expect(store.chats.getChat(id)!.updatedAt).toBe(updatedAt);
		store.chats.saveMessages(id, [user("m1", "x")]);
		expect(store.chats.getChat(id)!.updatedAt > updatedAt).toBe(true);
		expect(store.chats.listChats()[0]!.title).toBe("B");
	});

	it("lists sessions newest activity first", () => {
		const a = store.chats.createChat("A");
		const b = store.chats.createChat("B");
		store.chats.saveMessages(a.id, [user("m1", "x")]);
		expect(store.chats.listChats().map((c) => c.id)).toEqual([a.id, b.id]);
	});

	it("appends usage once for each turn id and extraction start", () => {
		const { id } = store.chats.createChat("A");
		const turn = { id: "t1", messageId: "m1" } as never;
		store.chats.appendTurnUsage(id, turn);
		store.chats.appendTurnUsage(id, turn);
		const run = { startedAt: "s1" } as never;
		store.chats.appendExtractionUsage(id, run);
		store.chats.appendExtractionUsage(id, run);
		const record = store.chats.getChat(id)!;
		expect(record.turns).toHaveLength(1);
		expect(record.extractions).toHaveLength(1);
	});

	it("throws for a write to an unknown session", () => {
		expect(() => store.chats.saveMessages("chat_none", [])).toThrow("Chat not found");
		expect(() => store.chats.renameChat("chat_none", "x")).toThrow("Chat not found");
	});

	it("refuses a bad id and reads it as absent", () => {
		expect(store.chats.getChat("../etc")).toBeNull();
		expect(store.chats.deleteChat("../etc")).toBe(false);
	});

	it("reads a record with a newer schema version as absent, and never rewrites it", () => {
		const record = { ...store.chats.createChat("A") };
		store.db.run("UPDATE chats SET version = ? WHERE id = ?", CURRENT_CHAT_VERSION + 1, record.id);
		expect(store.chats.getChat(record.id)).toBeNull();
		expect(() => store.chats.saveMessages(record.id, [])).toThrow("Chat not found");
		expect(store.chats.importChat({ ...record, version: CURRENT_CHAT_VERSION + 1 }, "mirror")).toBe(
			false,
		);
	});

	it("stores an image snapshot as a file, once", () => {
		const { id } = store.chats.createChat("A");
		const snapshotId = sha256OfBase64(PNG);
		const image = { mimeType: "image/png" as const, data: PNG, width: 2, height: 3 };
		store.chats.saveImageSnapshot(id, snapshotId, image);
		store.chats.saveImageSnapshot(id, snapshotId, image);
		expect(store.files.names()).toEqual([`${snapshotId}.png`]);
		expect(store.chats.getChat(id)!.imageSnapshots).toEqual({ [snapshotId]: image });
	});

	it("refuses an image snapshot whose id is not the hash of its bytes", () => {
		const { id } = store.chats.createChat("A");
		const image = { mimeType: "image/png" as const, data: PNG, width: 2, height: 3 };
		expect(() => store.chats.saveImageSnapshot(id, "a".repeat(64), image)).toThrow(
			"Invalid image snapshot identity",
		);
		expect(store.files.names()).toEqual([]);
	});

	it("reads an image whose file is missing as absent", () => {
		const { id } = store.chats.createChat("A");
		const snapshotId = sha256OfBase64(PNG);
		store.chats.saveImageSnapshot(id, snapshotId, {
			mimeType: "image/png",
			data: PNG,
			width: 2,
			height: 3,
		});
		store.files.remove(`${snapshotId}.png`);
		expect(store.chats.getChat(id)!.imageSnapshots).toBeUndefined();
	});

	it("deletes a session with its messages, images and list row", () => {
		const { id } = store.chats.createChat("A");
		store.chats.saveMessages(id, [user("m1", "x")]);
		store.chats.saveImageSnapshot(id, sha256OfBase64(PNG), {
			mimeType: "image/png",
			data: PNG,
			width: 1,
			height: 1,
		});
		expect(store.chats.deleteChat(id)).toBe(true);
		expect(store.chats.deleteChat(id)).toBe(false);
		expect(store.chats.getChat(id)).toBeNull();
		expect(store.chats.listChats()).toEqual([]);
		expect(store.db.all("SELECT * FROM messages")).toEqual([]);
		expect(store.files.names()).toEqual([]);
	});

	it("updates side chats in one step and removes the field when empty", () => {
		const { id } = store.chats.createChat("A");
		const thread = { id: "s1", messages: [] } as never;
		expect(store.chats.updateSideChats(id, () => [thread])).toEqual([thread]);
		expect(store.chats.getChat(id)!.sideChats).toEqual([thread]);
		expect(store.chats.updateSideChats(id, () => [])).toEqual([]);
		expect(store.chats.getChat(id)!.sideChats).toBeUndefined();
		expect(store.chats.updateSideChats("chat_none", () => [])).toBeNull();
	});

	it("keeps record fields that this build does not know", () => {
		const record = {
			id: "chat_x_1",
			title: "T",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messages: [],
			futureField: { a: 1 },
		} as ChatRecord;
		store.chats.importChat(record, "mirror");
		expect(store.chats.getChat("chat_x_1")).toEqual(record);
	});

	it("rolls back a write that fails, so nothing is half written", () => {
		const { id } = store.chats.createChat("A");
		store.chats.saveMessages(id, [user("m1", "x")]);
		// Two messages with the same id break the unique key in the middle of the write.
		expect(() => store.chats.saveMessages(id, [user("m2", "y"), user("m2", "z")])).toThrow();
		expect(store.chats.getChat(id)!.messages.map((m) => m.id)).toEqual(["m1"]);
		expect(store.chats.listChats()[0]!.messageCount).toBe(1);
	});
});
