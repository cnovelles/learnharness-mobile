/**
 * Folder changes from the phone (issue 20, slice D; user decisions
 * 2026-11-17, mockups shown again 2026-11-18):
 * - A long press on a session row opens a menu: "Move to folder…" and "Rename".
 * - "Move to folder…" opens a sheet with all folders (depth first, by name),
 *   "Not in a folder" and "New folder…".
 * - The "…" on a folder label opens a menu: Rename, New subfolder, Delete.
 *   Delete is grey on a folder that is not empty, and a tap on it says
 *   "Move the sessions out first."; on an empty folder it is red and asks first.
 * - A failed change shows a banner, and the list stays as it was.
 * The logic and the texts are in src/lib/folder-actions.ts.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMacFetch } from "@/lib/connection-context";
import {
	NOT_EMPTY,
	canDeleteFolder,
	checkName,
	describeFolderError,
	folderChoices,
	folderOfSession,
} from "@/lib/folder-actions";
import { changeFolders } from "@/lib/graph-api";
import type { ChatListItem, OrganizationAction, SourceDirectory } from "@/lib/shared";
import type { UserMessage } from "@/lib/user-error";
import { SPACE } from "./spacing";
import { FONT, Icon, TYPE, usePalette } from "./ui";

type SymbolName = Parameters<typeof Icon>[0]["name"];

export interface MenuItem {
	label: string;
	icon: SymbolName;
	testID: string;
	onPress: () => void;
	/** `danger`: red. `muted`: grey, but it still answers a tap. */
	tone?: "normal" | "danger" | "muted";
}

/** A small menu at the bottom of the screen, with Cancel. */
export function MenuSheet({
	visible,
	title,
	items,
	onClose,
	testID,
}: {
	visible: boolean;
	title: string;
	items: readonly MenuItem[];
	onClose: () => void;
	testID: string;
}) {
	const c = usePalette();
	// iOS cannot show a sheet or a prompt while this menu is still closing,
	// so the chosen item runs after the menu is gone (`onDismiss`).
	const chosen = useRef<(() => void) | null>(null);
	const runChosen = () => {
		const next = chosen.current;
		chosen.current = null;
		next?.();
	};
	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onClose}
			onDismiss={runChosen}
		>
			{/* The backdrop is its own layer, so VoiceOver still reads each item. */}
			<View style={styles.backdrop}>
				<Pressable
					style={StyleSheet.absoluteFill}
					onPress={onClose}
					accessibilityRole="button"
					accessibilityLabel="Close the menu"
					testID={`${testID}-backdrop`}
				/>
				<SafeAreaView edges={["bottom"]} style={styles.menuArea}>
					<View
						testID={testID}
						style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}
					>
						<Text style={[styles.menuTitle, { color: c.muted }]} numberOfLines={1}>
							{title}
						</Text>
						{items.map((item) => {
							const color =
								item.tone === "danger" ? c.danger : item.tone === "muted" ? c.muted : c.text;
							return (
								<Pressable
									key={item.testID}
									testID={item.testID}
									accessibilityRole="button"
									accessibilityLabel={item.label}
									onPress={() => {
										chosen.current = item.onPress;
										onClose();
									}}
									style={({ pressed }) => [
										styles.item,
										{ borderTopColor: c.line },
										pressed ? { backgroundColor: c.hover } : null,
									]}
								>
									<Icon name={item.icon} size={16} color={color} />
									<Text style={[styles.itemText, { color }]}>{item.label}</Text>
								</Pressable>
							);
						})}
					</View>
					<Pressable
						testID={`${testID}-cancel`}
						accessibilityRole="button"
						onPress={onClose}
						style={({ pressed }) => [
							styles.card,
							styles.cancel,
							{ backgroundColor: pressed ? c.hover : c.panel, borderColor: c.line },
						]}
					>
						<Text style={[styles.cancelText, { color: c.text }]}>Cancel</Text>
					</Pressable>
				</SafeAreaView>
			</View>
		</Modal>
	);
}

