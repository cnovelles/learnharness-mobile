/**
 * The Teach tab (issue 20, slice B): the "Continue learning" card, then the
 * teach sessions in the desktop folders, then "Not in a folder". "/" opens
 * this tab.
 */
import { useMemo } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import { kindOf, useSessionList } from "@/components/session-list";
import { SPACE } from "@/components/spacing";
import { TabScreen } from "@/components/tab-screen";
import { ContinueCard, ShelfGroup, useTeachShelf } from "@/components/teach-shelf";
import { ErrorBanner, FONT, TYPE, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import { continueSession, teachSections } from "@/lib/teach-shelf";

export default function TeachTab() {
	const { state } = useConnection();
	const c = usePalette();
	const connected = state.status === "connected";
	const list = useSessionList(connected);
	const shelf = useTeachShelf(connected);
	const chats = useMemo(
		() => (list.chats === null ? null : list.chats.filter((chat) => kindOf(chat) === "teach")),
		[list.chats],
	);
	const sections = useMemo(
		() => (chats ? teachSections({ chats, directory: shelf.directory }) : []),
		[chats, shelf.directory],
	);
	const newest = chats ? continueSession(chats) : null;
	const refresh = () => {
		list.refresh();
		shelf.refresh();
	};
	const note = (text: string) => (
		<Text style={[styles.note, { color: c.muted }]} testID="sessions-note">
			{text}
		</Text>
	);
	return (
		<TabScreen
			title="Teach"
			kind="teach"
			refreshControl={
				<RefreshControl
					refreshing={list.busy && list.chats !== null}
					onRefresh={refresh}
					tintColor={c.muted}
				/>
			}
		>
			{list.error ? <ErrorBanner testID="sessions-error" text={list.error} /> : null}
			{chats === null ? (
				note(connected ? "Loading…" : "Connect to the Mac to see your sessions.")
			) : chats.length === 0 ? (
				note("Start a session to begin learning.")
			) : (
				<View style={styles.shelf}>
					{newest ? <ContinueCard chat={newest} /> : null}
					{shelf.foldersFailed && !shelf.directory ? (
						<Text style={[styles.note, { color: c.muted }]} testID="folders-note">
							Folders could not be loaded.
						</Text>
					) : null}
					{/* Wait for the folders, so sessions do not jump into them after the first frame. */}
					{!shelf.directory && !shelf.foldersFailed ? note("Loading…") : null}
					{(shelf.directory || shelf.foldersFailed ? sections : []).map((section) => (
						<ShelfGroup
							key={section.folderId ?? "none"}
							section={section}
							concepts={shelf.concepts}
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
