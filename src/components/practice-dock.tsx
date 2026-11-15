/**
 * The practice dock (issue 06), as the desktop's (fork
 * components/practice-dock.tsx): an active problem replaces the composer.
 * "PROBLEM" and the statement above; "YOUR THINKING" and Submit thinking
 * below. Each submission starts a turn. The model solution never shows here.
 *
 * Phone choices (user decisions 2026-11-15):
 * - A long statement scrolls inside the dock, at a maximum of about 35% of
 *   the screen height. The chevron collapses the dock to a slim bar; a tap
 *   on the bar opens it again. The thinking text stays.
 * - "Dismiss" in the PROBLEM row asks first (an iOS alert).
 * - Return makes a new line; the button sends (the desktop's Enter is a
 *   keyboard habit, and dictation comes with issue 07).
 *
 * A plugin problem (made on the Mac) needs its plugin editor, which the
 * phone does not have: the dock shows the statement, a note and Dismiss.
 */
import { useState } from "react";
import {
	Alert,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
	useWindowDimensions,
} from "react-native";

import { teacherText } from "@/lib/teacher-text";
import { PLUGIN_PROBLEM } from "@/lib/user-error";
import { Markdown } from "./markdown";
import { Button, FONT, Icon, LABEL, TYPE, usePalette } from "./ui";
import { SPACE } from "./spacing";

/** The share of the screen height that the statement can use. */
export const STATEMENT_MAX_SHARE = 0.35;

export function confirmDismiss(onDismiss: () => void) {
	Alert.alert(
		"Dismiss this problem?",
		"The teacher records it as dismissed. You can ask for the next problem after.",
		[
			{ text: "Cancel", style: "cancel" },
			{ text: "Dismiss", style: "destructive", onPress: onDismiss },
		],
	);
}

export function PracticeDock({
	problemCallId,
	input,
	plugin,
	initialText,
	waiting,
	onSubmit,
	onDismiss,
}: {
	problemCallId: string;
	/** The problem call's arguments. Only the statement is the learner's. */
	input: unknown;
	/** A plugin problem: no thinking field on the phone. */
	plugin: boolean;
	/** A thinking that the Mac did not accept, shown again. */
	initialText: string;
	/** The Mac compacts: Submit thinking waits. */
	waiting: boolean;
	/** Resolves true when the Mac accepted the thinking. */
	onSubmit: (text: string) => Promise<boolean>;
	onDismiss: () => void;
}) {
	const c = usePalette();
	const { height } = useWindowDimensions();
	const [expanded, setExpanded] = useState(true);
	const [text, setText] = useState(initialText);
	const [sending, setSending] = useState(false);
	const raw = (input as { statement?: unknown } | null)?.statement;
	const statement = typeof raw === "string" ? teacherText(raw) : "";
	const canSend = !!text.trim() && !waiting && !sending;

	async function submit() {
		const value = text.trim();
		if (!value || sending || waiting) return;
		setSending(true);
		try {
			// Clear the field only when the Mac accepted the thinking.
			if (await onSubmit(value)) setText("");
		} finally {
			setSending(false);
		}
	}

	if (!expanded)
		return (
			<Pressable
				testID="practice-dock-bar"
				accessibilityRole="button"
				accessibilityLabel="Open the problem"
				onPress={() => setExpanded(true)}
				style={({ pressed }) => [
					styles.shell,
					styles.bar,
					{ borderColor: c.line, backgroundColor: pressed ? c.hover : c.panel },
				]}
			>
				<Icon name="chevron.up" size={12} color={c.muted} />
				<Text style={[LABEL, { color: c.muted }]}>PROBLEM</Text>
				<Text style={[styles.preview, { color: c.muted }]} numberOfLines={1}>
					{statement.replace(/\s+/g, " ")}
				</Text>
			</Pressable>
		);

	return (
		<View
			testID="practice-dock"
			style={[styles.shell, { borderColor: c.line, backgroundColor: c.panel }]}
		>
			<View style={styles.head}>
				<Text style={[LABEL, styles.grow, { color: c.muted }]}>PROBLEM</Text>
				<Pressable
					testID="dismiss-problem"
					accessibilityRole="button"
					accessibilityLabel="Dismiss this problem"
					hitSlop={SPACE.sm}
					onPress={() => confirmDismiss(onDismiss)}
				>
					<Text style={[styles.quiet, { color: c.muted }]}>Dismiss</Text>
				</Pressable>
				<Pressable
					testID="collapse-problem"
					accessibilityRole="button"
					accessibilityLabel="Hide the problem"
					hitSlop={SPACE.sm}
					onPress={() => setExpanded(false)}
				>
					<Icon name="chevron.down" size={12} color={c.muted} />
				</Pressable>
			</View>
			<ScrollView
				testID="problem-statement"
				style={{ maxHeight: Math.round(height * STATEMENT_MAX_SHARE) }}
				nestedScrollEnabled
				keyboardShouldPersistTaps="handled"
			>
				{statement ? (
					<Markdown text={statement} style={[styles.body, { color: c.text }]} />
				) : (
					<Text style={[styles.quiet, { color: c.muted }]}>This problem has no text.</Text>
				)}
			</ScrollView>
			{plugin ? (
				<Text style={[styles.quiet, { color: c.muted }]} testID="plugin-problem">
					{PLUGIN_PROBLEM}
				</Text>
			) : (
				<View
					style={[styles.field, { borderColor: c.line, backgroundColor: c.bg }]}
					testID={`practice-field-${problemCallId}`}
				>
					<Text style={[LABEL, { color: c.muted }]}>YOUR THINKING</Text>
					<TextInput
						testID="practice-thinking-field"
						accessibilityLabel="Your thinking"
						value={text}
						onChangeText={setText}
						placeholder="Work here, think out loud."
						placeholderTextColor={c.muted}
						multiline
						style={[styles.input, { color: c.text }]}
					/>
					<View style={styles.submitRow}>
						{waiting ? (
							<Text style={[styles.quiet, styles.grow, { color: c.muted }]}>
								The Mac is making the history shorter…
							</Text>
						) : (
							<View style={styles.grow} />
						)}
						<Button
							title="Submit thinking"
							size="sm"
							onPress={() => void submit()}
							disabled={!canSend}
							busy={sending}
							testID="practice-send"
						/>
					</View>
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	/** The composer's shell: rounded-2xl and the card fill. */
	shell: { borderWidth: 1, borderRadius: 16, padding: SPACE.md, gap: SPACE.sm },
	bar: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 44 },
	preview: { ...TYPE.sm, fontFamily: FONT.prose, flex: 1 },
	head: { flexDirection: "row", alignItems: "center", gap: SPACE.lg },
	grow: { flex: 1 },
	body: { ...TYPE.prose, fontFamily: FONT.prose },
	quiet: { ...TYPE.xs, fontFamily: FONT.ui },
	/** The field: the shell's 16 radius minus its 12 padding, rounded up to the ladder's 8. */
	field: { borderWidth: 1, borderRadius: 8, padding: SPACE.sm, gap: SPACE.xs },
	input: {
		minHeight: 48,
		maxHeight: 160,
		fontFamily: FONT.prose,
		fontSize: 16,
		lineHeight: 20,
		paddingVertical: SPACE.xs,
	},
	submitRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
