/** Settings: the paired Mac, the address in use, and "Forget this Mac". */
import { Alert } from "react-native";

import { Body, Button, Panel, Screen, Title } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export default function SettingsScreen() {
	const { state, monitor } = useConnection();
	if (!("connection" in state)) return null;
	const { connection } = state;
	const address = state.status === "connected" ? state.url : "None (the Mac is not reachable now)";

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
		</Screen>
	);
}
