/**
 * Issue 22 (palette "Grove"): every text pair of both palettes passes WCAG
 * AA (4.5:1). The status inks and the hover surface pass 3:1 (large text
 * and UI parts).
 */
import { PALETTES, type Palette } from "@/components/ui";

function luminance(hex: string): number {
	const c = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
	["text", "bg"],
	["text", "panel"],
	["muted", "bg"],
	["muted", "panel"],
	["onPrimary", "primary"],
	["onAccent", "accent"],
	["accent", "bg"],
	["strong", "bg"],
	["italic", "bg"],
	["code", "codeBg"],
	["danger", "bg"],
];
const UI_PAIRS: [keyof Palette, keyof Palette][] = [
	["ok", "bg"],
	["warning", "bg"],
	["primary", "bg"],
];

describe.each(["dark", "light"] as const)("the %s palette", (mode) => {
	const p = PALETTES[mode];

	it.each(TEXT_PAIRS)("%s on %s passes 4.5:1", (fg, bg) => {
		expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
	});

	it.each(UI_PAIRS)("%s on %s passes 3:1", (fg, bg) => {
		expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
	});
});
