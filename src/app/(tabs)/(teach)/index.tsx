/**
 * The Teach tab (issue 20, slices B and D): the "Continue learning" card,
 * then the teach sessions in the desktop folders, then "Not in a folder".
 * "/" opens this tab. A long press on a session and the "…" on a folder
 * change the folders (src/components/folder-menus.tsx).
 */
import { useMemo, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import {
	MenuSheet,
	MoveSheet,
	askName,
	folderMenuItems,
	sessionMenuItems,
	useFolderActions,
} from "@/components/folder-menus";
import { kindOf, useSessionList } from "@/components/session-list";
import { SPACE } from "@/components/spacing";
import { TabScreen } from "@/components/tab-screen";
import { ContinueCard, ShelfGroup, useTeachShelf } from "@/components/teach-shelf";
import { ErrorBanner, FONT, TYPE, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import type { ChatListItem } from "@/lib/shared";
import { continueSession, teachSections } from "@/lib/teach-shelf";
import type { UserMessage } from "@/lib/user-error";

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
	const folders = useFolderActions(shelf.apply);
	const [nameError, setNameError] = useState<UserMessage | null>(null);
	const [menuFor, setMenuFor] = useState<ChatListItem | null>(null);
	const [moveFor, setMoveFor] = useState<ChatListItem | null>(null);
	const [folderMenuFor, setFolderMenuFor] = useState<string | null>(null);
	const directory = shelf.directory;
	const bannerText = nameError ?? folders.error;
	const clearBanner = () => {
		setNameError(null);
		folders.clearError();
	};
	const refresh = () => {
		clearBanner();
		list.refresh();
		shelf.refresh();
	};
	const moveTo = (session: ChatListItem, folderId: string | null) => {
		setMoveFor(null);
		void folders.run({ action: "move", kind: "source", id: session.id, parentId: folderId });
	};
	const moveToNewFolder = (session: ChatListItem) => {
		askName(
			"New folder",
			"",
			(name) =>
				void folders.run({ action: "create-folder", name, parentId: null }).then((id) => {
					if (id) moveTo(session, id);
				}),
			setNameError,
		);
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
			{bannerText ? <ErrorBanner testID="folder-error" text={bannerText} /> : null}
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
							// Folder changes need the folders: none while they are not loaded.
							onLongPressRow={directory ? setMenuFor : undefined}
							onMenu={
								directory && section.folderId ? () => setFolderMenuFor(section.folderId) : undefined
							}
						/>
					))}
				</View>
			)}
			<MenuSheet
				visible={menuFor !== null}
				title={menuFor?.title ?? ""}
				testID="session-menu"
				items={menuFor ? sessionMenuItems(menuFor, folders, setMoveFor, setNameError) : []}
				onClose={() => setMenuFor(null)}
			/>
			<MenuSheet
				visible={folderMenuFor !== null}
				title={directory?.organization.folders.find((f) => f.id === folderMenuFor)?.name ?? ""}
				testID="folder-menu"
				items={
					directory && folderMenuFor
						? folderMenuItems(directory, folderMenuFor, folders, setNameError)
						: []
				}
				onClose={() => setFolderMenuFor(null)}
			/>
			<MoveSheet
				session={moveFor}
				directory={directory}
				onPick={(folderId) => moveFor && moveTo(moveFor, folderId)}
				onNewFolder={moveToNewFolder}
				onClose={() => setMoveFor(null)}
			/>
		</TabScreen>
	);
}

const styles = StyleSheet.create({
	shelf: { gap: SPACE.lg },
	note: { ...TYPE.xs, fontFamily: FONT.ui, paddingHorizontal: SPACE.sm },
});
