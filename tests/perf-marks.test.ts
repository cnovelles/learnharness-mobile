/**
 * The timing marks of a session open (issue 21 slice A): the phases, the
 * ring buffer, the frame gap, the island counts and the saved file.
 */
import {
	LIMIT,
	TRACE_LIMIT_MS,
	createPerfStore,
	formatMs,
	parseOpens,
	phaseTimes,
	quantile,
	summarize,
	type OpenRecord,
	type PerfPorts,
} from "@/lib/perf-marks";

function rig(saved: string | null = null) {
	let now = 1000;
	let frame: ((t: number) => void) | null = null;
	let stops = 0;
	const files: string[] = [];
	const ports: PerfPorts = {
		now: () => now,
		date: () => new Date("2026-11-18T10:00:00.000Z"),
		build: () => ({ type: "release", commit: "abc1234", device: "iPhone 13 Pro Max", os: "26.1" }),
		frames: (f) => {
			frame = f;
			return () => {
				frame = null;
				stops += 1;
			};
		},
		load: () => saved,
		save: (text) => void files.push(text),
	};
	const store = createPerfStore(ports);
	return {
		store,
		files,
		advance(ms: number) {
			now += ms;
		},
		/** A frame `ms` after the last time. */
		tick(ms: number) {
			now += ms;
			frame?.(now);
		},
		framesOn: () => frame !== null,
		stops: () => stops,
	};
}

function fullOpen(r: ReturnType<typeof rig>, id = "chat_a") {
	r.store.startOpen(id);
	r.advance(300);
	r.store.mark(id, "fetched");
	r.advance(180);
	r.store.mark(id, "parsed");
	r.store.describe(id, { title: "Tides", messages: 95 });
	r.advance(2950);
	r.store.mark(id, "drawn");
	r.advance(1140);
	r.store.mark(id, "idle");
	r.advance(200);
	r.store.mark(id, "atEnd");
}

describe("an open", () => {
	it("keeps the marks from the tap and gives the five phases", () => {
		const r = rig();
		fullOpen(r);
		const [open] = r.store.opens();
		expect(open).toMatchObject({
			chatId: "chat_a",
			title: "Tides",
			messages: 95,
			from: "tap",
			outcome: "end",
			at: "2026-11-18T10:00:00.000Z",
			build: { type: "release", commit: "abc1234" },
			marks: { fetched: 300, parsed: 480, drawn: 3430, idle: 4570, atEnd: 4770 },
		});
		expect(phaseTimes(open!)).toEqual({
			fetch: 300,
			parse: 180,
			draw: 2950,
			reveal: 1140,
			end: 200,
		});
		expect(r.store.tracing()).toBe(false);
	});

	it("ignores a mark of another session and a second mark", () => {
		const r = rig();
		r.store.startOpen("chat_a");
		r.advance(100);
		r.store.mark("chat_b", "fetched");
		r.store.mark("chat_a", "fetched");
		r.advance(100);
		r.store.mark("chat_a", "fetched");
		r.store.leave("chat_a");
		expect(r.store.opens()[0]!.marks).toEqual({ fetched: 100 });
	});

	it("keeps the longest frame gap, also a gap that a mark closes", () => {
		const r = rig();
		r.store.startOpen("chat_a");
		r.tick(16);
		r.tick(700);
		r.tick(16);
		r.advance(2600); // the JS thread is busy: no frame
		r.store.mark("chat_a", "drawn");
		r.store.leave("chat_a");
		expect(r.store.opens()[0]!.longestFrameMs).toBe(2600);
	});

	it("stops the frame watch when the open ends", () => {
		const r = rig();
		fullOpen(r);
		expect(r.framesOn()).toBe(false);
		expect(r.stops()).toBe(1);
	});

	it("ends with outcome left when the screen closes, and timeout after the limit", () => {
		const r = rig();
		r.store.startOpen("chat_a");
		r.store.leave("chat_a");
		r.store.startOpen("chat_b");
		r.tick(TRACE_LIMIT_MS + 1);
		expect(r.store.opens().map((o) => o.outcome)).toEqual(["left", "timeout"]);
	});

	it("a new tap ends the open that still runs", () => {
		const r = rig();
		r.store.startOpen("chat_a");
		r.store.startOpen("chat_b");
		expect(r.store.opens().map((o) => [o.chatId, o.outcome])).toEqual([["chat_a", "left"]]);
	});

	it("starts an open at mount only when no tap started one for the session", () => {
		const r = rig();
		r.store.startOpen("chat_a");
		r.advance(50);
		r.store.ensureOpen("chat_a");
		r.store.mark("chat_a", "fetched");
		r.store.ensureOpen("chat_b");
		r.store.leave("chat_b");
		expect(r.store.opens().map((o) => [o.chatId, o.from, o.marks.fetched])).toEqual([
			["chat_a", "tap", 50],
			["chat_b", "mount", undefined],
		]);
	});
});

