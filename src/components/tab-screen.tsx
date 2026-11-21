/**
 * The frame of each tab (issue 20): the connection status at the top, the
 * "Not connected" banner, and the header buttons (the Settings gear on the
 * left, "+" for a new session on the right).
 */
import { Stack, router } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { Pressable, type RefreshControlProps, StyleSheet, Text, View } from "react-native";

import { SPACE } from "./spacing";
import { Button, ErrorBanner, Icon, LABEL, Screen, usePalette } from "./ui";
import { useConnection } from "@/lib/connection-context";
import type { ConnectionState } from "@/lib/connection-monitor";
import type { SessionKind } from "@/lib/sessions";
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

/** A header button with an SF Symbol. */
function HeaderButton({
	testID,
	label,
	icon,
	onPress,
	disabled = false,
}: {
	testID: string;
	label: string;
	icon: "gearshape" | "plus";
	onPress: () => void;
	disabled?: boolean;
}) {
	const c = usePalette();
	return (
		<Pressable
			testID={testID}
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={SPACE.sm}
			style={{ opacity: disabled ? 0.4 : 1 }}
		>
			<Icon name={icon} size={18} color={icon === "plus" ? c.text : c.muted} />
		</Pressable>
	);
}

/** The "+" in a tab header: a new session of the tab's kind. */
const NEW: Record<SessionKind, { testID: string; label: string }> = {
	teach: { testID: "new-session", label: "New session" },
	practice: { testID: "new-practice", label: "New practice" },
};

/** The connection status line and, when the Mac is not reachable, the banner. */
function ConnectionStatus() {
	const { state, monitor } = useConnection();
	const c = usePalette();
	const status = statusText(state);
	const color = status.tone === "ok" ? c.ok : status.tone === "danger" ? c.danger : c.muted;
	const name = "connection" in state ? state.connection.name : "";
	return (
		<>
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
		</>
	);
}

/**
 * One tab's screen. `kind` adds the "+" for a new session of that kind; the
 * Graph tab has none. `scroll={false}` gives the children the full height
 * with no scroll (the Graph tab canvas takes the pan gestures).
 */
export function TabScreen({
	title,
	kind,
	refreshControl,
	scroll = true,
	children,
}: {
	title: string;
	kind?: SessionKind;
	refreshControl?: ReactElement<RefreshControlProps>;
	scroll?: boolean;
	children: ReactNode;
}) {
	const { state } = useConnection();
	const connected = state.status === "connected";
	const add = kind ? NEW[kind] : null;
	return (
		<Screen refreshControl={refreshControl} scroll={scroll}>
			<Stack.Screen
				options={{
					title,
					headerLeft: () => (
						<HeaderButton
							testID="open-settings"
							label="Settings"
							icon="gearshape"
							onPress={() => router.push("/settings")}
						/>
					),
					headerRight: add
						? () => (
								<HeaderButton
									testID={add.testID}
									label={add.label}
									icon="plus"
									disabled={!connected}
									onPress={() =>
										router.push(
											kind === "practice"
												? { pathname: "/new-session", params: { kind: "practice" } }
												: "/new-session",
										)
									}
								/>
							)
						: undefined,
				}}
			/>
			{/* Native tabs mount all tabs at once: the testID tells them apart. */}
			<View style={[styles.body, !scroll && styles.fill]} testID={`tab-${title.toLowerCase()}`}>
				<ConnectionStatus />
				{children}
			</View>
		</Screen>
	);
}

const styles = StyleSheet.create({
	body: { gap: SPACE.lg },
	fill: { flex: 1 },
	status: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	dot: { width: 6, height: 6, borderRadius: 3 },
	statusText: { flexShrink: 1 },
});
