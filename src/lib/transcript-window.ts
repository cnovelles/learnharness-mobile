/**
 * The page window of the transcript (issue 21 slice D, D-014). The phone
 * keeps the whole session record (SessionModel), but the screen draws only
 * the rows from `start` to the end: first the last page, then one more page
 * of older rows each time the reader comes near the top. New rows at the
 * end always show. The window changes only what the screen draws, never
 * the record or what the phone sends to the Mac.
 */
import type { ScrollMetrics } from "@/components/island-viewport";

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
