/** Small shared UI pieces. Colors follow the system light or dark mode. */
import type { ReactNode } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	useColorScheme,
	View,
	type TextStyle,
	type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
	/** Code block background: the page mixed with black. */
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
	codeBg: "#111111",
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
	codeBg: "#f0efeb",
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

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
	const c = usePalette();
	const body = <View style={styles.inner}>{children}</View>;
	return (
		<SafeAreaView
			style={[styles.screen, { backgroundColor: c.bg }]}
			edges={["bottom", "left", "right"]}
		>
			{scroll ? (
				<ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
	disabled,
	busy,
	testID,
}: {
	title: string;
	onPress: () => void;
	kind?: "primary" | "plain" | "danger";
	disabled?: boolean;
	busy?: boolean;
	testID?: string;
}) {
	const c = usePalette();
	const primary = kind === "primary";
	return (
		<Pressable
			testID={testID}
			accessibilityRole="button"
			accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
			disabled={disabled || busy}
			onPress={onPress}
			style={({ pressed }) => [
				styles.button,
				{
					backgroundColor: primary ? c.primary : "transparent",
					borderColor: primary ? c.primary : c.line,
					opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
				},
			]}
		>
			{busy ? (
				<ActivityIndicator color={primary ? c.onPrimary : c.text} />
			) : (
				<Text
					style={[
						styles.buttonText,
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

export function Loading() {
	const c = usePalette();
	return (
		<View style={[styles.center, { backgroundColor: c.bg }]}>
			<ActivityIndicator color={c.muted} />
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	scroll: { flexGrow: 1 },
	inner: { padding: SPACE.lg, gap: SPACE.lg },
	panel: {
		borderWidth: 1,
		borderRadius: 12,
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
	center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
