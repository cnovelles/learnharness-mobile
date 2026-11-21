/**
 * The Practice tab (issue 20, slice C): the "Continue practice" card, then
 * the practice sessions by time (Today, This week, Earlier) with the problem
 * count on each row. The desktop keeps practice sessions out of the folders.
 */
import { useMemo } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import { kindOf, useSessionList } from "@/components/session-list";
import { ContinueCardFrame, ShelfSectionView } from "@/components/shelf";
import { SPACE } from "@/components/spacing";
import { TabScreen } from "@/components/tab-screen";
import { ErrorBanner, FONT, TYPE, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import {
	practiceBadge,
	practiceGroups,
	practiceLine,
	problemCount,
	problemLabel,
} from "@/lib/practice-shelf";
import type { ChatListItem } from "@/lib/shared";
import { continueSession } from "@/lib/teach-shelf";

const PRACTICE_CARD_IDS = {
	card: "practice-continue-card",
	badge: "practice-continue-badge",
	line: "practice-continue-line",
	button: "practice-continue",
};

function countOf(chat: ChatListItem) {
	const count = problemCount(chat);
	// An older Mac sends no count: the row shows no number.
	return count === null ? undefined : { text: problemLabel(count), testID: `problems-${chat.id}` };
}

export default function PracticeTab() {
	const { state } = useConnection();
	const c = usePalette();
	const connected = state.status === "connected";
	const list = useSessionList(connected);
	const chats = useMemo(
		() => (list.chats === null ? null : list.chats.filter((chat) => kindOf(chat) === "practice")),
		[list.chats],
	);
	// The groups use the time of the last list read; a new read (focus, events) moves them.
	const groups = useMemo(() => (chats ? practiceGroups(chats, new Date()) : []), [chats]);
	const newest = chats ? continueSession(chats) : null;
	const note = (text: string) => (
		<Text style={[styles.note, { color: c.muted }]} testID="sessions-note">
			{text}
		</Text>
	);
	return (
		<TabScreen
			title="Practice"
			kind="practice"
			refreshControl={
				<RefreshControl
					refreshing={list.busy && list.chats !== null}
					onRefresh={list.refresh}
					tintColor={c.muted}
				/>
			}
		>
			{list.error ? <ErrorBanner testID="sessions-error" text={list.error} /> : null}
			{chats === null ? (
				note(connected ? "Loading…" : "Connect to the Mac to see your sessions.")
			) : chats.length === 0 ? (
				note("Start a practice session to begin.")
			) : (
				<View style={styles.shelf}>
					{newest ? (
						<ContinueCardFrame
							heading="Continue practice"
							chat={newest}
							badge={practiceBadge(newest)}
							line={practiceLine(newest)}
							ids={PRACTICE_CARD_IDS}
						/>
					) : null}
					{groups.map((group) => (
						<ShelfSectionView
							key={group.key}
							label={group.label}
							testID={`time-${group.key}`}
							sessions={group.sessions}
							countOf={countOf}
						/>
					))}
				</View>
			)}
		</TabScreen>
	);
}

const styles = StyleSheet.create({
	shelf: { gap: SPACE.lg },
	note: { ...TYPE.xs, fontFamily: FONT.ui, paddingHorizontal: SPACE.sm },
});
