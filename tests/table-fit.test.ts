/**
 * Issue 05, wide content, slice A: a table fits the width of its block.
 */
import { fitColumns } from "@/lib/table-fit";

const OPTS = { pad: 12, maxCol: 240, minCol: 32, minFontScale: 13 / 16 };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("fitColumns", () => {
	it("keeps the natural widths when the table fits", () => {
		const fit = fitColumns([40, 70], 300, OPTS);
		expect(fit).toEqual({ fontScale: 1, widths: [52, 82], fitted: false });
	});

	it("caps a long cell at the widest column, as before", () => {
		expect(fitColumns([600], 1000, OPTS).widths).toEqual([240]);
	});

	it("shrinks the text first, down to 13 pt", () => {
		// 3 columns of text 100 = 300 + 36 padding; 310 points of room.
		const fit = fitColumns([100, 100, 100], 310, OPTS);
		expect(fit.fitted).toBe(true);
		expect(fit.fontScale).toBeCloseTo((310 - 36) / 300);
		expect(sum(fit.widths)).toBeLessThanOrEqual(313);
	});

	it("W3. then lets the narrow columns keep their width and the wide ones wrap", () => {
		// The SE: 343 points; "Near" is narrow, the note is long.
		const fit = fitColumns([40, 90, 60, 228], 343, OPTS);
		expect(fit.fontScale).toBe(13 / 16);
		const [side, distance, pull, note] = fit.widths;
		expect(side).toBe(Math.ceil(40 * (13 / 16)) + 12);
		expect(distance).toBe(Math.ceil(90 * (13 / 16)) + 12);
		expect(pull).toBe(Math.ceil(60 * (13 / 16)) + 12);
		expect(note).toBeLessThan(Math.ceil(228 * (13 / 16)) + 12);
		expect(sum(fit.widths)).toBeLessThanOrEqual(343 + 3);
	});

	it("shares the room equally among columns that are all wide", () => {
		const fit = fitColumns([228, 228, 228], 300, OPTS);
		const [a, b, c] = fit.widths;
		expect(a).toBe(b);
		expect(b).toBe(c);
		expect(sum(fit.widths)).toBeLessThanOrEqual(300);
	});

	it("never makes a column narrower than the minimum", () => {
		const fit = fitColumns(Array(20).fill(100), 300, OPTS);
		for (const w of fit.widths) expect(w).toBeGreaterThanOrEqual(32);
	});

	it("W2. keeps the natural widths before the block width is known", () => {
		expect(fitColumns([500, 500], 0, OPTS).fitted).toBe(false);
	});

	it("reads a bad width as an empty column", () => {
		expect(fitColumns([Number.NaN, 20], 400, OPTS).widths).toEqual([32, 32]);
	});
});
