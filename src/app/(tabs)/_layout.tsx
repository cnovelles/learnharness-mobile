/**
 * The bottom tab bar (issue 20): Teach, Practice, Graph. The system tab bar
 * (native tabs, user choice 2026-11-17): only the color is ours. The active
 * tab uses `accent` in light mode and `text` in dark mode. Sessions,
 * Settings and New session are in the root Stack, so they cover the tab bar.
 */
import { NativeTabs } from "expo-router/native-tabs";
import { useColorScheme } from "react-native";

import { usePalette } from "@/components/ui";

export default function TabsLayout() {
	const c = usePalette();
	const dark = useColorScheme() === "dark";
	return (
		<NativeTabs tintColor={dark ? c.text : c.accent}>
			<NativeTabs.Trigger name="(teach)">
				<NativeTabs.Trigger.Label>Teach</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf={{ default: "book", selected: "book.fill" }} />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="practice">
				<NativeTabs.Trigger.Label>Practice</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="target" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="graph">
				<NativeTabs.Trigger.Label>Graph</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="point.3.connected.trianglepath.dotted" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
