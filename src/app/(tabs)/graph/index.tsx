/**
 * The Graph tab (issue 20). The graph comes with issue 08; until then the
 * tab shows a short note (user decision 2026-11-17).
 */
import { StyleSheet, Text } from "react-native";

import { SPACE } from "@/components/spacing";
import { TabScreen } from "@/components/tab-screen";
import { FONT, TYPE, usePalette } from "@/components/ui";

export default function GraphTab() {
	const c = usePalette();
	return (
		<TabScreen title="Graph">
			<Text style={[styles.note, { color: c.muted }]} testID="graph-placeholder">
				The graph comes in a later update.
			</Text>
		</TabScreen>
	);
}

const styles = StyleSheet.create({
	note: { ...TYPE.xs, fontFamily: FONT.ui, paddingHorizontal: SPACE.sm },
});
