/**
 * A chain line as the desktop draws it (`chain-table.tsx`): the proposition
 * names as outlined chips, the premises joined by ∧ and the conclusion
 * after ⟹ (`A ∧ B ⟹ C`). A chain with no premises is one chip. TeX in a
 * name shows as text (user decision 5, 2026-11-17).
 */
import { StyleSheet, Text, View } from "react-native";

import type { ChainLine } from "@/lib/knowledge";
import { SPACE } from "./spacing";
import { FONT, TYPE, alpha, usePalette } from "./ui";

export function ChainChips({ line, large = false }: { line: ChainLine; large?: boolean }) {
	const c = usePalette();
	const last = line.members.length - 1;
	const text = large ? styles.textLarge : styles.text;
	return (
		<View style={styles.line}>
			{line.members.map((member, i) => (
				<View key={`${member.id}-${i}`} style={styles.item}>
					{i > 0 ? (
						<Text style={[text, styles.glyph, { color: c.text }]}>{i === last ? "⟹" : "∧"}</Text>
					) : null}
					<View
						style={[
							styles.chip,
							{ borderColor: alpha(c.line, 0.7), backgroundColor: alpha(c.hover, 0.5) },
						]}
					>
						<Text style={[text, { color: c.text }]}>{member.name}</Text>
					</View>
				</View>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: SPACE.xs },
	item: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
	glyph: { paddingHorizontal: SPACE.xs },
	chip: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 4,
		paddingHorizontal: SPACE.sm,
		paddingVertical: SPACE.xs,
		flexShrink: 1,
	},
	text: { fontFamily: FONT.prose, fontSize: 13, lineHeight: 17 },
	textLarge: { fontFamily: FONT.prose, ...TYPE.base },
});
