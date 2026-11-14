/** Home: the connection to the paired Mac. The session list comes in issue 03. */
import { Link } from "expo-router";

import { Body, Button, Panel, Screen, Title, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import type { ConnectionState } from "@/lib/connection-monitor";

export function statusText(state: ConnectionState): {
	label: string;
	detail: string;
	tone: "ok" | "muted" | "danger";
} {
	switch (state.status) {
		case "connected":
			return { label: "Connected", detail: `Connected to ${state.connection.name}.`, tone: "ok" };
		case "checking":
			return {
				label: "Connecting",
				detail: `Looking for ${state.connection.name}…`,
				tone: "muted",
			};
		case "unreachable":
			return {
				label: "Not connected",
				detail: `The phone cannot reach ${state.connection.name}. Make sure that the Mac is on, LearnHarness is open, and Phone Access is on. The phone and the Mac must be on the same Wi-Fi or both on Tailscale.`,
				tone: "danger",
			};
		default:
			return { label: "Not paired", detail: "Pair this phone with your Mac.", tone: "muted" };
	}
}

export default function Home() {
	const { state, monitor } = useConnection();
	const c = usePalette();
	const status = statusText(state);
	const color = status.tone === "ok" ? c.ok : status.tone === "danger" ? c.danger : c.muted;
	return (
		<Screen>
			<Panel>
				<Title>{status.label}</Title>
				<Body testID="connection-status" style={{ color }}>
					{status.detail}
				</Body>
				{state.status === "unreachable" ? (
					<Button
						title="Try again"
						kind="plain"
						onPress={() => void monitor.check()}
						testID="retry"
					/>
				) : null}
			</Panel>
			<Panel>
				<Body muted>Your sessions will show here in a later version.</Body>
			</Panel>
			<Link href="/settings" asChild>
				<Button title="Settings" kind="plain" onPress={() => {}} testID="open-settings" />
			</Link>
		</Screen>
	);
}
