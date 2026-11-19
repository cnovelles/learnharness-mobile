/**
 * The node sheet of the Graph tab (issue 08, user decision 2026-11-19,
 * option A): a bottom sheet over the canvas with the node name, the
 * statement with math, then "Sessions". A session row opens the session at
 * the node's message; a notes file row is plain text; a session that is gone
 * on the Mac shows "unlabeled" and opens nothing (error state 16). The sheet
 * has no delete: the phone is read only.
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { NodeSheet as NodeSheetModel, NodeSourceRow } from "@/lib/knowledge";
import { Markdown } from "./markdown";
import { SPACE } from "./spacing";
import { Body, FONT, Icon, LABEL, TYPE, alpha, usePalette } from "./ui";

/** Where a session row goes: the session id and the node's message (null: the normal position). */
export interface SessionTarget {
	chatId: string;
	messageId: string | null;
}

function SourceRow({
	row,
	onOpen,
}: {
	row: NodeSourceRow;
	onOpen: (target: SessionTarget) => void;
}) {
	const c = usePalette();
	if (row.kind === "session")
		return (
			<Pressable
				onPress={() => onOpen({ chatId: row.chatId, messageId: row.messageId })}
				accessibilityRole="link"
				accessibilityLabel={`Open ${row.title}`}
				style={({ pressed }) => [
					styles.row,
					{ borderColor: c.line },
					pressed && { backgroundColor: c.hover },
				]}
				testID={`node-source-${row.chatId}`}
			>
				<Text style={[styles.rowText, { color: c.text }]} numberOfLines={2}>
					{row.title}
				</Text>
				<Icon name="chevron.right" size={12} color={c.muted} />
			</Pressable>
		);
	const text = row.kind === "file" ? row.path : row.label;
	return (
		<View style={[styles.row, { borderColor: c.line }]} testID={`node-source-${row.sourceId}`}>
			<Text
				style={[
					styles.rowText,
					row.kind === "file" ? styles.file : null,
					{ color: row.kind === "file" ? c.text : alpha(c.muted, 0.8) },
				]}
				numberOfLines={2}
			>
				{text}
			</Text>
		</View>
	);
}

export function NodeSheet({
	sheet,
	onClose,
	onOpen,
}: {
	sheet: NodeSheetModel | null;
	onClose: () => void;
	onOpen: (target: SessionTarget) => void;
}) {
	const c = usePalette();
	return (
		<Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={onClose}>
			<View style={styles.frame}>
				<Pressable
					style={styles.backdrop}
					onPress={onClose}
					accessibilityRole="button"
					accessibilityLabel="Close"
					testID="node-sheet-backdrop"
				/>
				{sheet ? (
					<SafeAreaView
						edges={["bottom"]}
						style={[styles.sheet, { backgroundColor: c.panel, borderColor: c.line }]}
						testID="node-sheet"
					>
						<View style={[styles.grabber, { backgroundColor: c.line }]} />
						<View style={styles.header}>
							<Text
								style={[styles.name, { color: c.text }]}
								accessibilityRole="header"
								testID="node-sheet-name"
							>
								{sheet.name}
							</Text>
							<Pressable
								onPress={onClose}
								hitSlop={SPACE.sm}
								accessibilityRole="button"
								accessibilityLabel="Close"
								testID="node-sheet-close"
							>
								<Icon name="xmark" size={14} color={c.muted} />
							</Pressable>
						</View>
						<ScrollView contentContainerStyle={styles.body}>
							<Markdown text={sheet.statement} style={[styles.statement, { color: c.text }]} />
							<Text style={[LABEL, { color: c.muted }]}>Sessions</Text>
							{sheet.empty ? (
								<Body muted testID="node-sheet-empty">
									{sheet.empty}
								</Body>
							) : (
								<View>
									{sheet.rows.map((row) => (
										<SourceRow
											key={row.kind === "session" ? row.chatId : row.sourceId}
											row={row}
											onOpen={onOpen}
										/>
									))}
								</View>
							)}
						</ScrollView>
					</SafeAreaView>
				) : null}
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	frame: { flex: 1, justifyContent: "flex-end" },
	backdrop: { ...StyleSheet.absoluteFill },
	sheet: {
		maxHeight: "60%",
		borderTopLeftRadius: 14,
		borderTopRightRadius: 14,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: SPACE.lg,
	},
	grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: SPACE.sm },
	header: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: SPACE.md,
		paddingTop: SPACE.md,
		paddingBottom: SPACE.sm,
	},
	name: { ...TYPE.lg, fontFamily: FONT.title, fontWeight: "700", flex: 1 },
	body: { gap: SPACE.md, paddingBottom: SPACE.lg },
	statement: { ...TYPE.base },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		paddingVertical: SPACE.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	rowText: { ...TYPE.sm, fontFamily: FONT.prose, flex: 1 },
	file: { fontFamily: FONT.ui, ...TYPE.xs },
});