/** One row of the Move sheet. */
function MoveRow({
	testID,
	label,
	depth = 0,
	chosen = false,
	onPress,
	icon,
	accent = false,
	first = false,
}: {
	testID: string;
	label: string;
	depth?: number;
	chosen?: boolean;
	onPress: () => void;
	icon?: SymbolName;
	accent?: boolean;
	first?: boolean;
}) {
	const c = usePalette();
	return (
		<Pressable
			testID={testID}
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ selected: chosen }}
			onPress={onPress}
			style={({ pressed }) => [
				styles.moveRow,
				{
					borderTopColor: c.line,
					borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
					paddingLeft: SPACE.md + depth * SPACE.lg,
				},
				pressed ? { backgroundColor: c.hover } : null,
			]}
		>
			{icon ? <Icon name={icon} size={15} color={accent ? c.accent : c.muted} /> : null}
			<Text
				style={[styles.itemText, styles.moveLabel, { color: accent ? c.accent : c.text }]}
				numberOfLines={1}
			>
				{label}
			</Text>
			{chosen ? <Icon name="checkmark" size={14} color={c.accent} /> : null}
		</Pressable>
	);
}

/** The "Move to folder" sheet: all folders, "Not in a folder", and "New folder…". */
export function MoveSheet({
	session,
	directory,
	onPick,
	onNewFolder,
	onClose,
}: {
	session: ChatListItem | null;
	directory: SourceDirectory | null;
	onPick: (folderId: string | null) => void;
	/** Runs after the sheet is gone, so the name prompt can show. */
	onNewFolder: (session: ChatListItem) => void;
	onClose: () => void;
}) {
	const c = usePalette();
	const pending = useRef<(() => void) | null>(null);
	const runPending = () => {
		const next = pending.current;
		pending.current = null;
		next?.();
	};
	const pickNewFolder = useCallback(() => {
		if (!session) return;
		const target = session;
		pending.current = () => onNewFolder(target);
		onClose();
	}, [session, onNewFolder, onClose]);
	const choices = useMemo(
		() => (directory ? folderChoices(directory.organization) : []),
		[directory],
	);
	const current = session && directory ? folderOfSession(directory, session.id) : null;
	return (
		<Modal
			visible={session !== null}
			animationType="slide"
			presentationStyle="pageSheet"
			onRequestClose={onClose}
			onDismiss={runPending}
		>
			<SafeAreaView style={[styles.sheet, { backgroundColor: c.bg }]} testID="move-sheet">
				<View style={[styles.sheetHeader, { borderColor: c.line }]}>
					<Pressable
						onPress={onClose}
						accessibilityRole="button"
						hitSlop={SPACE.md}
						testID="move-cancel"
					>
						<Text style={[styles.itemText, { color: c.muted }]}>Cancel</Text>
					</Pressable>
					<Text
						style={[styles.sheetTitle, { color: c.text }]}
						numberOfLines={1}
						accessibilityRole="header"
					>
						Move “{session?.title ?? ""}”
					</Text>
				</View>
				<ScrollView contentContainerStyle={styles.sheetBody}>
					<View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
						{choices.map(({ folder, depth }, i) => (
							<MoveRow
								key={folder.id}
								testID={`move-to-${folder.id}`}
								label={folder.name}
								depth={depth}
								chosen={current === folder.id}
								onPress={() => onPick(folder.id)}
								icon="folder"
								first={i === 0}
							/>
						))}
						<MoveRow
							testID="move-to-none"
							label="Not in a folder"
							chosen={current === null}
							onPress={() => onPick(null)}
							first={choices.length === 0}
						/>
					</View>
					<View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
						<MoveRow
							testID="move-new-folder"
							label="New folder…"
							onPress={pickNewFolder}
							icon="plus"
							accent
							first
						/>
					</View>
				</ScrollView>
			</SafeAreaView>
		</Modal>
	);
}

/** Asks for a name (iOS prompt). Calls `onName` only with a good name. */
export function askName(
	title: string,
	initial: string,
	onName: (name: string) => void,
	onBadName: (message: UserMessage) => void,
) {
	Alert.prompt(
		title,
		undefined,
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Save",
				onPress: (raw?: string) => {
					const checked = checkName(raw ?? "");
					if (checked.ok) onName(checked.name);
					else onBadName(checked.message);
				},
			},
		],
		"plain-text",
		initial,
	);
}

export interface FolderActions {
	/** The banner text of the last failed change, or null. */
	error: UserMessage | null;
	clearError: () => void;
	/** Sends one change. Gives the new folder id after "create-folder", else null; undefined when it failed. */
	run: (action: OrganizationAction) => Promise<string | null | undefined>;
}

