/** Small shared UI pieces. Colors follow the system light or dark mode. */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIGHT = { bg: "#f6f6f4", panel: "#ffffff", line: "#e2e2de", text: "#1b1b1b", muted: "#6b6b6b", accent: "#2f5bd3", onAccent: "#ffffff", danger: "#c4314b", ok: "#2e8b57" };
const DARK = { bg: "#141414", panel: "#1d1d1d", line: "#2c2c2c", text: "#e5e5e5", muted: "#9a9a9a", accent: "#7aa2f7", onAccent: "#111111", danger: "#f7768e", ok: "#73c991" };
export type Palette = typeof LIGHT;

export function usePalette(): Palette {
	return useColorScheme() === "dark" ? DARK : LIGHT;
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
	const c = usePalette();
	const body = <View style={styles.inner}>{children}</View>;
	return (
		<SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["bottom", "left", "right"]}>
			{scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
		</SafeAreaView>
	);
}

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
	const c = usePalette();
	return <View style={[styles.panel, { backgroundColor: c.panel, borderColor: c.line }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
	return <Text style={[styles.title, { color: usePalette().text }]} accessibilityRole="header">{children}</Text>;
}

export function Body({ children, muted, style, testID }: { children: ReactNode; muted?: boolean; style?: TextStyle; testID?: string }) {
	const c = usePalette();
	return <Text testID={testID} style={[styles.body, { color: muted ? c.muted : c.text }, style]}>{children}</Text>;
}

export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
	return <Text testID={testID} style={[styles.body, { color: usePalette().danger }]} accessibilityRole="alert">{children}</Text>;
}

export function Button({ title, onPress, kind = "primary", disabled, busy, testID }: { title: string; onPress: () => void; kind?: "primary" | "plain" | "danger"; disabled?: boolean; busy?: boolean; testID?: string }) {
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
				{ backgroundColor: primary ? c.accent : "transparent", borderColor: primary ? c.accent : c.line, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
			]}
		>
			{busy ? <ActivityIndicator color={primary ? c.onAccent : c.text} /> : <Text style={[styles.buttonText, { color: primary ? c.onAccent : kind === "danger" ? c.danger : c.text }]}>{title}</Text>}
		</Pressable>
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
	inner: { padding: 16, gap: 16 },
	panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 10 },
	title: { fontSize: 20, fontWeight: "600" },
	body: { fontSize: 15, lineHeight: 21 },
	button: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 46 },
	buttonText: { fontSize: 16, fontWeight: "600" },
	center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
