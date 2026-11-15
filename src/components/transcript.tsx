/**
 * The session transcript: learner text, teacher text, reasoning (closed by
 * default, tap to open), the answered question cards, the probe assessment
 * (src/components/probe-card.tsx), the lesson plan, the phase dividers,
 * and a short line for other tools. The teacher's text is
 * Markdown (issue 05, src/components/markdown.tsx); the learner's own text
 * stays plain, as on the desktop.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AnsweredCard } from "@/lib/answer-card";
import { PHASE_LABEL } from "@/lib/plan";
import { PlanBlock } from "./plan-graph";
import type { TranscriptRow } from "@/lib/transcript";
import type { ToolRowData } from "@/lib/tool-row";
import { Markdown } from "./markdown";
import { ProbeCard } from "./probe-card";
import { ConfidenceRail } from "./confidence-rail";
import { FONT, LABEL, TYPE, alpha, usePalette } from "./ui";
import { SPACE } from "./spacing";

const stepCount = (n: number) => `${n} step${n === 1 ? "" : "s"}`;

type QuestionRow = Extract<TranscriptRow, { kind: "question" }>;

const TOOL_LABEL: Record<string, string> = {
	probe: "Probe",
	recall: "Recall",
	quiz: "Check",
	explain: "Explain",
	ask_user_question: "Question",
};

/** The phase seam: a quiet rule with the label ("Plan · 4 steps", "Teaching"). */
function Divider({ row }: { row: Extract<TranscriptRow, { kind: "divider" }> }) {
	const c = usePalette();
	const label =
		row.phase === "plan" && row.steps ? `Plan · ${stepCount(row.steps)}` : PHASE_LABEL[row.phase];
	return (
		<View style={styles.divider} testID={`phase-divider-${row.phase}`} accessibilityRole="header">
			<View style={[styles.rule, { borderColor: c.line }]} />
			<Text style={[LABEL, { color: c.muted }]}>{label.toUpperCase()}</Text>
			<View style={[styles.rule, { borderColor: c.line }]} />
		</View>
	);
}

function Tucked({
	title,
	text,
	testID,
	defaultOpen = false,
	markdown = false,
}: {
	title: string;
	text: string;
	testID: string;
	defaultOpen?: boolean;
	/** The teacher's text (Why) is Markdown; the learner's own text is not. */
	markdown?: boolean;
}) {
	const c = usePalette();
	const [open, setOpen] = useState(defaultOpen);
	return (
		<Pressable
			onPress={() => setOpen((o) => !o)}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			testID={testID}
		>
			<Text style={[LABEL, { color: c.muted }]}>
				{title} {open ? "▴" : "▾"}
			</Text>
			{open ? (
				markdown ? (
					<View style={[styles.why, { backgroundColor: c.bg }]}>
						<Markdown text={text} compact style={[styles.small, { color: c.text }]} />
					</View>
				) : (
					<Text style={[styles.thought, { color: c.muted }]}>{text}</Text>
				)
			) : null}
		</Pressable>
	);
}

