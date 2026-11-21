/**
 * The spacing scale of the app (user decision 2026-11-15, option A): a
 * 4-point grid. Every padding, margin and gap uses one of these names, so
 * all screens have the same rhythm on each iPhone size. The values are
 * points: iOS points already match each screen's pixel density, and the
 * text does not grow with the screen width, so the spacing stays fixed too.
 *
 * ESLint (`SPACING_RULES` in eslint.config.js) blocks a number in a
 * padding, margin or gap. Sizes (a minimum height, a tap target) and
 * borders are not spacing.
 */
export const SPACE = {
	/** A small gap: between a title and its subtitle, inside a label. */
	xs: 4,
	/** The gap between items in a card or a row. */
	sm: 8,
	/** The padding of a card or a field; the gap between transcript blocks. */
	md: 12,
	/** The padding of a screen or a panel. */
	lg: 16,
	xl: 24,
	/** The space at the end of a long list. */
	xxl: 32,
} as const;

export type SpaceName = keyof typeof SPACE;
