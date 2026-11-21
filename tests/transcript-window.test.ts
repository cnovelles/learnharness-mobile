/**
 * The page window of the transcript (issue 21 slice D, D-014): the screen
 * draws only the last rows, and adds a page of older rows near the top.
 */
import {
	PAGE_ROWS,
	earlierStart,
	firstStart,
	keepStart,
	wantsEarlier,
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
