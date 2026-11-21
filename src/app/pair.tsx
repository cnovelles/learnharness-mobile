/**
 * Pair with the Mac: scan the QR code from "Phone Access…" in the desktop
 * app, or paste the pairing text ("Copy pairing text" on the Mac). The paste
 * field is for the iOS Simulator and for a phone without a working camera.
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Device from "expo-device";
import { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import {
	Body,
	Button,
	ErrorBanner,
	FONT,
	Screen,
	Section,
	TYPE,
	usePalette,
} from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import { describeError, userMessage, type UserMessage } from "@/lib/user-error";
import { SPACE } from "@/components/spacing";

export default function PairScreen() {
	const { state, monitor } = useConnection();
	const c = usePalette();
	const [permission, requestPermission] = useCameraPermissions();
	const [scanning, setScanning] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<UserMessage | null>(null);
	const handled = useRef(false); // the camera reports the same code many times

	const removedMessage = state.status === "unpaired" ? state.message : undefined;

	async function submit(pairingText: string) {
		setBusy(true);
		setError(null);
		try {
			await monitor.pairWith(pairingText, Device.deviceName ?? "iPhone");
			// The root layout now shows the home screen.
		} catch (err) {
			setError(describeError(err));
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
				userMessage(
					"LearnHarness cannot use the camera. Allow the camera in Settings, or paste the pairing text below.",
				),
			);
	}

	return (
		<Screen>
			{removedMessage ? <ErrorBanner testID="removed-message" text={removedMessage} /> : null}
			<Section title="Scan the QR code" first>
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
			</Section>
			<Section title="Or paste the pairing text">
				<Body muted>{'On the Mac, click "Copy pairing text". Then paste it here.'}</Body>
				<TextInput
					testID="pairing-text"
					accessibilityLabel="Pairing text"
					value={text}
					onChangeText={setText}
					placeholder='{"lh":2,...}'
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
			</Section>
			{error ? <ErrorBanner testID="pair-error" text={error} /> : null}
		</Screen>
	);
}

const styles = StyleSheet.create({
	camera: { aspectRatio: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
	/** The pairing text is JSON: the mono font. */
	input: {
		minHeight: 90,
		borderWidth: 1,
		borderRadius: 12,
		padding: SPACE.md,
		...TYPE.sm,
		fontFamily: FONT.ui,
		textAlignVertical: "top",
	},
});