function AnswerCardView({ id, card }: { id: string; card: AnsweredCard }) {
	const c = usePalette();
	const verdict =
		card.verdict === "correct"
			? { text: "correct", color: c.ok }
			: card.verdict === "incorrect"
				? { text: "incorrect", color: c.danger }
				: card.verdict === "didntKnow"
					? { text: "didn't know", color: c.muted }
					: null;
	return (
		<>
			{card.readingThinking ? (
				<View style={[styles.rail, { borderColor: alpha(c.muted, 0.3) }]} testID={`reading-${id}`}>
					<Text style={[LABEL, { color: c.muted }]}>YOUR THINKING</Text>
					<Text style={[styles.thought, { color: c.muted }]}>{card.readingThinking}</Text>
				</View>
			) : null}
			<View
				style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
				testID={`question-${id}`}
			>
				<View style={styles.head}>
					<Text style={[LABEL, { color: c.muted }]}>{card.label.toUpperCase()}</Text>
					{verdict ? (
						<Text
							style={[
								LABEL,
								styles.badge,
								{
									color: verdict.color,
									backgroundColor:
										card.verdict === "didntKnow" ? c.hover : alpha(verdict.color, 0.15),
								},
							]}
							testID={`verdict-${id}`}
						>
							{verdict.text.toUpperCase()}
						</Text>
					) : null}
				</View>
				<Markdown
					text={card.question}
					style={[styles.body, { color: c.text, fontWeight: "600" }]}
				/>
				{card.options.map((o, i) => (
					<View
						key={i}
						style={[styles.option, optionTint(c, o.selected, o.mark)]}
						accessibilityLabel={`${o.label}${o.selected ? ", your choice" : ""}${
							o.mark === "check" ? ", correct" : o.mark === "x" ? ", wrong" : ""
						}`}
						testID={`answered-option-${id}-${i}`}
					>
						<Text style={[styles.mark, { color: o.mark === "check" ? c.ok : c.danger }]}>
							{o.mark === "check" ? "✓" : o.mark === "x" ? "✗" : " "}
						</Text>
						<View style={styles.optionText}>
							<Markdown
								text={o.label}
								compact
								style={[
									styles.small,
									{ color: o.selected ? c.text : c.muted, fontWeight: o.selected ? "600" : "400" },
								]}
							/>
						</View>
					</View>
				))}
				{card.other ? (
					<View style={[styles.option, { borderColor: c.primary }]}>
						<Text style={[styles.small, { color: c.text }]}>“{card.other}”</Text>
					</View>
				) : null}
				{card.text ? <Text style={[styles.body, { color: c.text }]}>“{card.text}”</Text> : null}
				{card.confidence !== undefined ? (
					<ConfidenceRail value={card.confidence} testID={`confidence-${id}`} />
				) : null}
				{card.verdict === "didntKnow" ? (
					<Text style={[styles.small, { color: c.muted }]}>Answered “I don&apos;t know”.</Text>
				) : null}
				{card.thinking ? (
					<Tucked title="Your thinking" text={card.thinking} testID={`thinking-${id}`} />
				) : null}
				{card.explanation ? (
					<Tucked title="Why" text={card.explanation} testID={`why-${id}`} markdown />
				) : null}
				{card.committed ? (
					<View style={[styles.reveal, { backgroundColor: c.bg }]} testID={`committed-${id}`}>
						<Text style={[LABEL, { color: c.muted }]}>THE ANSWER</Text>
						<Markdown text={card.committed} compact style={[styles.small, { color: c.text }]} />
					</View>
				) : null}
			</View>
		</>
	);
}

function QuestionCard({ row }: { row: QuestionRow }) {
	const c = usePalette();
	if (row.status === "answered" && row.card) return <AnswerCardView id={row.id} card={row.card} />;
	return (
		<View
			style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
			testID={`question-${row.id}`}
		>
			<Text style={[LABEL, { color: c.muted }]}>
				{(TOOL_LABEL[row.tool] ?? "Question").toUpperCase()}
			</Text>
			<Markdown text={row.question} style={[styles.body, { color: c.text, fontWeight: "600" }]} />
			<Text style={[styles.note, { color: row.status === "malformed" ? c.danger : c.muted }]}>
				{row.status === "malformed"
					? "This question is not complete, so the phone cannot show it."
					: row.status === "skipped"
						? "You skipped this question."
						: row.status === "unreadable"
							? "Answered. The phone cannot show this answer."
							: "Waiting for your answer."}
			</Text>
		</View>
	);
}

function Reasoning({ row }: { row: Extract<TranscriptRow, { kind: "reasoning" }> }) {
	const c = usePalette();
	const [open, setOpen] = useState(false);
	return (
		<Pressable
			onPress={() => setOpen((o) => !o)}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			testID={`reasoning-${row.id}`}
			style={[styles.rail, { borderColor: alpha(c.muted, 0.3) }]}
		>
			<Text style={[LABEL, { color: c.muted }]}>
				{row.streaming ? "AGENT'S THINKING…" : `AGENT'S THINKING ${open ? "▴" : "▾"}`}
			</Text>
			{open ? (
				<Markdown text={row.text} compact style={[styles.thought, { color: c.muted }]} />
			) : null}
		</Pressable>
	);
}

