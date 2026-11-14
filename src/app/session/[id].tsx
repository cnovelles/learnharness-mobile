/**
 * One session on the Mac (mode 1): the transcript, the question dock when a
 * question waits, and a text field when the teacher waits for text. The
 * shared SessionModel streams the turn (src/lib/use-session.ts).
 */
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState, type ComponentRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { QuestionDock } from "@/components/question-dock";
import { Transcript } from "@/components/transcript";
import {
	Body,
	Button,
	ErrorText,
	Field,
	Loading,
	Panel,
	Screen,
	usePalette,
} from "@/components/ui";
import { useMacFetch } from "@/lib/connection-context";
import type { SessionRecord } from "@/lib/sessions";
import { transcriptRows } from "@/lib/transcript";
import { useSessionModel, useSessionRecord } from "@/lib/use-session";

function Composer({ onSend }: { onSend: (text: string) => Promise<boolean> }) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	async function send() {
		const value = text.trim();
		if (!value || sending) return;
		setSending(true);
		try {
			// Clear the field only when the Mac accepted the text.
			if (await onSend(value)) setText("");
		} finally {
			setSending(false);
		}
	}
	return (
		<Panel>
			<Field
				value={text}
				onChangeText={setText}
				label="Message"
				placeholder="Write to the teacher"
				multiline
				testID="composer"
			/>
			<Button
				title="Send"
				onPress={() => void send()}
				disabled={!text.trim()}
				busy={sending}
				testID="send"
			/>
		</Panel>
	);
}

function SessionBody({ record }: { record: SessionRecord }) {
	const macFetch = useMacFetch();
	const c = usePalette();
	const session = useSessionModel(record, macFetch);
	const { state, pending, malformed } = session;
	const rows = useMemo(
		() => transcriptRows(state.messages, new Set(malformed ? [malformed.toolCallId] : [])),
		[state.messages, malformed],
	);
	const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
	const running = state.status === "submitted" || state.status === "streaming";

	return (
		<SafeAreaView
			style={[styles.screen, { backgroundColor: c.bg }]}
			edges={["bottom", "left", "right"]}
		>
			<ScrollView
				ref={scroll}
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
				onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
			>
				<Transcript rows={rows} />
				{running ? (
					<Body muted testID="turn-running">
						{state.status === "submitted" ? "Sending…" : "The teacher is writing…"}
					</Body>
				) : null}
				{state.error ? (
					<Panel>
						<ErrorText testID="session-error">{state.error.message}</ErrorText>
						<View style={styles.row}>
							<Button title="Try again" onPress={() => void session.retry()} testID="retry-turn" />
							<Button
								title="Close"
								kind="plain"
								onPress={session.clearError}
								testID="clear-error"
							/>
						</View>
					</Panel>
				) : null}
				{!running && pending ? (
					<QuestionDock
						call={pending}
						onSubmit={(answer) => session.answer(pending.tool, pending.toolCallId, answer)}
					/>
				) : null}
				{!running && malformed ? (
					<Panel>
						<Body>
							The teacher&apos;s question was not complete. Ask the teacher to write it again.
						</Body>
						<Button
							title="Ask again"
							onPress={() => void session.retryQuestion()}
							testID="retry-question"
						/>
					</Panel>
				) : null}
				{!running && !pending && state.status === "ready" ? (
					<Composer onSend={session.sendText} />
				) : null}
			</ScrollView>
		</SafeAreaView>
	);
}

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const macFetch = useMacFetch();
	const { load, reload } = useSessionRecord(String(id), macFetch);
	const title = load.status === "ready" ? load.record.title : "Session";
	return (
		<>
			<Stack.Screen options={{ title }} />
			{load.status === "loading" ? (
				<Loading />
			) : load.status === "error" ? (
				<Screen>
					<Panel>
						<ErrorText testID="session-load-error">{load.message}</ErrorText>
						<Button title="Try again" onPress={reload} testID="reload-session" />
					</Panel>
				</Screen>
			) : (
				<SessionBody key={load.record.id} record={load.record} />
			)}
		</>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	content: { padding: 16, gap: 16, flexGrow: 1 },
	row: { flexDirection: "row", gap: 12 },
});
