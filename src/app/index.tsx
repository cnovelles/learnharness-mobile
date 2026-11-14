/** Home: the connection to the paired Mac and the Mac's sessions. */
import { Link } from "expo-router";

import { SessionList } from "@/components/session-list";
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
			if (state.wrongCertificate)
				return {
					label: "Not connected",
					detail: `A device answered at the address of ${state.connection.name}, but it is not ${state.connection.name}. The phone sent nothing to it. If you made a new certificate on the Mac, pair again. If not, check the network.`,
					tone: "danger",
				};
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
			<SessionList enabled={state.status === "connected"} />
			<Link href="/settings" asChild>
				<Button title="Settings" kind="plain" onPress={() => {}} testID="open-settings" />
			</Link>
		</Screen>
	);
}
