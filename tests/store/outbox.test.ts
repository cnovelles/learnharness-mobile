/**
 * Issue 09: the outbox. Each local write adds a row in the same
 * transaction; a row goes away only when the Mac confirms its revision.
 */
import type { LhMessage } from "@/lib/shared";

import { makeTestStore } from "../helpers/local-store";

const msg = (id: string) => ({ id, role: "user", content: id, timestamp: 1 }) as LhMessage;

describe("outbox", () => {
	let store: ReturnType<typeof makeTestStore>;
	beforeEach(() => {
		store = makeTestStore();
	});
	afterEach(() => store.close());

	it("keeps one row for each changed session, with a new revision for each change", () => {
		const { id } = store.chats.createChat("A");
		store.chats.saveMessages(id, [msg("m1")]);
		store.chats.saveMessages(id, [msg("m1"), msg("m2")]);
		expect(store.outbox.count()).toBe(1);
		expect(store.outbox.pending()).toEqual([
			expect.objectContaining({ entity: "chat", entityId: id, op: "put", revision: 3 }),
		]);
	});

	it("removes a row only when the confirmed revision is the current one", () => {
		const { id } = store.chats.createChat("A");
		const sent = store.outbox.pending()[0]!;
		// A change during the send: the row must stay.
		store.chats.saveMessages(id, [msg("m1")]);
		expect(store.outbox.confirm("chat", id, sent.revision)).toBe(false);
		expect(store.outbox.has("chat", id)).toBe(true);
		const resent = store.outbox.pending()[0]!;
		expect(store.outbox.confirm("chat", id, resent.revision)).toBe(true);
		expect(store.outbox.count()).toBe(0);
	});

	it("counts failed sends and keeps the row", () => {
		store.chats.createChat("A");
		const entry = store.outbox.pending()[0]!;
		store.outbox.markAttempt(entry.seq);
		store.outbox.markAttempt(entry.seq);
		expect(store.outbox.pending()[0]!.attempts).toBe(2);
	});

	it("records a delete as a tombstone and a delete row", () => {
		const { id } = store.chats.createChat("A");
		store.chats.deleteChat(id);
		expect(store.outbox.pending()).toEqual([
			expect.objectContaining({ entity: "chat", entityId: id, op: "delete" }),
		]);
		expect(store.db.all("SELECT entity, entity_id FROM tombstones")).toEqual([
			{ entity: "chat", entity_id: id },
		]);
	});

	it("adds no row for a mirror write", () => {
		store.chats.importChat(
			{ id: "chat_m_1", title: "M", createdAt: "x", updatedAt: "x", messages: [msg("m1")] },
			"mirror",
		);
		expect(store.outbox.count()).toBe(0);
	});

	it("adds no row when the write fails", () => {
		expect(() => store.chats.saveMessages("chat_none", [])).toThrow();
		expect(store.outbox.count()).toBe(0);
	});

	it("records each graph line, source, position write and rewrite", () => {
		const node = {
			id: "n1",
			name: "N",
			statement: "S",
			aliases: [],
			createdAt: "x",
			provenance: [],
		};
		store.graph.appendNode(node);
		store.graph.appendNode(node);
		store.graph.upsertSource({ id: "src1", filePath: "/a.md", importedAt: "x" } as never);
		store.graph.writePositions({ n1: { x: 1, y: 2 } });
		expect(store.outbox.pending().map((e) => `${e.entity}:${e.op}`)).toEqual([
			"graph-node:put",
			"graph-node:put",
			"graph-source:put",
			"graph-positions:put",
		]);
		store.graph.rewriteLedgers({ nodes: [node] });
		expect(store.outbox.pending().map((e) => `${e.entity}:${e.entityId}:${e.op}`)).toEqual([
			"graph-source:src1:put",
			"graph-positions:all:put",
			"graph-ledger:nodes:rewrite",
		]);
	});
});
