/**
 * The Mac's sessions on the home screen: title, phase and marks (a turn
 * runs, a question waits). It reads the list when the screen comes into
 * view and on pull to refresh.
 */
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMacFetch } from "@/lib/connection-context";
import { useServerEvent } from "@/lib/server-events-context";
import { listSessions } from "@/lib/sessions";
import type { ChatListItem } from "@/lib/shared";
import { Body, Button, ErrorText, Panel, Title, usePalette } from "./ui";
import { describeError, type UserMessage } from "@/lib/user-error";

export function sessionMarks(c: ChatListItem): string {
	const phase =
		c.kind === "practice"
			? "Practice"
			: c.phase === "probe"
				? "Finding out what you know"
				: c.phase === "plan"
					? "Planning"
					: "Teaching";
	const marks = [phase];
	if (c.busy) marks.push("Working now");
	else if (c.pendingQuestion) marks.push("A question waits");
	else if (c.pendingProblem) marks.push("A problem waits");
	if (c.compacting) marks.push("Making the history shorter");
	return marks.join(" · ");
}

export function SessionList({ enabled }: { enabled: boolean }) {
	const macFetch = useMacFetch();
	const c = usePalette();
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const [error, setError] = useState<UserMessage | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(() => {
		if (!enabled) return;
		setBusy(true);
		listSessions(macFetch)
			.then((list) => {
				setChats(list);
				setError(null);
			})
			.catch((e: unknown) => setError(describeError(e)))
			.finally(() => setBusy(false));
	}, [enabled, macFetch]);

	useFocusEffect(refresh);
	// The list shows phases and marks: read it again when a session changes on the Mac.
	useServerEvent("chats-changed", refresh);
	useServerEvent("turn-started", refresh);
	useServerEvent("turn-settled", refresh);

	return (
		<Panel>
			<View style={styles.head}>
				<Title>Sessions</Title>
				<Link href="/new-session" asChild>
					<Button title="New session" onPress={() => {}} disabled={!enabled} testID="new-session" />
				</Link>
			</View>
			{error ? <ErrorText testID="sessions-error">{error}</ErrorText> : null}
			{chats === null ? (
				<Body muted>
					{enabled ? "Loading the sessions…" : "Connect to the Mac to see your sessions."}
				</Body>
			) : chats.length === 0 ? (
				<Body muted>No sessions yet. Start a new session.</Body>
			) : (
				chats.map((chat) => (
					<Link key={chat.id} href={{ pathname: "/session/[id]", params: { id: chat.id } }} asChild>
						<Pressable
							testID={`session-${chat.id}`}
							accessibilityRole="button"
							style={({ pressed }) => [
								styles.row,
								{ borderColor: c.line, opacity: pressed ? 0.6 : 1 },
							]}
						>
							<Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
								{chat.title}
							</Text>
							<Text style={[styles.marks, { color: c.muted }]}>{sessionMarks(chat)}</Text>
						</Pressable>
					</Link>
				))
			)}
			{chats !== null ? (
				<Button
					title="Refresh"
					kind="plain"
					onPress={refresh}
					busy={busy}
					testID="sessions-refresh"
				/>
			) : null}
		</Panel>
	);
}

const styles = StyleSheet.create({
	head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
	row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 2 },
	title: { fontSize: 16, fontWeight: "500" },
	marks: { fontSize: 13 },
});
