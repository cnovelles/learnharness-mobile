/**
 * The Mac's sessions in the Teach and Practice tabs, as the desktop sidebar list (user
 * decision 2026-11-15): a row with the title in the prose font and a small
 * mono line under it (the state or the phase, and how long ago). It reads
 * the list when the screen comes into view, on server events and on pull to
 * refresh (`useSessionList`).
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMacFetch } from "@/lib/connection-context";
import { useServerEvent } from "@/lib/server-events-context";
import { listSessions, type SessionKind } from "@/lib/sessions";
import type { ChatListItem } from "@/lib/shared";
import { timeAgo } from "@/lib/time-ago";
import { describeError, type UserMessage } from "@/lib/user-error";
import { ErrorBanner, FONT, SectionLabel, Spinner, TYPE, usePalette } from "./ui";
import { SPACE } from "./spacing";

/** The phase as a word, for a session with no waiting state. */
function phaseWord(c: ChatListItem): string {
	if (c.kind === "practice") return "Practice";
	return c.phase === "probe"
		? "Finding out what you know"
		: c.phase === "plan"
			? "Planning"
			: "Teaching";
}

/**
 * The second line of a row: "Working…" while a turn runs; otherwise the
 * waiting state (or the phase when nothing waits) and how long ago.
 */
export function sessionMarks(c: ChatListItem, now = new Date()): string {
	if (c.busy) return "Working…";
	const state = c.compacting
		? "Making the history shorter"
		: c.pendingQuestion
			? "A question waits"
			: c.pendingProblem
				? "A problem waits"
				: phaseWord(c);
	const ago = timeAgo(c.updatedAt, now);
	return ago ? `${state} · ${ago}` : state;
}

export interface SessionListState {
	chats: ChatListItem[] | null;
	error: UserMessage | null;
	busy: boolean;
	refresh: () => void;
}

export function useSessionList(enabled: boolean): SessionListState {
	const macFetch = useMacFetch();
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
	// The list shows states and times: read it again when a session changes on the Mac.
	useServerEvent("chats-changed", refresh);
	useServerEvent("turn-started", refresh);
	useServerEvent("turn-settled", refresh);
	return { chats, error, busy, refresh };
}

function Row({ chat }: { chat: ChatListItem }) {
	const c = usePalette();
	return (
		// Not `Link asChild`: it drops a style function, and the pressed fill needs one.
		<Pressable
			testID={`session-${chat.id}`}
			accessibilityRole="button"
			onPress={() => router.push({ pathname: "/session/[id]", params: { id: chat.id } })}
			style={({ pressed }) => [styles.row, pressed ? { backgroundColor: c.hover } : null]}
		>
			<Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
				{chat.title}
			</Text>
			<View style={styles.meta}>
				{chat.busy ? <Spinner /> : null}
				<Text style={[styles.marks, { color: c.muted }]}>{sessionMarks(chat)}</Text>
			</View>
		</Pressable>
	);
}

/** The empty text of each tab (issue 20, error state 4). */
const EMPTY: Record<SessionKind, string> = {
	teach: "Start a session to begin learning.",
	practice: "Start a practice session to begin.",
};

/** A session's kind: the Mac leaves it out on older teach sessions. */
export function kindOf(chat: ChatListItem): SessionKind {
	return chat.kind === "practice" ? "practice" : "teach";
}

/** The sessions of one kind (one tab), newest first as the Mac sends them. */
export function SessionList({
	enabled,
	list,
	kind,
}: {
	enabled: boolean;
	list: SessionListState;
	kind: SessionKind;
}) {
	const c = usePalette();
	const { error } = list;
	const chats = list.chats === null ? null : list.chats.filter((chat) => kindOf(chat) === kind);
	return (
		<View style={styles.list}>
			<SectionLabel>Sessions</SectionLabel>
			{error ? <ErrorBanner testID="sessions-error" text={error} /> : null}
			{chats === null ? (
				<Text style={[styles.note, { color: c.muted }]} testID="sessions-note">
					{enabled ? "Loading…" : "Connect to the Mac to see your sessions."}
				</Text>
			) : chats.length === 0 ? (
				<Text style={[styles.note, { color: c.muted }]} testID="sessions-note">
					{EMPTY[kind]}
				</Text>
			) : (
				<View>
					{chats.map((chat) => (
						<Row key={chat.id} chat={chat} />
					))}
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	list: { gap: SPACE.md },
	/** The desktop SessionRow: rounded-lg, 12 x 8 padding, a pressed fill. */
	row: {
		borderRadius: 12,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
		gap: SPACE.xs,
	},
	title: { ...TYPE.prose, fontFamily: FONT.prose },
	meta: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	marks: { ...TYPE.xs, fontFamily: FONT.ui, flexShrink: 1 },
	note: { ...TYPE.xs, fontFamily: FONT.ui, paddingHorizontal: SPACE.sm },
});
