/**
 * The lesson map as a sheet (issue 04 slice B, user decision 2026-11-14):
 * the steps of the latest plan as an indented list, each step marked
 * current, done or upcoming (src/lib/plan.ts). The "Plan" button in the
 * session header opens it. Issue 05 slice E puts the graph with the step
 * statuses on top of the list (user decision 2026-11-15); when the layout
 * fails, only the list shows (error state 14).
 */
import { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PlanStep, StepStatus } from "@/lib/plan";
import type { PlanTree } from "@/lib/shared";
import { PlanSheetGraph } from "./plan-graph";
import { Body, Button, Title, usePalette } from "./ui";
import { SPACE } from "./spacing";

const STATUS_TEXT: Record<StepStatus, string> = {
	current: "Now",
	done: "Done",
	upcoming: "Next",
};

const STATUS_MARK: Record<StepStatus, string> = { current: "●", done: "✓", upcoming: "○" };

function StepRow({ step }: { step: PlanStep }) {
	const c = usePalette();
	const color = step.status === "current" ? c.accent : step.status === "done" ? c.ok : c.muted;
	return (
		<View
			style={[styles.step, { marginLeft: Math.min(step.depth, 6) * 16, borderColor: c.line }]}
			accessibilityLabel={`${step.title}. ${STATUS_TEXT[step.status]}.`}
			testID={`plan-step-${step.id}`}
		>
			<Text style={[styles.mark, { color }]}>{STATUS_MARK[step.status]}</Text>
			<View style={styles.stepText}>
				<Text
					style={[
						styles.title,
						{ color: c.text, fontWeight: step.status === "current" ? "700" : "500" },
					]}
				>
					{step.title}
				</Text>
				{step.summary ? (
					<Text style={[styles.summary, { color: c.muted }]}>{step.summary}</Text>
				) : null}
			</View>
			<Text style={[styles.status, { color }]} testID={`plan-step-status-${step.id}`}>
				{STATUS_TEXT[step.status]}
			</Text>
		</View>
	);
}

export function PlanSheet({
	visible,
	steps,
	tree,
	onClose,
}: {
	visible: boolean;
	steps: PlanStep[] | null;
	tree: PlanTree | null;
	onClose: () => void;
}) {
	const c = usePalette();
	const statuses = useMemo(
		() => new Map((steps ?? []).map((s) => [s.id, s.status] as const)),
		[steps],
	);
	// The list stops its scroll while a pinch or drag on the graph runs.
	const [graphActive, setGraphActive] = useState(false);
	return (
		<Modal
			visible={visible}
			animationType="slide"
			presentationStyle="pageSheet"
			onRequestClose={onClose}
		>
			{/* A modal is its own native root: the graph gestures need this. */}
			<GestureHandlerRootView style={styles.sheet}>
				<SafeAreaView style={[styles.sheet, { backgroundColor: c.bg }]} testID="plan-sheet">
					<View style={styles.header}>
						<Title>Lesson plan</Title>
						<Button title="Close" kind="plain" onPress={onClose} testID="plan-close" />
					</View>
					<ScrollView contentContainerStyle={styles.list} scrollEnabled={!graphActive}>
						{steps && steps.length > 0 ? (
							<>
								{tree ? (
									<PlanSheetGraph tree={tree} statuses={statuses} onActive={setGraphActive} />
								) : null}
								{steps.map((s) => (
									<StepRow key={s.id} step={s} />
								))}
							</>
						) : (
							<Body muted testID="plan-empty">
								The teacher has not made a plan yet.
							</Body>
						)}
					</ScrollView>
				</SafeAreaView>
			</GestureHandlerRootView>
		</Modal>
	);
}

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		padding: SPACE.lg,
	},
	list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxl, gap: SPACE.sm },
	step: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: SPACE.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
		paddingVertical: SPACE.md,
	},
	mark: { fontSize: 16, width: 18, textAlign: "center", lineHeight: 22 },
	stepText: { flex: 1, gap: SPACE.xs },
	title: { fontSize: 16, lineHeight: 22 },
	summary: { fontSize: 14, lineHeight: 19 },
	status: { fontSize: 13, fontWeight: "600", lineHeight: 22 },
});