type Mark = AnsweredCard["options"][number]["mark"];

/** The desktop's option tints (answered-card.tsx). */
function optionTint(c: ReturnType<typeof usePalette>, selected: boolean, mark: Mark) {
	if (selected && mark === "check")
		return { borderColor: alpha(c.ok, 0.6), backgroundColor: alpha(c.ok, 0.1) };
	if (selected && mark === "x")
		return { borderColor: alpha(c.danger, 0.6), backgroundColor: alpha(c.danger, 0.1) };
	if (mark === "check") return { borderColor: alpha(c.ok, 0.4) };
	if (selected) return { borderColor: c.primary, backgroundColor: c.hover };
	return { borderColor: c.line };
}

/** A folded tool call, as the desktop's tool-call card. */
function ToolRow({ row }: { row: ToolRowData }) {
	const c = usePalette();
	const [open, setOpen] = useState(false);
	return (
		<Pressable
			onPress={() => setOpen((o) => !o)}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			accessibilityLabel={`${row.failed ? "Failed tool" : "Tool"} ${row.name}${row.arg ? `, ${row.arg}` : ""}`}
			testID={`tool-${row.id}`}
		>
			<View style={styles.toolHead}>
				<Text style={[LABEL, { color: row.failed ? c.danger : c.muted }]}>
					{row.name.toUpperCase()}
				</Text>
				{row.arg ? (
					<Text style={[styles.toolArg, { color: c.muted }]} numberOfLines={1}>
						{row.arg}
					</Text>
				) : null}
				<Text style={[styles.toolArg, { color: c.muted }]}>{open ? "▾" : "▸"}</Text>
			</View>
			{open ? (
				<View
					style={[styles.toolPanel, { borderColor: c.line, backgroundColor: c.panel }]}
					testID={`tool-panel-${row.id}`}
				>
					{row.input ? <ToolBlock title="INPUT" text={row.input} /> : null}
					{row.failed ? (
						<ToolBlock title="ERROR" text="The tool failed." color={c.danger} />
					) : row.output ? (
						<ToolBlock title="OUTPUT" text={row.output} />
					) : null}
					{!row.input && !row.failed && !row.output ? (
						<Text style={[styles.toolText, { color: c.muted }]}>No input or output.</Text>
					) : null}
				</View>
			) : null}
		</Pressable>
	);
}

function ToolBlock({ title, text, color }: { title: string; text: string; color?: string }) {
	const c = usePalette();
	return (
		<View style={styles.toolBlock}>
			<Text style={[LABEL, { color: c.muted }]}>{title}</Text>
			<Text style={[styles.toolText, { color: color ?? c.text }]}>{text}</Text>
		</View>
	);
}

function Row({ row, onOpenPlan }: { row: TranscriptRow; onOpenPlan: () => void }) {
	const c = usePalette();
	switch (row.kind) {
		case "user":
			return (
				<View
					style={[styles.user, { backgroundColor: c.panel, borderColor: alpha(c.muted, 0.3) }]}
					testID={`user-${row.id}`}
				>
					<Text style={[LABEL, { color: c.muted }]}>YOU</Text>
					<Text style={[styles.body, { color: c.text }]}>{row.text}</Text>
				</View>
			);
		case "text":
			return (
				<Markdown
					text={row.text}
					style={[styles.body, { color: c.text }]}
					testID={`text-${row.id}`}
				/>
			);
		case "reasoning":
			return <Reasoning row={row} />;
		case "question":
			return <QuestionCard row={row} />;
		case "plan": {
			const label = `Lesson plan, ${stepCount(row.steps)}. Open the plan.`;
			// The text card: before slice E, and now for a layout that fails.
			const card = (
				<Pressable
					onPress={onOpenPlan}
					accessibilityRole="button"
					accessibilityLabel={label}
					style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
					testID={`plan-${row.id}`}
				>
					<Text style={[LABEL, { color: c.muted }]}>LESSON PLAN</Text>
					<Text style={[styles.body, { color: c.text }]}>
						{stepCount(row.steps)}. Tap to see the steps.
					</Text>
				</Pressable>
			);
			return (
				<PlanBlock id={row.id} tree={row.tree} label={label} onOpen={onOpenPlan} fallback={card} />
			);
		}
		case "probe":
			return <ProbeCard id={row.id} data={row} />;
		case "divider":
			return <Divider row={row} />;
		case "compaction":
			return row.at === "moment" ? (
				<Text
					style={[styles.note, styles.center, { color: c.muted }]}
					testID={`compaction-${row.id}`}
				>
					Context compacted
				</Text>
			) : (
				<View style={styles.divider} testID={`compaction-cut-${row.id}`}>
					<View style={[styles.rule, { borderColor: c.line }]} />
					<Text style={[LABEL, { color: c.muted }]}>
						{`HISTORY COMPACTED${
							row.tokensBefore ? ` · ${Math.round(row.tokensBefore / 1000)}K TOKENS` : ""
						}`}
					</Text>
					<View style={[styles.rule, { borderColor: c.line }]} />
				</View>
			);
		case "tool":
			return <ToolRow row={row} />;
	}
}

