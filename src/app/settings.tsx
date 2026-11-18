/**
 * Settings: the paired Mac, the address in use, "Forget this Mac", the
 * Dictation section (issue 07), and the hidden developer sections (feature flags, and the
 * performance panel of issue 21). Tap "Version" 7 times to open
 * the developer section on this phone. Development builds always show it.
 */
import Constants from "expo-constants";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
	alpha,
	Body,
	Button,
	ErrorText,
	FONT,
	Screen,
	Section,
	TYPE,
	usePalette,
} from "@/components/ui";
import { DictationSection } from "@/components/dictation-settings";
import { PerfSection } from "@/components/perf-panel";
import { useConnection } from "@/lib/connection-context";
import { MODES } from "@/lib/feature-flags";
import { useFlags } from "@/lib/flags-context";
import { describeError, type UserMessage } from "@/lib/user-error";
import { SPACE } from "@/components/spacing";

const UNLOCK_TAPS = 7;

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** A label in the prose font and its value in small mono text under it. */
function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
	const c = usePalette();
	return (
		<View style={styles.row}>
			<Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
			<Text style={[styles.rowValue, { color: c.muted }]} testID={testID} selectable>
				{value}
			</Text>
		</View>
	);
}

function DeveloperSection() {
	const c = usePalette();
	const { state, store } = useFlags();
	const [error, setError] = useState<UserMessage | null>(null);

	async function run(action: () => Promise<void>) {
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(describeError(e));
		}
	}

	return (
		<Section
			title="Developer: modes"
			hint="Turn modes on or off on this phone only. A mode that is not built yet has no effect. Your lessons and data stay on this phone when you turn a mode off."
		>
			{MODES.map((mode) => (
				<View key={mode.id} style={styles.switchRow}>
					<View style={styles.switchText}>
						<Body>{mode.title}</Body>
						<Text style={[styles.hint, { color: alpha(c.muted, 0.7) }]}>{mode.detail}</Text>
					</View>
					<Switch
						testID={`flag-${mode.id}`}
						accessibilityLabel={mode.title}
						value={state.flags[mode.id]}
						trackColor={{ true: c.accent }}
						onValueChange={(value) => void run(() => store.set(mode.id, value))}
					/>
				</View>
			))}
			{error ? <ErrorText testID="flags-error">{error}</ErrorText> : null}
			<Button
				title="Use the build defaults"
				kind="plain"
				size="sm"
				onPress={() => void run(() => store.reset())}
				testID="flags-reset"
			/>
		</Section>
	);
}

export default function SettingsScreen() {
	const c = usePalette();
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
			<Section title="Mac" first>
				<Body testID="mac-name">{connection.name}</Body>
				<Row label="Address in use" value={address} testID="mac-address" />
				<Row label="All addresses" value={connection.urls.join("\n")} testID="mac-addresses" />
				<Row label="Paired" value={formatDate(connection.pairedAt)} />
				<Button title="Forget this Mac" kind="danger" onPress={confirmForget} testID="forget" />
			</Section>
			<DictationSection />
			{showDeveloper ? <DeveloperSection /> : null}
			{showDeveloper ? <PerfSection /> : null}
			<Pressable onPress={tapVersion} testID="version" accessibilityRole="text">
				<Text style={[styles.hint, { color: c.muted }]}>
					Version {Constants.expoConfig?.version ?? "unknown"}
				</Text>
			</Pressable>
		</Screen>
	);
}

/** The desktop settings controls (fork components/settings/controls.tsx). */
const styles = StyleSheet.create({
	hint: { ...TYPE.xs, fontFamily: FONT.ui },
	row: { gap: SPACE.xs },
	rowLabel: { ...TYPE.prose, fontFamily: FONT.prose },
	rowValue: { ...TYPE.xs, fontFamily: FONT.ui },
	switchRow: { flexDirection: "row", alignItems: "center", gap: SPACE.lg },
	switchText: { flex: 1, gap: SPACE.xs },
});
