/** Small shared UI pieces. Colors follow the system light or dark mode. */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
	AccessibilityInfo,
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	useColorScheme,
	View,
	type RefreshControlProps,
	type TextStyle,
	type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import Svg, { Circle } from "react-native-svg";
import type { UserMessage } from "@/lib/user-error";
import { SPACE } from "./spacing";

/**
 * The desktop's colors (issue 18, user decision 2026-11-15). Dark mode is
 * the desktop's default theme (fork app/globals.css); light mode is its
 * built-in Ivory theme (fork src/core/themes.ts).
 */
export interface Palette {
	/** The page. */
	bg: string;
	/** Cards, the composer, the user band (`--card`). */
	panel: string;
	/** Borders (`--border`). */
	line: string;
	/** Strong lines: plan graph boxes and arrows (`--lh-line-strong`). */
	lineStrong: string;
	text: string;
	muted: string;
	/** A selected option, a pressed row (`--accent`, the hover surface). */
	hover: string;
	/** Filled buttons and the selected border (`--primary`). */
	primary: string;
	onPrimary: string;
	/** Links and list markers (`--lh-accent`). */
	accent: string;
	onAccent: string;
	/** Bold, italic and inline code text (`--lh-ink-strong`, `-italic`, `-code`). */
	strong: string;
	italic: string;
	code: string;
	/** Code block and inline code background: the page mixed with black in
	 *  oklab, 86% (dark) or 96% (light), as the desktop `color-mix`. */
	codeBg: string;
	danger: string;
	ok: string;
	warning: string;
}

const DARK: Palette = {
	bg: "#141414",
	panel: "#1c1c1c",
	line: "#434343",
	lineStrong: "#e6e6e6",
	text: "#e6e6e6",
	muted: "#8d8d8d",
	hover: "#2a2a2a",
	primary: "#e6e6e6",
	onPrimary: "#141414",
	accent: "#8d8d8d",
	onAccent: "#141414",
	strong: "#e6e6e6",
	italic: "#e6e6e6",
	code: "#e6e6e6",
	codeBg: "#0e0e0e",
	danger: "#ef4444",
	ok: "#22c55e",
	warning: "#f59e0b",
};
const LIGHT: Palette = {
	bg: "#faf9f5",
	panel: "#f0eee6",
	line: "#e0ddd2",
	lineStrong: "#3d3d3a",
	text: "#3d3d3a",
	muted: "#83827d",
	hover: "#e2e0d8",
	primary: "#3d3d3a",
	onPrimary: "#faf9f5",
	accent: "#d97757",
	onAccent: "#faf9f5",
	strong: "#3266c9",
	italic: "#3f8f6b",
	code: "#c4613f",
	codeBg: "#edece8",
	danger: "#c43d3d",
	ok: "#3f8f6b",
	warning: "#b8822a",
};

/**
 * The desktop's fonts, embedded in the app (`expo-font` in app.json). iOS
 * picks the weight and the italic inside a family, so `fontWeight` and
 * `fontStyle` work as usual.
 */
export const FONT = {
	/** The UI, the small-caps labels and code (desktop `--font-ui`). */
	ui: "JetBrains Mono",
	/** Reading text and inputs (desktop `--font-prose`). */
	prose: "Source Sans 3",
	/** Session titles (desktop `--font-title`, CMU Serif Bold). */
	title: "CMU Serif",
} as const;

/** The desktop's type scale (fork globals.css `--text-*`), in points. */
export const TYPE = {
	xs: { fontSize: 11, lineHeight: 15 },
	sm: { fontSize: 12.5, lineHeight: 17.5 },
	base: { fontSize: 14, lineHeight: 20 },
	lg: { fontSize: 16, lineHeight: 23 },
	xl: { fontSize: 20, lineHeight: 28 },
	xxl: { fontSize: 25, lineHeight: 32.5 },
	xxxl: { fontSize: 32, lineHeight: 40 },
	/** Reading text: 16 at line height 1.5. */
	prose: { fontSize: 16, lineHeight: 24 },
} as const;

