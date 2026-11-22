/**
 * The bottom sheet frame of the Graph tab (issue 08): the node sheet and the
 * chain sheet. A modal that slides up over the screen, with a grabber, a
 * title, a close button, and a body that scrolls. A tap on the backdrop
 * closes it. The testIDs start with `testID` (`node-sheet`, `chain-sheet`).
 */
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SPACE } from "./spacing";
import { Icon, usePalette } from "./ui";

export function BottomSheet({
	visible,
	title,
	onClose,
	testID,
	children,
}: {
	visible: boolean;
	/** The header content (the name or the chain line). */
	title: ReactNode;
	onClose: () => void;
	testID: string;
	children: ReactNode;
}) {
	const c = usePalette();
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<View style={styles.frame}>
				<Pressable
					style={styles.backdrop}
					onPress={onClose}
					accessibilityRole="button"
					accessibilityLabel="Close"
					testID={`${testID}-backdrop`}
				/>
				{visible ? (
					<SafeAreaView
						edges={["bottom"]}
						style={[styles.sheet, { backgroundColor: c.panel, borderColor: c.line }]}
						testID={testID}
					>
						<View style={[styles.grabber, { backgroundColor: c.line }]} />
						<View style={styles.header}>
							<View style={styles.title}>{title}</View>
							<Pressable
								onPress={onClose}
								hitSlop={SPACE.sm}
								accessibilityRole="button"
								accessibilityLabel="Close"
								testID={`${testID}-close`}
							>
								<Icon name="xmark" size={14} color={c.muted} />
							</Pressable>
						</View>
						{/* The body shrinks to the sheet height, or it cannot scroll. */}
						<ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
							{children}
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
	title: { flex: 1 },
	scroll: { flexShrink: 1 },
	body: { gap: SPACE.md, paddingBottom: SPACE.lg },
});
