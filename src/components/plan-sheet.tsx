/**
 * The lesson map as a sheet (issue 04 slice B, user decision 2026-11-14):
 * the steps of the latest plan as an indented list, each step marked
 * current, done or upcoming (src/lib/plan.ts). The "Plan" button in the
 * session header opens it. Issue 05 slice E puts the graph with the step
 * statuses on top of the list (user decision 2026-11-15); when the layout
 * fails, only the list shows (error state 14).
 */
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PlanStep, StepStatus } from "@/lib/plan";
import type { PlanTree } from "@/lib/shared";
import { PlanSheetGraph } from "./plan-graph";
import { alpha, Body, FONT, Icon, LABEL, TYPE, usePalette, type Palette } from "./ui";
import { SPACE } from "./spacing";

const STATUS_TEXT: Record<StepStatus, string> = {
	current: "Now",
	done: "Done",
	upcoming: "Next",
};

/** The desktop's current-node glow is yellow-400; the mark uses yellow-500 so
 *  that it reads on the Ivory page too (user decision 2026-11-15, mockup). */
const CURRENT_MARK = "#eab308";

function StepMark({ status, c }: { status: StepStatus; c: Palette }) {
	if (status === "done") return <Icon name="checkmark" size={14} color={c.ok} />;
	return (
		<Text style={[styles.mark, { color: status === "current" ? CURRENT_MARK : c.muted }]}>
			{status === "current" ? "●" : "○"}
		</Text>
	);
}

function StepRow({ step }: { step: PlanStep }) {
	const c = usePalette();
	const upcoming = step.status === "upcoming";
	return (
		<View
			style={[styles.step, { marginLeft: Math.min(step.depth, 6) * SPACE.lg, borderColor: c.line }]}
			accessibilityLabel={`${step.title}. ${STATUS_TEXT[step.status]}.`}
			testID={`plan-step-${step.id}`}
		>
			<View style={styles.markBox}>
				<StepMark status={step.status} c={c} />
			</View>
			<View style={styles.stepText}>
				<Text
					style={[
						styles.title,
						{
							color: upcoming ? alpha(c.muted, 0.8) : c.text,
							fontWeight: step.status === "current" ? "600" : "400",
						},
					]}
				>
					{step.title}
				</Text>
				{step.summary ? (
					<Text style={[styles.summary, { color: c.muted }]}>{step.summary}</Text>
				) : null}
			</View>
			<Text
				style={[LABEL, styles.status, { color: step.status === "current" ? c.text : c.muted }]}
				testID={`plan-step-status-${step.id}`}
			>
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
					<View style={[styles.header, { borderColor: c.line }]}>
						<Text style={[styles.sheetTitle, { color: c.text }]} accessibilityRole="header">
							The plan
						</Text>
						<Pressable
							onPress={onClose}
							accessibilityRole="button"
							accessibilityLabel="Close"
							hitSlop={SPACE.md}
							testID="plan-close"
							style={({ pressed }) => [
								styles.close,
								{ backgroundColor: pressed ? c.hover : "transparent" },
							]}
						>
							<Icon name="xmark" size={16} color={c.muted} />
						</Pressable>
					</View>
					<ScrollView contentContainerStyle={styles.list} scrollEnabled={!graphActive}>
						{steps && steps.length > 0 ? (
							<>
								{tree ? (
									<View style={styles.graph}>
										<PlanSheetGraph tree={tree} statuses={statuses} onActive={setGraphActive} />
									</View>
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
		paddingHorizontal: SPACE.lg,
		paddingVertical: SPACE.md,
		borderBottomWidth: 1,
	},
	sheetTitle: { ...TYPE.xl, fontFamily: FONT.title, fontWeight: "700" },
	close: { padding: SPACE.sm, borderRadius: 12 },
	list: { padding: SPACE.lg, paddingBottom: SPACE.xxl },
	graph: { marginBottom: SPACE.sm },
	step: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: SPACE.md,
		borderBottomWidth: 1,
		paddingVertical: SPACE.md,
	},
	markBox: { width: 16, height: 24, alignItems: "center", justifyContent: "center" },
	mark: { fontSize: 14, lineHeight: 24 },
	stepText: { flex: 1, gap: SPACE.xs },
	title: { ...TYPE.prose, fontFamily: FONT.prose },
	summary: { ...TYPE.base, fontFamily: FONT.prose },
	status: { lineHeight: 24 },
});