/** The small-caps label (desktop `text-xs font-medium uppercase tracking-wide`). */
export const LABEL: TextStyle = {
	fontFamily: FONT.ui,
	fontSize: 11,
	lineHeight: 15,
	fontWeight: "500",
	letterSpacing: 0.275,
	textTransform: "uppercase",
};

/** A palette color at an opacity, as the desktop's `color/NN` classes. */
export function alpha(hex: string, opacity: number): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) return hex;
	const n = parseInt(m[1], 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

export function usePalette(): Palette {
	return useColorScheme() === "dark" ? DARK : LIGHT;
}

export function Screen({
	children,
	scroll = true,
	refreshControl,
}: {
	children: ReactNode;
	scroll?: boolean;
	/** Pull to refresh (a `RefreshControl`). */
	refreshControl?: ReactElement<RefreshControlProps>;
}) {
	const c = usePalette();
	const body = <View style={styles.inner}>{children}</View>;
	return (
		<SafeAreaView
			style={[styles.screen, { backgroundColor: c.bg }]}
			edges={["bottom", "left", "right"]}
		>
			{scroll ? (
				<ScrollView
					contentContainerStyle={styles.scroll}
					keyboardShouldPersistTaps="handled"
					refreshControl={refreshControl}
				>
					{body}
				</ScrollView>
			) : (
				body
			)}
		</SafeAreaView>
	);
}

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
	const c = usePalette();
	return (
		<View style={[styles.panel, { backgroundColor: c.panel, borderColor: c.line }, style]}>
			{children}
		</View>
	);
}

export function Title({ children }: { children: ReactNode }) {
	return (
		<Text style={[styles.title, { color: usePalette().text }]} accessibilityRole="header">
			{children}
		</Text>
	);
}

export function Body({
	children,
	muted,
	style,
	testID,
}: {
	children: ReactNode;
	muted?: boolean;
	style?: TextStyle;
	testID?: string;
}) {
	const c = usePalette();
	return (
		<Text testID={testID} style={[styles.body, { color: muted ? c.muted : c.text }, style]}>
			{children}
		</Text>
	);
}

/**
 * Error text on the screen. It takes only a UserMessage, so raw server or
 * exception text cannot get here (see src/lib/user-error.ts and AGENTS.md).
 */
export function ErrorText({ children, testID }: { children: UserMessage; testID?: string }) {
	return (
		<Text
			testID={testID}
			style={[styles.body, { color: usePalette().danger }]}
			accessibilityRole="alert"
		>
			{children}
		</Text>
	);
}

export function Button({
	title,
	onPress,
	kind = "primary",
	size = "md",
	disabled,
	busy,
	testID,
}: {
	title: string;
	onPress: () => void;
	kind?: "primary" | "plain" | "danger";
	/** `sm`: the desktop's small outline button (banners, rows). */
	size?: "md" | "sm";
	disabled?: boolean;
	busy?: boolean;
	testID?: string;
}) {
	const c = usePalette();
	const primary = kind === "primary";
	const small = size === "sm";
	return (
		<Pressable
			testID={testID}
			accessibilityRole="button"
			accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
			disabled={disabled || busy}
			onPress={onPress}
			hitSlop={small ? SPACE.sm : undefined}
			style={({ pressed }) => [
				styles.button,
				small ? styles.buttonSm : null,
				{
					// danger: the desktop's quiet destructive button, the error color
					// at 50% for the line and 10% for the fill.
					backgroundColor: primary
						? c.primary
						: kind === "danger"
							? alpha(c.danger, 0.1)
							: "transparent",
					borderColor: primary ? c.primary : kind === "danger" ? alpha(c.danger, 0.5) : c.line,
					opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
				},
			]}
		>
			{busy ? (
				<ActivityIndicator color={primary ? c.onPrimary : c.text} />
			) : (
				<Text
					style={[
						small ? styles.buttonTextSm : styles.buttonText,
						{ color: primary ? c.onPrimary : kind === "danger" ? c.danger : c.text },
					]}
				>
					{title}
				</Text>
			)}
		</Pressable>
	);
}

