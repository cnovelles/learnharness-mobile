/**
 * The node sheet of the Graph tab (issue 08, user decision 2026-11-19,
 * option A): a bottom sheet over the canvas with the node name, the
 * statement with math, then "Sessions". A session row opens the session at
 * the node's message; a notes file row is plain text; a session that is gone
 * on the Mac shows "unlabeled" and opens nothing (error state 16). The sheet
 * has no delete: the phone is read only.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { NodeSheet as NodeSheetModel, NodeSourceRow } from "@/lib/knowledge";
import { BottomSheet } from "./bottom-sheet";
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
		<BottomSheet
			visible={sheet !== null}
			onClose={onClose}
			testID="node-sheet"
			title={
				<Text
					style={[styles.name, { color: c.text }]}
					accessibilityRole="header"
					testID="node-sheet-name"
				>
					{sheet?.name}
				</Text>
			}
		>
			{sheet ? (
				<>
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
				</>
			) : null}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	name: { ...TYPE.lg, fontFamily: FONT.title, fontWeight: "700" },
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
