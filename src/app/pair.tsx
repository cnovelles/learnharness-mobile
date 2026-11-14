/**
 * Pair with the Mac: scan the QR code from "Phone Access…" in the desktop
 * app, or paste the pairing text ("Copy pairing text" on the Mac). The paste
 * field is for the iOS Simulator and for a phone without a working camera.
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Device from "expo-device";
import { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { Body, Button, ErrorText, Panel, Screen, Title, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";

export default function PairScreen() {
	const { state, monitor } = useConnection();
	const c = usePalette();
	const [permission, requestPermission] = useCameraPermissions();
	const [scanning, setScanning] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const handled = useRef(false); // the camera reports the same code many times

	const removedMessage = state.status === "unpaired" ? state.message : undefined;

	async function submit(pairingText: string) {
		setBusy(true);
		setError(null);
		try {
			await monitor.pairWith(pairingText, Device.deviceName ?? "iPhone");
			// The root layout now shows the home screen.
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			handled.current = false;
		} finally {
			setBusy(false);
		}
	}

	function onScanned(result: BarcodeScanningResult) {
		if (handled.current) return;
		handled.current = true;
		setScanning(false);
		void submit(result.data);
	}

	async function startScan() {
		setError(null);
		const answer = permission?.granted ? permission : await requestPermission();
		if (answer.granted) {
			handled.current = false;
			setScanning(true);
		} else
			setError(
				"LearnHarness cannot use the camera. Allow the camera in Settings, or paste the pairing text below.",
			);
	}

	return (
		<Screen>
			{removedMessage ? <ErrorText testID="removed-message">{removedMessage}</ErrorText> : null}
			<Panel>
				<Title>Scan the QR code</Title>
				<Body muted>
					{
						'On your Mac, open LearnHarness. Select "Phone Access…" in the LearnHarness menu, turn it on, and click "Show QR code".'
					}
				</Body>
				{scanning ? (
					<View style={styles.camera}>
						<CameraView
							style={StyleSheet.absoluteFill}
							facing="back"
							barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
							onBarcodeScanned={onScanned}
						/>
					</View>
				) : null}
				{scanning ? (
					<Button
						title="Stop scan"
						kind="plain"
						onPress={() => setScanning(false)}
						testID="stop-scan"
					/>
				) : (
					<Button
						title="Scan QR code"
						onPress={() => void startScan()}
						disabled={busy}
						testID="scan"
					/>
				)}
			</Panel>
			<Panel>
				<Title>Or paste the pairing text</Title>
				<Body muted>{'On the Mac, click "Copy pairing text". Then paste it here.'}</Body>
				<TextInput
					testID="pairing-text"
					accessibilityLabel="Pairing text"
					value={text}
					onChangeText={setText}
					placeholder='{"lh":1,...}'
					placeholderTextColor={c.muted}
					autoCapitalize="none"
					autoCorrect={false}
					multiline
					style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
				/>
				<Button
					title="Pair"
					onPress={() => void submit(text)}
					disabled={!text.trim()}
					busy={busy}
					testID="pair"
				/>
			</Panel>
			{error ? <ErrorText testID="pair-error">{error}</ErrorText> : null}
		</Screen>
	);
}

const styles = StyleSheet.create({
	camera: { aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" },
	input: {
		minHeight: 90,
		borderWidth: 1,
		borderRadius: 10,
		padding: 10,
		fontSize: 13,
		fontFamily: "Menlo",
		textAlignVertical: "top",
	},
});