/** A text field in the app style. Pass `multiline` for long text. */
export function Field({
	value,
	onChangeText,
	label,
	placeholder,
	multiline,
	editable = true,
	testID,
}: {
	value: string;
	onChangeText: (text: string) => void;
	/** The accessibility label (read by VoiceOver; the screen shows its own label). */
	label: string;
	placeholder?: string;
	multiline?: boolean;
	editable?: boolean;
	testID?: string;
}) {
	const c = usePalette();
	return (
		<TextInput
			testID={testID}
			accessibilityLabel={label}
			value={value}
			onChangeText={onChangeText}
			placeholder={placeholder}
			placeholderTextColor={c.muted}
			multiline={multiline}
			editable={editable}
			style={[
				styles.field,
				multiline ? styles.fieldMulti : null,
				{ color: c.text, borderColor: c.line, backgroundColor: c.bg },
			]}
		/>
	);
}

/** A screen that waits: the desktop's braille spinner in the middle. */
export function Loading() {
	const c = usePalette();
	return (
		<View style={[styles.center, { backgroundColor: c.bg }]}>
			<Spinner size={18} />
		</View>
	);
}

/** An SF Symbol in a palette color. The size is in points. */
export function Icon({
	name,
	size = 16,
	color,
}: {
	name: SymbolViewProps["name"];
	size?: number;
	color: string;
}) {
	return <SymbolView name={name} size={size} tintColor={color} weight="medium" />;
}

/**
 * The desktop's BrailleSpinner (fork components/braille-spinner.tsx): the
 * frames of ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ drawn as dots on a 2 x 3 grid (viewBox 4 x 8, as the desktop), 80 ms each. With
 * Reduce Motion on, the first frame stays.
 */
export const SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const DOTS: [number, number][] = [
	[1, 1],
	[1, 3],
	[1, 5],
	[3, 1],
	[3, 3],
	[3, 5],
];

/** The dots (1–6 in braille order) of a braille character. */
export function brailleDots(char: string): number[] {
	const bits = (char.codePointAt(0) ?? 0x2800) - 0x2800;
	return DOTS.map((_, i) => i).filter((i) => (bits >> i) & 1);
}

export function Spinner({ size = 12, color }: { size?: number; color?: string }) {
	const c = usePalette();
	const [frame, setFrame] = useState(0);
	const [still, setStill] = useState(false);
	useEffect(() => {
		let live = true;
		AccessibilityInfo.isReduceMotionEnabled()
			.then((on) => live && setStill(on))
			.catch(() => {});
		const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
		return () => {
			live = false;
			sub.remove();
		};
	}, []);
	useEffect(() => {
		if (still) return;
		const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
		return () => clearInterval(id);
	}, [still]);
	const dots = brailleDots(SPINNER_FRAMES[still ? 0 : frame]!);
	return (
		<Svg
			width={size / 2}
			height={size}
			viewBox="0 0 4 8"
			accessibilityRole="progressbar"
			accessibilityLabel="Working"
		>
			{dots.map((i) => (
				<Circle key={i} cx={DOTS[i]![0]} cy={DOTS[i]![1]} r={0.8} fill={color ?? c.text} />
			))}
		</Svg>
	);
}

/** The desktop's pending line: the spinner and a small-caps label ("THINKING…"). */
export function StatusLine({ children, testID }: { children: string; testID?: string }) {
	const c = usePalette();
	return (
		<View style={styles.statusLine} testID={testID} accessibilityLiveRegion="polite">
			<Spinner />
			<Text style={[LABEL, { color: c.muted }]}>{children}</Text>
		</View>
	);
}

