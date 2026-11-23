/**
 * The graph pipeline cost (issue 08 slice F): the cost number under
 * "Chains", and the cost sheet that a tap on it opens. The sheet shows the
 * desktop `GraphCostPanel` rows: the total, one row for each stage (cost,
 * then the tokens on a second line, so a row fits on the iPhone SE), and the
 * recent runs. Read only. The texts come from `src/lib/pipeline-cost.ts`.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";

import { COST_SHEET_TITLE, type CostSheetModel } from "@/lib/pipeline-cost";
import { BottomSheet } from "./bottom-sheet";
import { SPACE } from "./spacing";
import { FONT, TYPE, usePalette } from "./ui";

/** The cost number: a tap opens the cost sheet. */
export function CostNumber({ text, onPress }: { text: string; onPress: () => void }) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			hitSlop={SPACE.sm}
			accessibilityRole="button"
			accessibilityLabel={`Graph costs, ${text}`}
			accessibilityHint="Opens the graph pipeline costs."
			style={({ pressed }) => [styles.number, pressed && { backgroundColor: c.panel }]}
			testID="graph-cost"
		>
			<Text style={[styles.numberText, { color: c.muted }]}>{text}</Text>
		</Pressable>
	);
}

export function CostSheet({
	sheet,
	onClose,
}: {
	sheet: CostSheetModel | null;
	onClose: () => void;
}) {
	const c = usePalette();
	return (
		<BottomSheet
			visible={sheet !== null}
			onClose={onClose}
			testID="cost-sheet"
			title={
				sheet ? (
					<View style={styles.header}>
						<Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
							{COST_SHEET_TITLE}
						</Text>
						<Text style={[styles.num, { color: c.text }]} testID="cost-sheet-total">
							{sheet.total}
							{sheet.unpriced ? <Text style={{ color: c.muted }}> {sheet.unpriced}</Text> : null}
						</Text>
					</View>
				) : null
			}
		>
			{sheet ? (
				<>
					<View style={styles.stages}>
						{sheet.stages.map((stage) => (
							<View
								key={stage.label}
								accessible
								accessibilityLabel={`${stage.label}, ${stage.cost}${stage.unpriced ? `, ${stage.unpriced}` : ""}, ${stage.tokens}`}
								testID={`cost-stage-${stage.label.toLowerCase()}`}
							>
								<View style={styles.row}>
									<Text style={[styles.label, { color: c.muted }]}>{stage.label}</Text>
									<Text style={[styles.num, { color: c.text }]}>
										{stage.cost}
										{stage.unpriced ? (
											<Text style={{ color: c.muted }}> {stage.unpriced}</Text>
										) : null}
									</Text>
								</View>
								<Text style={[styles.num, styles.tokens, { color: c.muted }]}>{stage.tokens}</Text>
							</View>
						))}
					</View>
					<View style={[styles.runs, { borderTopColor: c.line }]}>
						<Text accessibilityRole="header" style={[styles.label, { color: c.muted }]}>
							Recent runs
						</Text>
						{sheet.runs.map((run) => (
							<View
								key={run.key}
								style={styles.row}
								accessible
								accessibilityLabel={`${run.age}, ${run.title}${run.merged ? `, ${run.merged}` : ""}, ${run.cost}`}
								testID="cost-run"
							>
								<Text style={[styles.runTitle, { color: c.muted }]} numberOfLines={1}>
									<Text style={{ color: c.text }}>{run.age}</Text> {run.title}
									{run.merged ? ` ${run.merged}` : ""}
								</Text>
								<Text style={[styles.num, { color: c.text }]}>{run.cost}</Text>
							</View>
						))}
					</View>
				</>
			) : null}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	number: {
		alignSelf: "flex-end",
		paddingHorizontal: SPACE.sm,
		paddingVertical: SPACE.xs,
		borderRadius: 6,
	},
	numberText: { ...TYPE.xs, fontFamily: FONT.ui, fontVariant: ["tabular-nums"] },
	header: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm, flexWrap: "wrap" },
	title: { ...TYPE.base, fontFamily: FONT.ui, fontWeight: "500", flexGrow: 1 },
	stages: { gap: SPACE.sm },
	row: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm },
	label: { ...TYPE.xs, fontFamily: FONT.ui, flex: 1 },
	num: { ...TYPE.xs, fontFamily: FONT.ui, fontVariant: ["tabular-nums"] },
	tokens: { alignSelf: "flex-end" },
	runs: { gap: SPACE.xs, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SPACE.sm },
	runTitle: { ...TYPE.xs, fontFamily: FONT.ui, flex: 1 },
});
