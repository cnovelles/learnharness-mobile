/**
 * The Dictation section of Settings (issue 07 slice D, user decision
 * 2026-11-16, option 2): the engine (on this iPhone or Deepgram), the
 * language from the Mac, and the state of the on-device speech model with
 * its download.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useDictationSettings, type DictationSettings } from "@/lib/dictation-context";
import { DICTATION_MESSAGES, type ModelStatus } from "@/lib/dictation";
import { ENGINE_CHOICES, type EngineChoice } from "@/lib/dictation-settings";
import type { UserMessage } from "@/lib/user-error";
import { Body, Button, ErrorText, FONT, Icon, Section, TYPE, alpha, usePalette } from "./ui";
import { SPACE } from "./spacing";

type ModelView =
	| { kind: "checking" }
	| { kind: "old-ios" }
	| { kind: "status"; status: ModelStatus }
	| { kind: "installing"; progress: number }
	| { kind: "error"; text: UserMessage };

function modelLabel(view: ModelView): string {
	switch (view.kind) {
		case "checking":
			return "Checking…";
		case "old-ios":
			return "Needs iOS 26. Use Deepgram, or the keyboard mic.";
		case "installing":
			return `Downloading… ${Math.round(view.progress * 100)}%`;
		case "error":
			return "Not downloaded";
		case "status":
			return view.status === "installed"
				? "Downloaded"
				: view.status === "unsupported"
					? "Not available for this language"
					: view.status === "downloading"
						? "iOS is downloading it"
						: "Not downloaded yet (iOS downloads it once)";
	}
}

function ChoiceRow({
	id,
	title,
	detail,
	selected,
	onPress,
}: {
	id: EngineChoice;
	title: string;
	detail: string;
	selected: boolean;
	onPress: () => void;
}) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="radio"
			accessibilityState={{ checked: selected }}
			testID={`dictation-engine-${id}`}
			style={({ pressed }) => [
				styles.choice,
				{
					borderColor: selected ? c.primary : c.line,
					backgroundColor: selected ? alpha(c.primary, 0.08) : pressed ? c.hover : "transparent",
				},
			]}
		>
			<View style={styles.grow}>
				<Body>{title}</Body>
				<Text style={[styles.hint, { color: c.muted }]}>{detail}</Text>
			</View>
			{selected ? <Icon name="checkmark" size={14} color={c.text} /> : null}
		</Pressable>
	);
}

function ModelRow({ settings, language }: { settings: DictationSettings; language: string }) {
	const c = usePalette();
	const [state, setView] = useState<ModelView>({ kind: "checking" });
	let view = state;
	const [round, setRound] = useState(0);
	const engine = settings.onDevice;
	const supported = engine.supported();
	useEffect(() => {
		if (!supported) return;
		let live = true;
		engine
			.model(language)
			.then((status) => live && setView({ kind: "status", status }))
			.catch(() => live && setView({ kind: "status", status: "unsupported" }));
		return () => {
			live = false;
		};
	}, [engine, language, supported, round]);

	async function download() {
		setView({ kind: "installing", progress: 0 });
		try {
			await engine.install(language, (progress) => setView({ kind: "installing", progress }));
			setRound((r) => r + 1);
		} catch {
			setView({ kind: "error", text: DICTATION_MESSAGES.downloadFailed });
		}
	}

	if (!supported) view = { kind: "old-ios" };
	const canDownload =
		(view.kind === "status" && view.status === "supported") || view.kind === "error";
	return (
		<View style={styles.row}>
			<Text style={[styles.rowLabel, { color: c.text }]}>Speech model</Text>
			<Text style={[styles.rowValue, { color: c.muted }]} testID="dictation-model">
				{modelLabel(view)}
			</Text>
			{view.kind === "error" ? <ErrorText>{view.text}</ErrorText> : null}
			{canDownload ? (
				<Button
					title="Download the model"
					kind="plain"
					size="sm"
					onPress={() => void download()}
					testID="dictation-download"
				/>
			) : null}
		</View>
	);
}

export function DictationSection() {
	const c = usePalette();
	const settings = useDictationSettings();
	const snapshot = useSyncExternalStore(
		settings ? settings.choice.subscribe : () => () => {},
		settings ? settings.choice.getSnapshot : () => null,
	);
	const [macLanguage, setMacLanguage] = useState<string | null>(null);
	useEffect(() => {
		if (!settings) return;
		let live = true;
		void settings.macLanguage().then((l) => {
			if (live) setMacLanguage(l);
		});
		return () => {
			live = false;
		};
	}, [settings]);
	if (!settings || !snapshot) return null;
	const choice = snapshot.choice;
	const language =
		macLanguage === null
			? null
			: choice === "deepgram"
				? macLanguage
				: settings.onDeviceLanguage(macLanguage);

	return (
		<Section
			title="Dictation"
			hint="The mic next to Send turns your speech into text. Choose where that happens."
		>
			{ENGINE_CHOICES.map((option) => (
				<ChoiceRow
					key={option.id}
					{...option}
					selected={choice === option.id}
					onPress={() => void settings.choice.set(option.id)}
				/>
			))}
			{snapshot.error ? (
				<ErrorText testID="dictation-settings-error">{snapshot.error}</ErrorText>
			) : null}
			<View style={styles.row}>
				<Text style={[styles.rowLabel, { color: c.text }]}>Language</Text>
				<Text style={[styles.rowValue, { color: c.muted }]} testID="dictation-language">
					{language === null ? "Checking…" : `${language} (set on the Mac)`}
				</Text>
			</View>
			{choice === "on-device" && language !== null ? (
				<ModelRow settings={settings} language={language} />
			) : null}
			{choice === "deepgram" ? (
				<Text style={[styles.hint, { color: c.muted }]}>
					The Mac must be reachable and have a Deepgram key (on the Mac: Settings, Keys). The Mac
					gives the phone a short-lived token; the key stays on the Mac.
				</Text>
			) : null}
		</Section>
	);
}

/** The settings controls of settings.tsx. */
const styles = StyleSheet.create({
	choice: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.md,
		borderWidth: 1,
		borderRadius: 12,
		padding: SPACE.md,
	},
	grow: { flex: 1, gap: SPACE.xs },
	hint: { ...TYPE.xs, fontFamily: FONT.ui },
	row: { gap: SPACE.xs },
	rowLabel: { ...TYPE.prose, fontFamily: FONT.prose },
	rowValue: { ...TYPE.xs, fontFamily: FONT.ui },
});
