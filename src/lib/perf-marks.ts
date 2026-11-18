/**
 * Timing marks of a session open (issue 21 slice A). Pure code: the clock,
 * the frame source and the file are ports, so the tests drive them.
 *
 * One open is one trace. The marks are milliseconds from the start:
 * - `fetched`: the Mac answered `GET /api/chats/<id>` (headers).
 * - `parsed`: the body is read and checked.
 * - `drawn`: the session screen committed its first transcript.
 * - `idle`: the top-to-bottom reveal has no block that waits.
 * - `atEnd`: after `idle`, the view is at the end of the transcript.
 *
 * The five phases (user decision 2026-11-18: these five first, sub-phases
 * only after the first profile) are the gaps between the marks. The trace
 * also keeps the longest frame gap (the JS thread was busy and the screen
 * froze) and the islands (WebViews) that started during the open.
 *
 * The last LIMIT opens stay in a ring buffer. Each open keeps the build
 * (type, commit, device), so results from different builds never mix.
 */

export const MARKS = ["fetched", "parsed", "drawn", "idle", "atEnd"] as const;
export type Mark = (typeof MARKS)[number];

/** The five phases of the panel, in order, and the mark that ends each. */
export const PHASES = [
	{ id: "fetch", label: "Fetch", from: null, to: "fetched" },
	{ id: "parse", label: "Parse", from: "fetched", to: "parsed" },
	{ id: "draw", label: "First transcript draw", from: "parsed", to: "drawn" },
	{ id: "reveal", label: "Reveal to idle", from: "drawn", to: "idle" },
	{ id: "end", label: "Scroll to the end", from: "idle", to: "atEnd" },
] as const satisfies readonly { id: string; label: string; from: Mark | null; to: Mark }[];
export type PhaseId = (typeof PHASES)[number]["id"];

/** The ring buffer size. */
export const LIMIT = 50;
/** An open that takes longer than this ends with the marks it has. */
export const TRACE_LIMIT_MS = 60_000;
/** The version of the saved file and of each open. */
export const RESULT_VERSION = 1 as const;

export interface BuildInfo {
	/** "release" or "dev": only release numbers are the real ones. */
	type: "release" | "dev";
	/** The short git commit of the build, with "-dirty" for changed files. */
	commit: string;
	/** The device model, for example "iPhone 13 Pro Max". */
	device: string;
	os: string;
}

export interface OpenRecord {
	v: typeof RESULT_VERSION;
	chatId: string;
	title: string;
	messages: number;
	/** The start time (ISO). */
	at: string;
	/** "tap": a row or a card; "mount": the screen opened another way. */
	from: "tap" | "mount";
	build: BuildInfo;
	/** Milliseconds from the start. A missing mark did not happen. */
	marks: Partial<Record<Mark, number>>;
	/** The largest gap between two frames during the open, in ms. */
	longestFrameMs: number;
	/** The island WebViews that started during the open. */
	islands: number;
	/** "end": all marks; "left": the screen closed first; "timeout": TRACE_LIMIT_MS passed. */
	outcome: "end" | "left" | "timeout";
}

/** The export: what "Share results" sends and what perf/results keeps. */
export interface PerfExport {
	v: typeof RESULT_VERSION;
	exportedAt: string;
	opens: OpenRecord[];
}

export interface PerfPorts {
	/** Milliseconds, monotonic (performance.now). */
	now(): number;
	/** The wall clock, for the `at` field. */
	date(): Date;
	build(): BuildInfo;
	/** Call `frame` on each frame until `stop` is called. */
	frames(frame: (t: number) => void): () => void;
	/** The saved opens, or null. A broken file counts as none. */
	load(): string | null;
	save(text: string): void;
}

interface Trace {
	chatId: string;
	start: number;
	at: string;
	from: OpenRecord["from"];
	title: string;
	messages: number;
	marks: Partial<Record<Mark, number>>;
	longestFrameMs: number;
	lastFrame: number;
	islands: number;
	stopFrames: () => void;
}

/** The duration of each phase of an open; null for a phase with a missing mark. */
export function phaseTimes(record: Pick<OpenRecord, "marks">): Record<PhaseId, number | null> {
	const at = (m: Mark | null) => (m === null ? 0 : record.marks[m]);
	const out = {} as Record<PhaseId, number | null>;
	for (const p of PHASES) {
		const a = at(p.from);
		const b = at(p.to);
		out[p.id] = a === undefined || b === undefined ? null : Math.max(0, b - a);
	}
	return out;
}

/** The time of the whole open: the `atEnd` mark, or null when the open did not reach it. */
export function totalTime(record: Pick<OpenRecord, "marks">): number | null {
	return record.marks.atEnd ?? null;
}

