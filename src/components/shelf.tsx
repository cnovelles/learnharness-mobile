/**
 * The parts of the Teach and Practice tab shelves (issue 20), in the inset
 * grouped style (user decision 2026-11-17): the continue card, and a section
 * label over a rounded card of rows with the count and a chevron on the
 * right. The text comes from src/lib/teach-shelf.ts and
 * src/lib/practice-shelf.ts.
 */
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { perf } from "@/lib/perf";
import { rowNote } from "@/lib/teach-shelf";
import type { ChatListItem } from "@/lib/shared";
import { SPACE } from "./spacing";
import { Button, FONT, Icon, LABEL, Spinner, TYPE, usePalette } from "./ui";

export function openSession(id: string) {
	perf.startOpen(id);
	router.push({ pathname: "/session/[id]", params: { id } });
}

/** The testIDs of a continue card, so the tabs do not share ids. */
export interface ContinueCardIds {
	card: string;
	badge: string;
	line: string;
	button: string;
}

/** A "Continue …" card: the heading, the title and a badge, a mono line, and Continue. */
export function ContinueCardFrame({
	heading,
	chat,
	badge,
	line,
	ids,
}: {
	heading: string;
	chat: ChatListItem;
	badge: string;
	line: string;
	ids: ContinueCardIds;
}) {
	const c = usePalette();
	return (
		<View style={styles.group}>
			<Text style={[LABEL, styles.label, { color: c.muted }]} accessibilityRole="header">
				{heading}
			</Text>
			<View
				testID={ids.card}
				style={[styles.card, styles.continue, { backgroundColor: c.panel, borderColor: c.line }]}
			>
				<View style={styles.continueTop}>
					<Text style={[styles.continueTitle, { color: c.text }]} numberOfLines={2}>
						{chat.title}
					</Text>
					<View style={[styles.badge, { borderColor: c.line }]}>
						{chat.busy ? <Spinner size={10} /> : null}
						<Text style={[styles.badgeText, { color: c.text }]} testID={ids.badge}>
							{badge}
						</Text>
					</View>
				</View>
				<Text style={[LABEL, { color: c.muted }]} testID={ids.line}>
					{line}
				</Text>
				<Button title="Continue" testID={ids.button} onPress={() => openSession(chat.id)} />
			</View>
		</View>
	);
}

/** The count on the right of a row ("12 concepts", "4 problems"), with its testID. */
export interface RowCount {
	text: string;
	testID: string;
}

function Row({
	chat,
	count,
	first,
	onLongPress,
}: {
	chat: ChatListItem;
	count?: RowCount;
	first: boolean;
	onLongPress?: (chat: ChatListItem) => void;
}) {
	const c = usePalette();
	const note = rowNote(chat);
	return (
		// Not `Link asChild`: it drops a style function, and the pressed fill needs one.
		<Pressable
			testID={`session-${chat.id}`}
			accessibilityRole="button"
			onPress={() => openSession(chat.id)}
			onLongPress={onLongPress ? () => onLongPress(chat) : undefined}
			accessibilityHint={onLongPress ? "Long press for more actions." : undefined}
			style={({ pressed }) => [
				styles.row,
				first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
				pressed ? { backgroundColor: c.hover } : null,
			]}
		>
			<View style={styles.rowText}>
				<Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
					{chat.title}
				</Text>
				{note ? (
					<View style={styles.note}>
						{chat.busy ? <Spinner size={10} /> : null}
						<Text style={[styles.noteText, { color: c.accent }]}>{note}</Text>
					</View>
				) : null}
			</View>
			{count ? (
				<Text style={[styles.count, { color: c.muted }]} testID={count.testID}>
					{count.text}
				</Text>
			) : null}
			<Icon name="chevron.right" size={12} color={c.muted} />
		</Pressable>
	);
}

/**
 * One section: the label and a rounded card of rows. `countOf` gives the
 * count of a row, or undefined for no count. With no sessions, the card
 * shows `empty`. `onLongPressRow` opens the row menu; `onMenu` adds a "…"
 * button to the label (the folder menu).
 */
export function ShelfSectionView({
	label,
	testID,
	sessions,
	countOf,
	empty,
	onLongPressRow,
	onMenu,
}: {
	label: string;
	testID: string;
	sessions: readonly ChatListItem[];
	countOf: (chat: ChatListItem) => RowCount | undefined;
	empty?: string;
	onLongPressRow?: (chat: ChatListItem) => void;
	onMenu?: () => void;
}) {
	const c = usePalette();
	return (
		<View style={styles.group} testID={testID}>
			<View style={styles.labelRow}>
				<Text
					style={[LABEL, styles.label, styles.labelText, { color: c.muted }]}
					accessibilityRole="header"
				>
					{label}
				</Text>
				{onMenu ? (
					<Pressable
						testID={`${testID}-menu`}
						accessibilityRole="button"
						accessibilityLabel={`Folder actions for ${label}`}
						onPress={onMenu}
						hitSlop={SPACE.md}
						style={({ pressed }) => [
							styles.menuButton,
							pressed ? { backgroundColor: c.hover } : null,
						]}
					>
						<Icon name="ellipsis" size={14} color={c.muted} />
					</Pressable>
				) : null}
			</View>
			<View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
				{sessions.length === 0 ? (
					<Text style={[styles.empty, { color: c.muted }]}>{empty}</Text>
				) : (
					sessions.map((chat, i) => (
						<Row
							key={chat.id}
							chat={chat}
							first={i === 0}
							count={countOf(chat)}
							onLongPress={onLongPressRow}
						/>
					))
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	group: { gap: SPACE.xs },
	label: { paddingHorizontal: SPACE.xs },
	labelRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	labelText: { flex: 1 },
	menuButton: {
		minWidth: 32,
		minHeight: 24,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 8,
	},
	/** The inset grouped card: `panel`, a `line` border, radius 14. */
	card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
	continue: { padding: SPACE.md, gap: SPACE.sm },
	continueTop: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm },
	continueTitle: { ...TYPE.lg, fontFamily: FONT.title, fontWeight: "700", flex: 1 },
	badge: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 10,
		paddingHorizontal: SPACE.sm,
		minHeight: 20,
	},
	badgeText: { ...TYPE.xs, fontFamily: FONT.ui },
	row: {
		minHeight: 44,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
	},
	rowText: { flex: 1, gap: SPACE.xs },
	title: { fontFamily: FONT.prose, fontSize: 15, lineHeight: 20 },
	note: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
	noteText: { ...TYPE.xs, fontFamily: FONT.ui },
	count: { ...TYPE.sm, fontFamily: FONT.prose },
	empty: { ...TYPE.sm, fontFamily: FONT.prose, padding: SPACE.md },
});
