// Polyfills first: the shared LearnHarness code expects these web APIs.
import "@/shims/polyfills";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Loading, usePalette } from "@/components/ui";
import { ConnectionProvider, useConnection } from "@/lib/connection-context";

function RootStack() {
	const { state } = useConnection();
	const c = usePalette();
	if (state.status === "loading") return <Loading />;
	const paired = state.status !== "unpaired";
	return (
		<Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
			<Stack.Protected guard={paired}>
				<Stack.Screen name="index" options={{ title: "LearnHarness" }} />
				<Stack.Screen name="settings" options={{ title: "Settings" }} />
			</Stack.Protected>
			<Stack.Protected guard={!paired}>
				<Stack.Screen name="pair" options={{ title: "Pair with your Mac" }} />
			</Stack.Protected>
		</Stack>
	);
}

export default function RootLayout() {
	return (
		<ConnectionProvider>
			<StatusBar style="auto" />
			<RootStack />
		</ConnectionProvider>
	);
}