/** The value at fraction q (0 to 1) of the sorted values, nearest rank. Null for no values. */
export function quantile(values: readonly number[], q: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil(q * sorted.length);
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export interface PerfSummary {
	opens: number;
	/** The opens that reached the end: only these count in the median and the p95. */
	complete: number;
	medianMs: number | null;
	p95Ms: number | null;
}

export function summarize(records: readonly OpenRecord[]): PerfSummary {
	const totals = records.flatMap((r) => {
		const t = totalTime(r);
		return t === null ? [] : [t];
	});
	return {
		opens: records.length,
		complete: totals.length,
		medianMs: quantile(totals, 0.5),
		p95Ms: quantile(totals, 0.95),
	};
}

/** "0.31 s", "12 ms" for short times. */
export function formatMs(ms: number | null): string {
	if (ms === null) return "–";
	if (ms < 100) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(2)} s`;
}

function isRecord(x: unknown): x is OpenRecord {
	if (typeof x !== "object" || x === null) return false;
	const r = x as Partial<OpenRecord>;
	return (
		r.v === RESULT_VERSION &&
		typeof r.chatId === "string" &&
		typeof r.marks === "object" &&
		r.marks !== null &&
		typeof r.build === "object" &&
		r.build !== null
	);
}

/** The opens in a saved file or an export. A broken file gives none. */
export function parseOpens(text: string | null): OpenRecord[] {
	if (!text) return [];
	try {
		const body = JSON.parse(text) as { v?: unknown; opens?: unknown };
		if (body.v !== RESULT_VERSION || !Array.isArray(body.opens)) return [];
		return body.opens.filter(isRecord).slice(-LIMIT);
	} catch {
		return [];
	}
}

export interface PerfStore {
	/** A tap on a session row or card starts an open. */
	startOpen(chatId: string, from?: OpenRecord["from"]): void;
	/** The session screen mounts: start an open when no tap started one. */
	ensureOpen(chatId: string): void;
	/** A mark of the open of this session. A mark of another session, or a second mark, does nothing. */
	mark(chatId: string, mark: Mark): void;
	describe(chatId: string, info: { title: string; messages: number }): void;
	/** The session screen closes. An open that did not end keeps its marks with outcome "left". */
	leave(chatId: string): void;
	islandStarted(): void;
	islandEnded(): void;
	/** The island WebViews that are mounted now. */
	liveIslands(): number;
	/** The last opens, oldest first. */
	opens(): readonly OpenRecord[];
	/** True while an open runs. */
	tracing(): boolean;
	exportJson(): string;
	clear(): void;
	subscribe(listener: () => void): () => void;
}

export function createPerfStore(ports: PerfPorts): PerfStore {
	let opens: OpenRecord[] = (() => {
		try {
			return parseOpens(ports.load());
		} catch {
			return [];
		}
	})();
	let trace: Trace | null = null;
	let live = 0;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const l of listeners) l();
	};
	const exportJson = () =>
		JSON.stringify({
			v: RESULT_VERSION,
			exportedAt: ports.date().toISOString(),
			opens,
		} satisfies PerfExport);
	const persist = () => {
		try {
			ports.save(exportJson());
		} catch {
			/* the numbers stay in memory; the panel still shows them */
		}
	};

	const finish = (outcome: OpenRecord["outcome"]) => {
		const t = trace;
		if (!t) return;
		trace = null;
		t.stopFrames();
		let build: BuildInfo;
		try {
			build = ports.build();
		} catch {
			build = { type: "dev", commit: "unknown", device: "unknown", os: "unknown" };
		}
		opens = [
			...opens,
			{
				v: RESULT_VERSION,
				chatId: t.chatId,
				title: t.title,
				messages: t.messages,
				at: t.at,
				from: t.from,
				build,
				marks: t.marks,
				longestFrameMs: Math.round(t.longestFrameMs),
				islands: t.islands,
				outcome,
			},
		].slice(-LIMIT);
		persist();
		notify();
	};

	const frame = (time: number) => {
		const t = trace;
		if (!t) return;
		t.longestFrameMs = Math.max(t.longestFrameMs, time - t.lastFrame);
		t.lastFrame = time;
		if (time - t.start > TRACE_LIMIT_MS) finish("timeout");
	};

	const startOpen = (chatId: string, from: OpenRecord["from"] = "tap") => {
		// A new open ends one that is still open (it never reached the end).
		if (trace) finish("left");
		const start = ports.now();
		trace = {
			chatId,
			start,
			at: ports.date().toISOString(),
			from,
			title: "",
			messages: 0,
			marks: {},
			longestFrameMs: 0,
			lastFrame: start,
			islands: 0,
			stopFrames: () => {},
		};
		const current = trace;
		current.stopFrames = ports.frames(frame);
		notify();
	};

	return {
		startOpen,
		ensureOpen(chatId) {
			if (trace?.chatId !== chatId) startOpen(chatId, "mount");
		},
		mark(chatId, mark) {
			const t = trace;
			if (!t || t.chatId !== chatId || t.marks[mark] !== undefined) return;
			const now = ports.now();
			// A frame gap that is still open counts too (a long block before this mark).
			t.longestFrameMs = Math.max(t.longestFrameMs, now - t.lastFrame);
			t.marks[mark] = Math.round(now - t.start);
			if (mark === "atEnd") finish("end");
		},
		describe(chatId, info) {
			if (trace?.chatId !== chatId) return;
			trace.title = info.title;
			trace.messages = info.messages;
		},
		leave(chatId) {
			if (trace?.chatId === chatId) finish("left");
		},
		islandStarted() {
			live += 1;
			if (trace) trace.islands += 1;
			notify();
		},
		islandEnded() {
			live = Math.max(0, live - 1);
			notify();
		},
		liveIslands: () => live,
		opens: () => opens,
		tracing: () => trace !== null,
		exportJson,
		clear() {
			opens = [];
			persist();
			notify();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