export function Transcript({
	rows,
	onOpenPlan,
}: {
	rows: TranscriptRow[];
	/** Opens the lesson map (the Plan sheet). */
	onOpenPlan: () => void;
}) {
	return (
		<View style={styles.list} testID="transcript">
			{rows.map((row) => (
				<Row key={`${row.kind}-${row.id}`} row={row} onOpenPlan={onOpenPlan} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	list: { gap: SPACE.md },
	body: { ...TYPE.prose, fontFamily: FONT.prose },
	small: { ...TYPE.base, fontFamily: FONT.prose },
	/** UI notes: the mono chrome font, as the desktop. */
	note: { ...TYPE.sm, fontFamily: FONT.ui },
	/** The learner's thinking and the agent's thinking: italic, muted. */
	thought: { fontSize: 15, lineHeight: 22, fontFamily: FONT.prose, fontStyle: "italic" },
	/** The learner's message: a full-width band with a rail (desktop chat.tsx). */
	user: {
		borderLeftWidth: 6,
		paddingVertical: SPACE.xs,
		paddingLeft: SPACE.md,
		paddingRight: SPACE.lg,
		gap: SPACE.xs,
	},
	/** The thinking rows: the same rail, no fill. */
	rail: { borderLeftWidth: 6, paddingLeft: SPACE.md, gap: SPACE.xs },
	card: {
		borderWidth: 1,
		borderRadius: 12,
		padding: SPACE.lg,
		gap: SPACE.sm,
	},
	head: { flexDirection: "row", gap: SPACE.sm, alignItems: "center" },
	badge: { borderRadius: 4, paddingHorizontal: SPACE.xs, overflow: "hidden" },
	option: {
		flexDirection: "row",
		gap: SPACE.sm,
		alignItems: "center",
		borderWidth: 1,
		borderRadius: 8,
		paddingVertical: SPACE.sm,
		paddingHorizontal: SPACE.md,
	},
	mark: { width: 14, fontSize: 14, fontWeight: "700" },
	why: { borderRadius: 8, padding: SPACE.sm, marginTop: SPACE.xs },
	reveal: { borderRadius: 8, padding: SPACE.sm, gap: SPACE.xs },
	optionText: { flex: 1 },
	center: { textAlign: "center" },
	divider: { flexDirection: "row", alignItems: "center", gap: SPACE.md, marginVertical: SPACE.xs },
	rule: { flex: 1, borderTopWidth: 2, borderStyle: "dotted" },
	toolHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	toolArg: { ...TYPE.xs, fontFamily: FONT.ui, flexShrink: 1 },
	toolPanel: {
		marginTop: SPACE.sm,
		borderWidth: 1,
		borderRadius: 12,
		padding: SPACE.md,
		gap: SPACE.sm,
	},
	toolBlock: { gap: SPACE.xs },
	toolText: { fontFamily: FONT.ui, fontSize: 11, lineHeight: 18 },
});
