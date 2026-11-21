/** The session's reaction to the Mac's events (src/lib/session-events.ts). */
import { createEventHub } from "@/lib/server-events";
import { attachSessionEvents, syncSession } from "@/lib/session-events";

function fakeModel(status: "ready" | "submitted" | "streaming" | "error" = "ready") {
	const calls: string[] = [];
	let turnInFlight = false;
	const model = {
		chatId: "c1",
		status,
		resumeStream: jest.fn(
			async (refetch?: boolean) => void calls.push(`resume:${refetch ?? true}`),
		),
		readRecord: jest.fn(async () => {
			calls.push("read");
			return { messages: [], turnInFlight };
		}),
		continueIfOwed: jest.fn(async () => void calls.push("continue")),
	};
	return { model, calls, setInFlight: (v: boolean) => (turnInFlight = v) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

it("attaches to a turn that the Mac starts for this session", async () => {
	const hub = createEventHub();
	const { model, calls } = fakeModel();
	attachSessionEvents(model as never, hub);
	hub.dispatch({ type: "turn-started", payload: { chatId: "c1" } });
	hub.dispatch({ type: "turn-started", payload: { chatId: "other" } });
	await flush();
	expect(calls).toEqual(["resume:true"]);
});

it("does nothing while the phone's own turn is open", async () => {
	const hub = createEventHub();
	const { model, calls } = fakeModel("streaming");
	attachSessionEvents(model as never, hub);
	for (const type of ["turn-started", "turn-settled", "record-changed"])
		hub.dispatch({ type, payload: { chatId: "c1" } });
	hub.resync();
	await flush();
	expect(calls).toEqual([]);
});

it("reads the record when a turn settles or the record changes, then continues if owed", async () => {
	const hub = createEventHub();
	const { model, calls } = fakeModel();
	attachSessionEvents(model as never, hub);
	hub.dispatch({ type: "turn-settled", payload: { chatId: "c1" } });
	await flush();
	hub.dispatch({ type: "record-changed", payload: { chatId: "c1" } });
	await flush();
	expect(calls).toEqual(["read", "continue", "read", "continue"]);
});

it("after a reconnect, reads the record and attaches when a turn runs", async () => {
	const hub = createEventHub();
	const { model, calls, setInFlight } = fakeModel("error");
	attachSessionEvents(model as never, hub);
	setInFlight(true);
	hub.resync();
	await flush();
	expect(calls).toEqual(["read", "resume:false"]);
});

it("the stop function removes all listeners", async () => {
	const hub = createEventHub();
	const { model, calls } = fakeModel();
	const stop = attachSessionEvents(model as never, hub);
	stop();
	hub.dispatch({ type: "turn-started", payload: { chatId: "c1" } });
	hub.resync();
	await flush();
	expect(calls).toEqual([]);
});

describe("slices C and D hooks", () => {
	it("compaction-changed for this session goes to onCompaction", () => {
		const hub = createEventHub();
		const { model } = fakeModel();
		const onCompaction = jest.fn();
		attachSessionEvents(model as never, hub, { onCompaction });
		hub.dispatch({ type: "compaction-changed", payload: { chatId: "c1", running: true } });
		hub.dispatch({ type: "compaction-changed", payload: { chatId: "other", running: false } });
		hub.dispatch({ type: "compaction-changed", payload: { chatId: "c1", running: "yes" } });
		expect(onCompaction.mock.calls).toEqual([[true]]);
	});

	it("each sync gives its record to onSnapshot", async () => {
		const hub = createEventHub();
		const { model } = fakeModel();
		const onSnapshot = jest.fn();
		attachSessionEvents(model as never, hub, { onSnapshot });
		hub.dispatch({ type: "record-changed", payload: { chatId: "c1" } });
		await flush();
		expect(onSnapshot).toHaveBeenCalledWith({ messages: [], turnInFlight: false });
	});

	it("error state: a failed read after a reconnect goes to onSyncError", async () => {
		const hub = createEventHub();
		const { model } = fakeModel();
		model.readRecord.mockRejectedValueOnce(new Error("Could not sync the saved session."));
		const onSyncError = jest.fn();
		attachSessionEvents(model as never, hub, { onSyncError });
		hub.resync();
		await flush();
		expect(onSyncError).toHaveBeenCalledTimes(1);
		expect(model.continueIfOwed).not.toHaveBeenCalled();
	});

	it("a failed read after an event is quiet (the next event or reconnect reads again)", async () => {
		const hub = createEventHub();
		const { model } = fakeModel();
		model.readRecord.mockRejectedValueOnce(new Error("x"));
		const onSyncError = jest.fn();
		attachSessionEvents(model as never, hub, { onSyncError });
		hub.dispatch({ type: "turn-settled", payload: { chatId: "c1" } });
		await flush();
		expect(onSyncError).not.toHaveBeenCalled();
	});

	it("syncSession returns false when the read fails", async () => {
		const { model } = fakeModel();
		model.readRecord.mockRejectedValueOnce(new Error("x"));
		expect(await syncSession(model as never)).toBe(false);
		expect(await syncSession(model as never)).toBe(true);
	});
});
