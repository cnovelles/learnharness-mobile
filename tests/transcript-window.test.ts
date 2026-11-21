/**
 * The page window of the transcript (issue 21 slice D, D-014): the screen
 * draws only the last rows, and adds a page of older rows near the top.
 */
import type { LhViewMessage } from "@/lib/shared";
import { transcriptRows } from "@/lib/transcript";
import {
	PAGE_ROWS,
	earlierStart,
	firstStart,
	keepStart,
	keepWindow,
	laterEnd,
	messageRow,
	openWindow,
	wantsEarlier,
	wantsLater,
} from "@/lib/transcript-window";

describe("the page window", () => {
	it("starts with the last page, or with all rows of a short session", () => {
		expect(firstStart(407)).toBe(407 - PAGE_ROWS);
		expect(firstStart(PAGE_ROWS)).toBe(0);
		expect(firstStart(3)).toBe(0);
		expect(firstStart(0)).toBe(0);
	});

	it("adds one page of older rows, and stops at the first row", () => {
		expect(earlierStart(100)).toBe(100 - PAGE_ROWS);
		expect(earlierStart(10)).toBe(0);
		expect(earlierStart(0)).toBe(0);
	});

	it("keeps the start when rows come at the end, and clamps it when rows go", () => {
		expect(keepStart(377, 420)).toBe(377);
		// A sync that gives a shorter record: the window shows its last page.
		expect(keepStart(377, 40)).toBe(40 - PAGE_ROWS);
		expect(keepStart(5, 3)).toBe(0);
	});

	it("wants older rows within one screen of the top, only when rows are hidden", () => {
		const m = { offset: 500, visible: 800, content: 4000 };
		expect(wantsEarlier(m, 10)).toBe(true);
		expect(wantsEarlier({ ...m, offset: 900 }, 10)).toBe(false);
		expect(wantsEarlier(m, 0)).toBe(false);
		// Not measured yet: no page.
		expect(wantsEarlier({ offset: 0, visible: 0, content: 0 }, 10)).toBe(false);
	});
});

describe("the open at a message (issue 08 slice C2)", () => {
	const view = (messages: Partial<LhViewMessage>[]) => messages as LhViewMessage[];
	const messages = view([
		{ id: "u1", role: "user", parts: [{ type: "text", id: "u1-t0", text: "Hello" }] },
		{
			id: "a1",
			role: "assistant",
			parts: [
				{ type: "reasoning", id: "a1-r0", text: "Think" },
				{ type: "text", id: "a1-t0", text: "  " },
				{ type: "text", id: "a1-t1", text: "The first passage." },
				{ type: "text", id: "a1-t2", text: "The second passage." },
			],
		},
		{ id: "a2", role: "assistant", parts: [{ type: "text", id: "a2-t0", text: "Later." }] },
	]);

	it("finds the row of the message's first teacher text (the desktop anchor)", () => {
		const rows = transcriptRows(messages);
		const row = messageRow(rows, messages, "a1");
		expect(row).not.toBeNull();
		expect(rows[row!]).toMatchObject({ kind: "text", id: "a1-t1" });
		expect(rows[messageRow(rows, messages, "a2")!]).toMatchObject({ id: "a2-t0" });
	});

	it("a message that is not in the record, a user message or no message gives no row (state 15)", () => {
		const rows = transcriptRows(messages);
		expect(messageRow(rows, messages, "gone")).toBeNull();
		expect(messageRow(rows, messages, "u1")).toBeNull();
		expect(messageRow(rows, messages, null)).toBeNull();
		expect(messageRow(rows, messages, "")).toBeNull();
	});

	it("opens one page from the message's row; with no row, the last page", () => {
		expect(openWindow(407, 100)).toEqual({ start: 100, end: 100 + PAGE_ROWS });
		// The page reaches the end: the window follows the end.
		expect(openWindow(407, 400)).toEqual({ start: 400, end: null });
		expect(openWindow(407, null)).toEqual({ start: 407 - PAGE_ROWS, end: null });
		// A row out of the record is the normal open.
		expect(openWindow(10, 12)).toEqual({ start: 0, end: null });
	});

	it("adds one page of later rows near the bottom, and then follows the end", () => {
		expect(laterEnd(130, 407)).toBe(130 + PAGE_ROWS);
		expect(laterEnd(390, 407)).toBeNull();
		const m = { offset: 3000, visible: 800, content: 4000 };
		expect(wantsLater(m, 130)).toBe(true);
		expect(wantsLater({ ...m, offset: 1000 }, 130)).toBe(false);
		expect(wantsLater(m, null)).toBe(false);
		expect(wantsLater({ offset: 0, visible: 0, content: 0 }, 130)).toBe(false);
	});

	it("keeps the window when rows change, and follows the end when the window is past it", () => {
		expect(keepWindow({ start: 100, end: 130 }, 420)).toEqual({ start: 100, end: 130 });
		expect(keepWindow({ start: 100, end: null }, 420)).toEqual({ start: 100, end: null });
		expect(keepWindow({ start: 100, end: 130 }, 120)).toEqual({ start: 100, end: null });
		expect(keepWindow({ start: 100, end: 130 }, 40)).toEqual({ start: 40 - PAGE_ROWS, end: null });
	});
});