describe("islands", () => {
	it("counts the islands of the open and the islands mounted now", () => {
		const r = rig();
		r.store.islandStarted();
		r.store.startOpen("chat_a");
		r.store.islandStarted();
		r.store.islandStarted();
		r.store.islandEnded();
		r.store.leave("chat_a");
		expect(r.store.opens()[0]!.islands).toBe(2);
		expect(r.store.liveIslands()).toBe(2);
		r.store.islandEnded();
		r.store.islandEnded();
		r.store.islandEnded();
		expect(r.store.liveIslands()).toBe(0);
	});
});

describe("the ring buffer and the file", () => {
	it("keeps the last LIMIT opens", () => {
		const r = rig();
		for (let i = 0; i < LIMIT + 5; i++) {
			r.store.startOpen(`chat_${i}`);
			r.store.leave(`chat_${i}`);
		}
		expect(r.store.opens()).toHaveLength(LIMIT);
		expect(r.store.opens()[0]!.chatId).toBe("chat_5");
	});

	it("saves each open and loads the saved opens", () => {
		const r = rig();
		fullOpen(r);
		const saved = r.files.at(-1)!;
		const again = rig(saved);
		expect(again.store.opens()).toEqual(r.store.opens());
		expect(JSON.parse(again.store.exportJson())).toMatchObject({
			v: 1,
			opens: [{ title: "Tides" }],
		});
	});

	it("a broken file gives no opens", () => {
		expect(parseOpens("{")).toEqual([]);
		expect(parseOpens(JSON.stringify({ v: 99, opens: [] }))).toEqual([]);
		expect(parseOpens(JSON.stringify({ v: 1, opens: [{ v: 1 }] }))).toEqual([]);
		expect(rig("not json").store.opens()).toEqual([]);
	});

	it("clear removes the opens and saves", () => {
		const r = rig();
		fullOpen(r);
		r.store.clear();
		expect(r.store.opens()).toEqual([]);
		expect(parseOpens(r.files.at(-1)!)).toEqual([]);
	});

	it("tells the listeners", () => {
		const r = rig();
		const listener = jest.fn();
		const off = r.store.subscribe(listener);
		fullOpen(r);
		expect(listener).toHaveBeenCalled();
		off();
		listener.mockClear();
		r.store.islandStarted();
		expect(listener).not.toHaveBeenCalled();
	});
});

describe("the summary", () => {
	const open = (atEnd?: number): OpenRecord => ({
		v: 1,
		chatId: "c",
		title: "",
		messages: 0,
		at: "",
		from: "tap",
		build: { type: "release", commit: "x", device: "d", os: "o" },
		marks: atEnd === undefined ? { fetched: 10 } : { atEnd },
		longestFrameMs: 0,
		islands: 0,
		outcome: atEnd === undefined ? "left" : "end",
	});

	it("gives the median and the p95 of the opens that reached the end", () => {
		const s = summarize([open(100), open(300), open(200), open(), open(4000)]);
		expect(s).toEqual({ opens: 5, complete: 4, medianMs: 200, p95Ms: 4000 });
		expect(summarize([])).toEqual({ opens: 0, complete: 0, medianMs: null, p95Ms: null });
	});

	it("uses the nearest rank", () => {
		const values = Array.from({ length: 20 }, (_, i) => i + 1);
		expect(quantile(values, 0.5)).toBe(10);
		expect(quantile(values, 0.95)).toBe(19);
		expect(quantile([7], 0.95)).toBe(7);
	});

	it("gives null for a phase with a missing mark", () => {
		expect(phaseTimes({ marks: { fetched: 10, drawn: 50 } })).toEqual({
			fetch: 10,
			parse: null,
			draw: null,
			reveal: null,
			end: null,
		});
	});

	it("formats times", () => {
		expect(formatMs(null)).toBe("–");
		expect(formatMs(12.4)).toBe("12 ms");
		expect(formatMs(310)).toBe("0.31 s");
		expect(formatMs(4775)).toBe("4.78 s");
	});
});