/** A small-caps section label ("SESSIONS"): the desktop's `tracking-widest`. */
export function SectionLabel({
	children,
	strong,
	testID,
}: {
	children: string;
	strong?: boolean;
	testID?: string;
}) {
	const c = usePalette();
	return (
		<Text
			accessibilityRole="header"
			testID={testID}
			style={[
				LABEL,
				styles.sectionLabel,
				strong ? styles.sectionStrong : null,
				{ color: strong ? c.text : alpha(c.muted, 0.7) },
			]}
		>
			{children}
		</Text>
	);
}

/** A desktop SettingsSection: the strong small-caps heading, a hint, the rows. */
export function Section({
	title,
	hint,
	children,
	first,
	testID,
}: {
	title: string;
	hint?: string;
	children: ReactNode;
	first?: boolean;
	/** The test ID of the heading. */
	testID?: string;
}) {
	const c = usePalette();
	return (
		<View
			style={[
				styles.section,
				first ? styles.first : { borderTopWidth: 1, borderColor: alpha(c.line, 0.6) },
			]}
		>
			<SectionLabel strong testID={testID}>
				{title}
			</SectionLabel>
			{hint ? <Text style={[styles.hint, { color: c.muted }]}>{hint}</Text> : null}
			<View style={styles.sectionBody}>{children}</View>
		</View>
	);
}

/**
 * The desktop's turn error banner: the error color at 50% for the line and
 * 10% for the fill, rounded-lg. It takes only a UserMessage.
 */
export function ErrorBanner({
	text,
	actions,
	testID,
}: {
	text: UserMessage;
	actions?: ReactNode;
	testID?: string;
}) {
	const c = usePalette();
	return (
		<View
			style={[
				styles.banner,
				{ borderColor: alpha(c.danger, 0.5), backgroundColor: alpha(c.danger, 0.1) },
			]}
		>
			<Text
				testID={testID}
				accessibilityRole="alert"
				style={[styles.bannerText, { color: c.text }]}
			>
				{text}
			</Text>
			{actions ? <View style={styles.bannerActions}>{actions}</View> : null}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	scroll: { flexGrow: 1 },
	inner: { padding: SPACE.lg, gap: SPACE.lg },
	/** The desktop card: `rounded-xl` is 16 in the fork's radius ladder. */
	panel: {
		borderWidth: 1,
		borderRadius: 16,
		padding: SPACE.lg,
		gap: SPACE.md,
	},
	/** Screen titles: the desktop's title font (CMU Serif Bold). */
	title: { ...TYPE.xxl, fontFamily: FONT.title, fontWeight: "700" },
	body: { ...TYPE.lg, fontFamily: FONT.prose },
	/** Inputs: the prose font. */
	field: {
		borderWidth: 1,
		borderRadius: 10,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.md,
		fontSize: 16,
		fontFamily: FONT.prose,
	},
	fieldMulti: { minHeight: 72, textAlignVertical: "top" },
	/** Buttons: the desktop's ink buttons (`--primary`) with mono text. */
	button: {
		borderWidth: 1,
		borderRadius: 8,
		paddingVertical: SPACE.md,
		paddingHorizontal: SPACE.lg,
		alignItems: "center",
		justifyContent: "center",
		minHeight: 46,
	},
	buttonText: { ...TYPE.base, fontFamily: FONT.ui, fontWeight: "500" },
	/** The desktop's `xs` outline button: 11 pt mono, rounded-md. */
	buttonSm: { minHeight: 32, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.md },
	buttonTextSm: { ...LABEL },
	center: { flex: 1, alignItems: "center", justifyContent: "center" },
	statusLine: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	sectionLabel: { letterSpacing: 1.1 },
	section: { paddingTop: SPACE.lg, gap: SPACE.xs },
	first: { paddingTop: 0 },
	sectionBody: { marginTop: SPACE.md, gap: SPACE.md },
	hint: { ...TYPE.xs, fontFamily: FONT.ui },
	sectionStrong: { ...TYPE.sm, letterSpacing: 1.25 },
	banner: {
		borderWidth: 1,
		borderRadius: 12,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
		gap: SPACE.sm,
	},
	bannerText: { ...TYPE.base, fontFamily: FONT.prose },
	bannerActions: { flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" },
});