/**
 * Sends folder changes. A good answer gives the new folders to `apply` at
 * once (the `sources-changed` event also reads them again). A failure keeps
 * the list as it was and sets `error`.
 */
export function useFolderActions(apply: (directory: SourceDirectory) => void): FolderActions {
	const macFetch = useMacFetch();
	const [error, setError] = useState<UserMessage | null>(null);
	const run = useCallback(
		async (action: OrganizationAction) => {
			try {
				const result = await changeFolders(macFetch, action);
				apply(result.directory);
				setError(null);
				return result.createdFolderId;
			} catch (e) {
				setError(describeFolderError(e));
				return undefined;
			}
		},
		[macFetch, apply],
	);
	const clearError = useCallback(() => setError(null), []);
	return { error, clearError, run };
}

/** The menu items of a session row. */
export function sessionMenuItems(
	session: ChatListItem,
	actions: FolderActions,
	openMove: (session: ChatListItem) => void,
	onBadName: (message: UserMessage) => void,
): MenuItem[] {
	return [
		{
			label: "Move to folder…",
			icon: "folder",
			testID: "menu-move",
			onPress: () => openMove(session),
		},
		{
			label: "Rename",
			icon: "pencil",
			testID: "menu-rename",
			onPress: () =>
				askName(
					"Rename session",
					session.title,
					(name) => void actions.run({ action: "rename-source", id: session.id, name }),
					onBadName,
				),
		},
	];
}

/** The menu items of a folder label ("…"). */
export function folderMenuItems(
	directory: SourceDirectory,
	folderId: string,
	actions: FolderActions,
	onBadName: (message: UserMessage) => void,
): MenuItem[] {
	const folder = directory.organization.folders.find((f) => f.id === folderId);
	if (!folder) return [];
	const empty = canDeleteFolder(directory, folderId);
	return [
		{
			label: "Rename",
			icon: "pencil",
			testID: "folder-menu-rename",
			onPress: () =>
				askName(
					"Rename folder",
					folder.name,
					(name) => void actions.run({ action: "rename-folder", id: folderId, name }),
					onBadName,
				),
		},
		{
			label: "New subfolder",
			icon: "folder.badge.plus",
			testID: "folder-menu-subfolder",
			onPress: () =>
				askName(
					"New subfolder",
					"",
					(name) => void actions.run({ action: "create-folder", name, parentId: folderId }),
					onBadName,
				),
		},
		{
			label: "Delete",
			icon: "trash",
			testID: "folder-menu-delete",
			tone: empty ? "danger" : "muted",
			onPress: () =>
				empty
					? Alert.alert(`Delete “${folder.name}”?`, "The folder is empty.", [
							{ text: "Cancel", style: "cancel" },
							{
								text: "Delete",
								style: "destructive",
								onPress: () => void actions.run({ action: "delete-folder", id: folderId }),
							},
						])
					: Alert.alert(NOT_EMPTY),
		},
	];
}

const styles = StyleSheet.create({
	backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
	menuArea: { padding: SPACE.md, gap: SPACE.sm },
	/** The inset grouped card of the shelf: `panel`, a `line` border, radius 14. */
	card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
	menuTitle: {
		...TYPE.xs,
		fontFamily: FONT.ui,
		textAlign: "center",
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
	},
	item: {
		minHeight: 48,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.md,
		paddingHorizontal: SPACE.lg,
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	itemText: { fontFamily: FONT.prose, fontSize: 16, lineHeight: 21 },
	cancel: { minHeight: 48, alignItems: "center", justifyContent: "center" },
	cancelText: { fontFamily: FONT.prose, fontSize: 16, lineHeight: 21, fontWeight: "600" },
	sheet: { flex: 1 },
	sheetHeader: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.md,
		paddingHorizontal: SPACE.lg,
		paddingVertical: SPACE.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	sheetTitle: { ...TYPE.lg, fontFamily: FONT.prose, fontWeight: "600", flex: 1 },
	sheetBody: { padding: SPACE.lg, gap: SPACE.lg },
	moveLabel: { flex: 1 },
	moveRow: {
		minHeight: 44,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		paddingRight: SPACE.md,
	},
});
