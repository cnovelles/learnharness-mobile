// Polyfills first: the shared LearnHarness code expects these web APIs.
import "@/shims/polyfills";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox } from "react-native";

import { useStackOptions } from "@/components/stack-options";
import { Loading } from "@/components/ui";
import { ConnectionProvider, useConnection } from "@/lib/connection-context";
import { DictationProvider } from "@/lib/dictation-context";
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
	const options = useStackOptions();
	if (state.status === "loading") return <Loading />;
	const paired = state.status !== "unpaired";
	return (
		<Stack screenOptions={options}>
			<Stack.Protected guard={paired}>
				{/* The tab bar; each tab has its own Stack and header. */}
				<Stack.Screen name="(tabs)" options={{ headerShown: false, title: "LearnHarness" }} />
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
					<DictationProvider>
						<StatusBar style="auto" />
						<RootStack />
					</DictationProvider>
				</ServerEventsProvider>
			</ConnectionProvider>
		</FlagsProvider>
	);
}
