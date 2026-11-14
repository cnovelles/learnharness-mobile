/**
 * Settings: the paired Mac, the address in use, "Forget this Mac", and the
 * hidden developer section (feature flags). Tap "Version" 7 times to open
 * the developer section on this phone. Development builds always show it.
 */
import Constants from "expo-constants";
import { useRef, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";

import { Body, Button, ErrorText, Panel, Screen, Title } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import { MODES } from "@/lib/feature-flags";
import { useFlags } from "@/lib/flags-context";

const UNLOCK_TAPS = 7;

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function DeveloperSection() {
	const { state, store } = useFlags();
	const [error, setError] = useState<string | null>(null);

	async function run(action: () => Promise<void>) {
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<Panel>
			<Title>Developer: modes</Title>
			<Body muted>
				Turn modes on or off on this phone only. A mode that is not built yet has no effect. Your
				lessons and data stay on this phone when you turn a mode off.
			</Body>
			{MODES.map((mode) => (
				<View
					key={mode.id}
					style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}
				>
					<View style={{ flex: 1 }}>
						<Body>{mode.title}</Body>
						<Body muted>{mode.detail}</Body>
					</View>
					<Switch
						testID={`flag-${mode.id}`}
						accessibilityLabel={mode.title}
						value={state.flags[mode.id]}
						onValueChange={(value) => void run(() => store.set(mode.id, value))}
					/>
				</View>
			))}
			{error ? <ErrorText testID="flags-error">{error}</ErrorText> : null}
			<Button
				title="Use the build defaults"
				kind="plain"
				onPress={() => void run(() => store.reset())}
				testID="flags-reset"
			/>
		</Panel>
	);
}

export default function SettingsScreen() {
	const { state, monitor } = useConnection();
	const flags = useFlags();
	const taps = useRef(0);
	if (!("connection" in state)) return null;
	const { connection } = state;
	const address = state.status === "connected" ? state.url : "None (the Mac is not reachable now)";
	const showDeveloper = __DEV__ || flags.state.developer;

	function confirmForget() {
		Alert.alert(
			"Forget this Mac?",
			`This phone deletes its pairing with ${connection.name}. To connect again, you must scan a new QR code. To remove this phone from the Mac too, use "Phone Access…" on the Mac.`,
			[
				{ text: "Cancel", style: "cancel" },
				{ text: "Forget", style: "destructive", onPress: () => void monitor.forget() },
			],
		);
	}

	function tapVersion() {
		taps.current += 1;
		if (taps.current >= UNLOCK_TAPS && !flags.state.developer) {
			flags.store
				.unlockDeveloper()
				.catch((e: unknown) => console.warn("developer unlock failed", e));
		}
	}

	return (
		<Screen>
			<Panel>
				<Title>Mac</Title>
				<Body testID="mac-name">{connection.name}</Body>
				<Body muted>Address in use</Body>
				<Body testID="mac-address">{address}</Body>
				<Body muted>All addresses</Body>
				<Body testID="mac-addresses">{connection.urls.join("\n")}</Body>
				<Body muted>Paired</Body>
				<Body>{formatDate(connection.pairedAt)}</Body>
			</Panel>
			<Button title="Forget this Mac" kind="danger" onPress={confirmForget} testID="forget" />
			{showDeveloper ? <DeveloperSection /> : null}
			<Pressable onPress={tapVersion} testID="version" accessibilityRole="text">
				<Body muted>Version {Constants.expoConfig?.version ?? "unknown"}</Body>
			</Pressable>
		</Screen>
	);
}
