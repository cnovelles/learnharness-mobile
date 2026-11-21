/**
 * Fit a Markdown table to the width of its block (issue 05, wide content,
 * decision 2: tables fit the width). Pure, so Jest can test it.
 *
 * The input is the one-line width of each column's widest cell at the base
 * text size (the hidden measure layer). The steps:
 *
 * 1. The table fits as it is: each column keeps its width (up to `maxCol`).
 * 2. Else the text shrinks, down to `minFontScale` (13 pt for 16 pt text).
 * 3. Still too wide at the smallest text: narrow columns keep their width,
 *    and the wide columns share the rest equally (max-min fair share). Their
 *    words wrap. A column is never narrower than `minCol`.
 */

export type TableFit = {
	/** The text scale of the cells (1 is the base size). */
	fontScale: number;
	/** The width of each column in points, with its padding. */
	widths: number[];
	/** True when the table is smaller or wraps more than at its natural size. */
	fitted: boolean;
};

export type TableFitOptions = {
	/** The right padding of each cell. */
	pad: number;
	/** The widest column at its natural size, with its padding. */
	maxCol: number;
	/** The narrowest column, with its padding. */
	minCol: number;
	/** The smallest text scale. */
	minFontScale: number;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Max-min fair shares of `total` for columns that want `wants`. */
function fairShares(wants: readonly number[], total: number): number[] {
	const shares = wants.map(() => 0);
	const order = wants.map((_, i) => i).sort((a, b) => wants[a]! - wants[b]!);
	let left = total;
	let count = order.length;
	for (const i of order) {
		const share = left / count;
		shares[i] = Math.min(wants[i]!, share);
		left -= shares[i]!;
		count -= 1;
	}
	return shares;
}

export function fitColumns(
	textWidths: readonly number[],
	available: number,
	{ pad, maxCol, minCol, minFontScale }: TableFitOptions,
): TableFit {
	const text = textWidths.map((w) => clamp(Number.isFinite(w) ? Math.ceil(w) : 0, 0, maxCol - pad));
	const natural = text.map((w) => clamp(w + pad, minCol, maxCol));
	const total = natural.reduce((a, b) => a + b, 0);
	if (!(available > 0) || total <= available) {
		return { fontScale: 1, widths: natural, fitted: false };
	}
	const n = text.length;
	const textTotal = text.reduce((a, b) => a + b, 0);
	const room = available - n * pad;
	const scale = textTotal > 0 ? clamp(room / textTotal, minFontScale, 1) : 1;
	const scaled = text.map((w) => w * scale);
	if (scaled.reduce((a, b) => a + b, 0) <= room) {
		return {
			fontScale: scale,
			widths: scaled.map((w) => Math.max(minCol, Math.ceil(w) + pad)),
			fitted: true,
		};
	}
	const shares = fairShares(scaled, Math.max(0, room));
	return {
		fontScale: scale,
		// A column that got all it wants rounds up, so its words do not wrap.
		widths: shares.map((w, i) =>
			Math.max(minCol, (w >= scaled[i]! ? Math.ceil(w) : Math.floor(w)) + pad),
		),
		fitted: true,
	};
}
