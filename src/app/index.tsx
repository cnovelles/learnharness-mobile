/** Home: the connection to the paired Mac and the Mac's sessions. */
import { Link, Stack } from "expo-router";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { SessionList, useSessionList } from "@/components/session-list";
import { SPACE } from "@/components/spacing";
import { Button, ErrorBanner, Icon, LABEL, Screen, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import type { ConnectionState } from "@/lib/connection-monitor";
import { userMessage, type UserMessage } from "@/lib/user-error";

export function statusText(state: ConnectionState): {
	label: string;
	detail: UserMessage;
	tone: "ok" | "muted" | "danger";
} {
	switch (state.status) {
		case "connected":
			return {
				label: "Connected",
				detail: userMessage(`Connected to ${state.connection.name}.`),
				tone: "ok",
			};
		case "checking":
			return {
				label: "Connecting",
				detail: userMessage(`Looking for ${state.connection.name}…`),
				tone: "muted",
			};
		case "unreachable":
			if (state.wrongCertificate)
				return {
					label: "Not connected",
					detail: userMessage(
						`A device answered at the address of ${state.connection.name}, but it is not ${state.connection.name}. The phone sent nothing to it. If you made a new certificate on the Mac, pair again. If not, check the network.`,
					),
					tone: "danger",
				};
			return {
				label: "Not connected",
				detail: userMessage(
					`The phone cannot reach ${state.connection.name}. Make sure that the Mac is on, LearnHarness is open, and Phone Access is on. The phone and the Mac must be on the same Wi-Fi or both on Tailscale.`,
				),
				tone: "danger",
			};
		default:
			return {
				label: "Not paired",
				detail: userMessage("Pair this phone with your Mac."),
				tone: "muted",
			};
	}
}

/** The settings gear in the header. */
function SettingsButton() {
	const c = usePalette();
	return (
		<Link href="/settings" asChild>
			<Pressable
				testID="open-settings"
				accessibilityRole="button"
				accessibilityLabel="Settings"
				hitSlop={SPACE.sm}
			>
				<Icon name="gearshape" size={18} color={c.muted} />
			</Pressable>
		</Link>
	);
}

export default function Home() {
	const { state, monitor } = useConnection();
	const c = usePalette();
	const status = statusText(state);
	const color = status.tone === "ok" ? c.ok : status.tone === "danger" ? c.danger : c.muted;
	const connected = state.status === "connected";
	const list = useSessionList(connected);
	const name = "connection" in state ? state.connection.name : "";
	return (
		<Screen
			refreshControl={
				<RefreshControl
					refreshing={list.busy && list.chats !== null}
					onRefresh={list.refresh}
					tintColor={c.muted}
				/>
			}
		>
			<Stack.Screen options={{ headerRight: () => <SettingsButton /> }} />
			<View style={styles.status} accessibilityLiveRegion="polite">
				<View style={[styles.dot, { backgroundColor: color }]} />
				<Text style={[LABEL, styles.statusText, { color: c.muted }]} testID="connection-status">
					{name ? `${status.label} · ${name}` : status.label}
				</Text>
			</View>
			{state.status === "unreachable" ? (
				<ErrorBanner
					testID="connection-detail"
					text={status.detail}
					actions={
						<Button
							title="Try again"
							kind="plain"
							size="sm"
							onPress={() => void monitor.check()}
							testID="retry"
						/>
					}
				/>
			) : null}
			<SessionList enabled={connected} list={list} />
		</Screen>
	);
}

const styles = StyleSheet.create({
	status: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	dot: { width: 6, height: 6, borderRadius: 3 },
	statusText: { flexShrink: 1 },
});
