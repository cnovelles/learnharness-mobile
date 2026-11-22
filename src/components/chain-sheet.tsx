/**
 * The chain sheet of the Chains screen (issue 08 slice D, user choice 3C):
 * a bottom sheet with the chain line, then the statement of each member
 * with math, then "Open <session>" for the session where the conclusion
 * was born. A notes source or an unlabeled source has no button. Only one
 * chain draws math at a time, so the WebView count stays low (issue 21).
 */
import { StyleSheet, Text, View } from "react-native";

import type { ChainSheet as ChainSheetModel } from "@/lib/knowledge";
import { BottomSheet } from "./bottom-sheet";
import { ChainChips } from "./chain-line";
import type { SessionTarget } from "./node-sheet";
import { Markdown } from "./markdown";
import { SPACE } from "./spacing";
import { Button, FONT, TYPE, usePalette } from "./ui";

export function ChainSheet({
	sheet,
	onClose,
	onOpen,
}: {
	sheet: ChainSheetModel | null;
	onClose: () => void;
	onOpen: (target: SessionTarget) => void;
}) {
	const c = usePalette();
	return (
		<BottomSheet
			visible={sheet !== null}
			onClose={onClose}
			testID="chain-sheet"
			title={
				sheet ? (
					<View accessible accessibilityRole="header" accessibilityLabel={sheet.line.text}>
						<ChainChips line={sheet.line} large />
					</View>
				) : null
			}
		>
			{sheet ? (
				<>
					{sheet.statements.map((s) => (
						<View key={s.id} style={styles.statement} testID={`chain-statement-${s.id}`}>
							<Text style={[styles.name, { color: c.text }]}>{s.name}</Text>
							<Markdown text={s.statement} style={[styles.text, { color: c.text }]} />
						</View>
					))}
					{sheet.open ? (
						<Button
							title={`Open ${sheet.open.title}`}
							kind="plain"
							onPress={() =>
								onOpen({ chatId: sheet.open!.chatId, messageId: sheet.open!.messageId })
							}
							testID="chain-sheet-open"
						/>
					) : null}
				</>
			) : null}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	statement: { gap: SPACE.xs },
	name: { ...TYPE.sm, fontFamily: FONT.prose, fontWeight: "700" },
	text: { ...TYPE.base },
});
