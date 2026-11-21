/**
 * The page window of the transcript (issue 21 slice D, D-014). The phone
 * keeps the whole session record (SessionModel), but the screen draws only
 * the rows from `start` to the end: first the last page, then one more page
 * of older rows each time the reader comes near the top. New rows at the
 * end always show. The window changes only what the screen draws, never
 * the record or what the phone sends to the Mac.
 *
 * A graph link (issue 08 slice C2) opens the session at a message: the
 * window starts at that message's row and has an end, one page later.
 * Near the bottom, one more page of later rows comes in, until the window
 * reaches the end and follows it again.
 */
import type { ScrollMetrics } from "@/components/island-viewport";
import { firstSourceTextParts, type LhViewMessage } from "./shared";
import type { TranscriptRow } from "./transcript";

/** The rows in one page. */
export const PAGE_ROWS = 30;

/** The first row to draw when the session opens: the last page. */
export function firstStart(total: number): number {
	return Math.max(0, total - PAGE_ROWS);
}

/** The first row to draw after one more page of older rows. */
export function earlierStart(start: number): number {
	return Math.max(0, start - PAGE_ROWS);
}

/**
 * The start after the rows changed. Rows at the end keep it. A shorter
 * record (a sync) can put it after the end: then show the last page.
 */
export function keepStart(start: number, total: number): number {
	return start <= Math.max(0, total - 1) ? start : firstStart(total);
}

/** The reader is within one screen of the top, and older rows are not drawn. */
export function wantsEarlier(m: ScrollMetrics, start: number): boolean {
	return start > 0 && m.visible > 0 && m.offset < m.visible;
}

/** The rows that the screen draws: from `start` to `end` (null: to the end, with new rows). */
export interface PageWindow {
	start: number;
	end: number | null;
}

/**
 * The row of a message: the row of its first teacher text, as the desktop
 * anchor (`firstSourceTextParts`). Null when the message is not in the
 * record or has no teacher text (state 15: the normal open).
 */
export function messageRow(
	rows: readonly TranscriptRow[],
	messages: readonly LhViewMessage[],
	messageId: string | null | undefined,
): number | null {
	if (!messageId) return null;
	const partId = firstSourceTextParts(messages).get(messageId);
	if (!partId) return null;
	const row = rows.findIndex((r) => r.kind === "text" && r.id === partId);
	return row < 0 ? null : row;
}

/** The window when the session opens: one page from `target`, or the last page. */
export function openWindow(total: number, target: number | null): PageWindow {
	if (target === null || target < 0 || target >= total)
		return { start: firstStart(total), end: null };
	const end = target + PAGE_ROWS;
	return { start: target, end: end >= total ? null : end };
}

/** The end after one more page of later rows; null when it reaches the end. */
export function laterEnd(end: number, total: number): number | null {
	const next = end + PAGE_ROWS;
	return next >= total ? null : next;
}

/** The window after the rows changed (see keepStart). An end past the rows follows the end. */
export function keepWindow(w: PageWindow, total: number): PageWindow {
	const start = keepStart(w.start, total);
	const end = w.end !== null && w.end < total && w.end > start ? w.end : null;
	return start === w.start && end === w.end ? w : { start, end };
}

/** The reader is within one screen of the bottom, and later rows are not drawn. */
export function wantsLater(m: ScrollMetrics, end: number | null): boolean {
	return end !== null && m.visible > 0 && m.content - (m.offset + m.visible) < m.visible;
}
