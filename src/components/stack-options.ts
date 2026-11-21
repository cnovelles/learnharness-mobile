/**
 * The header look of every Stack: the root Stack and the Stack in each tab
 * use the same options, so a tab header and a pushed screen look the same.
 */
import type { NativeStackNavigationOptions } from "expo-router/native-stack";

import { FONT, usePalette } from "./ui";

export function useStackOptions(): NativeStackNavigationOptions {
	const c = usePalette();
	return {
		headerStyle: { backgroundColor: c.bg },
		headerTintColor: c.text,
		// Screen titles in the desktop's title font (CMU Serif Bold).
		headerTitleStyle: { fontFamily: FONT.title, fontWeight: "700", fontSize: 20 },
		headerShadowVisible: true,
		// The back button is only the arrow: the screen title is too long
		// next to it (user request 2026-11-15).
		headerBackButtonDisplayMode: "minimal",
		contentStyle: { backgroundColor: c.bg },
	};
}
