/**
 * Issue 09: the mode 1 and 2 session mirror and its hook on the Mac fetch.
 */
import type { LhMessage } from "@/lib/shared";
import { createSessionMirror, type SessionMirror } from "@/store/mirror";
import { mirroringFetch } from "@/store/mirror-fetch";
import { sha256OfBase64 } from "@/store/image-files";

import { makeTestStore } from "../helpers/local-store";

const msg = (id: string) => ({ id, role: "user", content: id, timestamp: 1 }) as LhMessage;

function macSummary(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		title: `T ${id}`,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-02T00:00:00.000Z",
		kind: "teach",
		messageCount: 1,
		phase: "probe",
		pendingQuestion: false,
		pendingProblem: false,
		problemCount: 0,
		busy: true,
		compacting: false,
		...extra,
	};
}

function macRecord(id: string, messages = [msg("m1")]) {
	return {
		id,
		title: `T ${id}`,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-02T00:00:00.000Z",
		messages,
		turns: [],
		pricing: { a: 1 },
		turnInFlight: false,
		compacting: false,
		coverage: { x: 1 },
		pluginQuestionAvailability: {},
	};
}

describe("session mirror", () => {
	let store: ReturnType<typeof makeTestStore>;
	let tasks: (() => void)[];
	let log: jest.Mock;
	let mirror: SessionMirror;
	const flush = () => {
		const run = tasks;
		tasks = [];
		for (const task of run) task();
	};
	beforeEach(() => {
		store = makeTestStore();
		tasks = [];
		log = jest.fn();
		mirror = createSessionMirror({ open: () => store, schedule: (t) => tasks.push(t), log });
	});
	afterEach(() => store.close());

	it("copies the Mac's list without the live fields and with no outbox rows", () => {
		mirror.list({ chats: [macSummary("chat_a")] });
		expect(store.chats.listChats()).toEqual([]); // nothing before the scheduled write
		flush();
		const [row] = store.chats.listChats();
		expect(row).toMatchObject({ id: "chat_a", title: "T chat_a", messageCount: 1 });
		expect(row).not.toHaveProperty("busy");
		expect(row).not.toHaveProperty("compacting");
		expect(store.chats.originOf("chat_a")).toBe("mirror");
		expect(store.outbox.count()).toBe(0);
	});

	it("removes a mirrored session that the Mac does not list any more", () => {
		mirror.list({ chats: [macSummary("chat_a"), macSummary("chat_b")] });
		mirror.record("chat_b", macRecord("chat_b"));
		flush();
		mirror.list({ chats: [macSummary("chat_a")] });
		flush();
		expect(store.chats.listChats().map((c) => c.id)).toEqual(["chat_a"]);
		expect(store.chats.getChat("chat_b")).toBeNull();
		expect(store.db.all("SELECT * FROM tombstones")).toEqual([]);
	});

	it("never removes or overwrites a session made or changed on the phone", () => {
		const local = store.chats.createChat("Phone");
		mirror.list({ chats: [macSummary("chat_a")] });
		mirror.record(local.id, macRecord(local.id, [msg("mac")]));
		flush();
		expect(store.chats.getChat(local.id)!.title).toBe("Phone");
		expect(store.chats.listChats().map((c) => c.id)).toContain(local.id);
	});

	it("keeps a mirrored session that has a waiting phone change", () => {
		mirror.record("chat_b", macRecord("chat_b"));
		flush();
		store.chats.saveMessages("chat_b", [msg("m1"), msg("phone")]);
		mirror.list({ chats: [] });
		mirror.record("chat_b", macRecord("chat_b"));
		flush();
		expect(store.chats.getChat("chat_b")!.messages.map((m) => m.id)).toEqual(["m1", "phone"]);
	});

	it("copies only the record fields of the Mac's record answer, and keeps the images", () => {
		mirror.record("chat_a", macRecord("chat_a"));
		flush();
		const png = "iVBORw0KGgo=";
		store.db.run(
			"INSERT INTO image_snapshots (chat_id, snapshot_id, mime_type, width, height) VALUES (?, ?, 'image/png', 1, 1)",
			"chat_a",
			sha256OfBase64(png),
		);
		store.files.write(`${sha256OfBase64(png)}.png`, png);
		mirror.record("chat_a", macRecord("chat_a", [msg("m1"), msg("m2")]));
		flush();
		const record = store.chats.getChat("chat_a")!;
		expect(Object.keys(record).sort()).toEqual(
			["createdAt", "id", "imageSnapshots", "messages", "title", "turns", "updatedAt"].sort(),
		);
		expect(record.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
	});

	it("never takes image snapshots from the Mac's record answer", () => {
		mirror.record("chat_a", {
			...macRecord("chat_a"),
			imageSnapshots: { "../x": { mimeType: "image/png", data: "AA==", width: 1, height: 1 } },
		});
		flush();
		expect(store.files.names()).toEqual([]);
		expect(store.chats.getChat("chat_a")!.imageSnapshots).toBeUndefined();
	});

	it("writes only the newest body when two come before the write", () => {
		mirror.record("chat_a", macRecord("chat_a", [msg("m1")]));
		mirror.record("chat_a", macRecord("chat_a", [msg("m1"), msg("m2")]));
		expect(tasks).toHaveLength(1);
		flush();
		expect(store.chats.getChat("chat_a")!.messages).toHaveLength(2);
	});

	it("skips a bad body", () => {
		mirror.list({ chats: "nope" });
		mirror.list({ chats: [{ id: "../x", title: "x" }, macSummary("chat_a", { kind: "other" })] });
		mirror.record("chat_a", { id: "chat_other", messages: [] });
		mirror.record("chat_a", { ...macRecord("chat_a"), messages: [{ role: "user" }] });
		mirror.record("../x", macRecord("../x"));
		flush();
		expect(store.chats.listChats()).toEqual([]);
		expect(log).not.toHaveBeenCalled();
	});

	it("stays off when the store cannot open, and never throws", () => {
		const open = jest.fn(() => null);
		const off = createSessionMirror({ open, schedule: (t) => tasks.push(t), log });
		off.list({ chats: [macSummary("chat_a")] });
		flush();
		off.record("chat_a", macRecord("chat_a"));
		flush();
		expect(open).toHaveBeenCalledTimes(1);
		expect(tasks).toHaveLength(0);
	});

	it("turns off after a failed write and logs it once", () => {
		const broken = {
			...store,
			chats: {
				...store.chats,
				originOf: () => null,
				importChat: () => {
					throw new Error("disk full");
				},
			},
		};
		const failing = createSessionMirror({
			open: () => broken,
			schedule: (t) => tasks.push(t),
			log,
		});
		failing.record("chat_a", macRecord("chat_a"));
		flush();
		failing.record("chat_b", macRecord("chat_b"));
		flush();
		expect(log).toHaveBeenCalledTimes(1);
		expect(tasks).toHaveLength(0);
	});
});

describe("mirroringFetch", () => {
	const seen: { kind: string; id?: string; body: unknown }[] = [];
	const mirror: SessionMirror = {
		list: (body) => void seen.push({ kind: "list", body }),
		record: (id, body) => void seen.push({ kind: "record", id, body }),
	};
	beforeEach(() => {
		seen.length = 0;
	});

	const answer =
		(body: unknown, status = 200) =>
		async () =>
			new Response(JSON.stringify(body), { status });

	it("gives the session list body to the mirror after the screen reads it", async () => {
		const fetchImpl = mirroringFetch(answer({ chats: [1] }) as never, mirror);
		const res = await fetchImpl("/api/chats");
		expect(seen).toEqual([]);
		expect(await res.json()).toEqual({ chats: [1] });
		expect(seen).toEqual([{ kind: "list", body: { chats: [1] } }]);
	});

	it("gives a record body read as text (SessionModel) to the mirror", async () => {
		const fetchImpl = mirroringFetch(answer({ id: "chat_a" }) as never, mirror);
		const res = await fetchImpl("/api/chats/chat_a");
		expect(await res.text()).toBe('{"id":"chat_a"}');
		expect(seen).toEqual([{ kind: "record", id: "chat_a", body: { id: "chat_a" } }]);
	});

	it("passes other requests, writes and failures through", async () => {
		const ok = mirroringFetch(answer({ a: 1 }) as never, mirror);
		await (await ok("/api/chats/chat_a/stream")).json();
		await (await ok("/api/chats", { method: "POST" })).json();
		await (await ok("/api/graph")).json();
		const failed = mirroringFetch(answer({ error: "x" }, 500) as never, mirror);
		await (await failed("/api/chats")).json();
		expect(seen).toEqual([]);
	});

	it("still gives the screen a body that is not JSON", async () => {
		const fetchImpl = mirroringFetch((async () => new Response("<html>")) as never, mirror);
		expect(await (await fetchImpl("/api/chats/chat_a")).text()).toBe("<html>");
		expect(seen).toEqual([]);
	});
});
