// Polyfills first: the shared LearnHarness code expects these web APIs.
import "@/shims/polyfills";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox } from "react-native";

import { FONT, Loading, usePalette } from "@/components/ui";
import { ConnectionProvider, useConnection } from "@/lib/connection-context";
import { FlagsProvider } from "@/lib/flags-context";
import { ServerEventsProvider } from "@/lib/server-events-context";

// Dev builds only: hide a known React Native warning that needs no action
// (it comes after a native-driven animation stops listening). Any warning
// shows a toast at the bottom of the screen for some seconds. On a small
// iPhone (SE) it covers the dock's "Send answer", so taps fail. The fork's
// require cycles are hidden in metro.config.js, because they come before
// this file runs.
LogBox.ignoreLogs(["Sending `onAnimatedValueUpdate` with no listeners registered."]);

function RootStack() {
	const { state } = useConnection();
	const c = usePalette();
	if (state.status === "loading") return <Loading />;
	const paired = state.status !== "unpaired";
	return (
		<Stack
			screenOptions={{
				headerStyle: { backgroundColor: c.bg },
				headerTintColor: c.text,
				// Screen titles in the desktop's title font (CMU Serif Bold).
				headerTitleStyle: { fontFamily: FONT.title, fontWeight: "700", fontSize: 20 },
				headerShadowVisible: true,
				// The back button is only the arrow: the screen title is too long
				// next to it (user request 2026-11-15).
				headerBackButtonDisplayMode: "minimal",
				contentStyle: { backgroundColor: c.bg },
			}}
		>
			<Stack.Protected guard={paired}>
				<Stack.Screen name="index" options={{ title: "LearnHarness" }} />
				<Stack.Screen name="settings" options={{ title: "Settings" }} />
				<Stack.Screen name="new-session" options={{ title: "New session" }} />
				<Stack.Screen name="session/[id]" options={{ title: "Session" }} />
			</Stack.Protected>
			<Stack.Protected guard={!paired}>
				<Stack.Screen name="pair" options={{ title: "Pair with your Mac" }} />
			</Stack.Protected>
		</Stack>
	);
}

export default function RootLayout() {
	return (
		<FlagsProvider>
			<ConnectionProvider>
				<ServerEventsProvider>
					<StatusBar style="auto" />
					<RootStack />
				</ServerEventsProvider>
			</ConnectionProvider>
		</FlagsProvider>
	);
}
