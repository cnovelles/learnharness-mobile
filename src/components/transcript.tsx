/**
 * The session transcript: learner text, teacher text, reasoning (closed by
 * default, tap to open), the answered question cards, the lesson plan, the
 * phase dividers, and a short line for other tools. The teacher's text is
 * Markdown (issue 05, src/components/markdown.tsx); the learner's own text
 * stays plain, as on the desktop.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AnsweredCard } from "@/lib/answer-card";
import { PHASE_LABEL } from "@/lib/plan";
import type { TranscriptRow } from "@/lib/transcript";
import { Markdown } from "./markdown";
import { usePalette } from "./ui";

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
			<Text style={[styles.label, { color: c.muted }]}>{label.toUpperCase()}</Text>
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
			<Text style={[styles.small, { color: c.muted, fontWeight: "600" }]}>
				{open ? `${title} (tap to close)` : title}
			</Text>
			{open ? (
				markdown ? (
					<Markdown text={text} compact style={[styles.small, { color: c.text }]} />
				) : (
					<Text style={[styles.small, { color: c.text }]}>{text}</Text>
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
				<View style={[styles.thinking, { borderColor: c.line }]} testID={`reading-${id}`}>
					<Text style={[styles.label, { color: c.muted }]}>YOUR THINKING</Text>
					<Text style={[styles.small, { color: c.text }]}>{card.readingThinking}</Text>
				</View>
			) : null}
			<View
				style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
				testID={`question-${id}`}
			>
				<View style={styles.head}>
					<Text style={[styles.label, { color: c.muted }]}>{card.label.toUpperCase()}</Text>
					{verdict ? (
						<Text style={[styles.label, { color: verdict.color }]} testID={`verdict-${id}`}>
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
						style={[
							styles.option,
							{
								borderColor:
									o.mark === "check"
										? c.ok
										: o.mark === "x"
											? c.danger
											: o.selected
												? c.accent
												: c.line,
							},
						]}
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
					<View style={[styles.option, { borderColor: c.accent }]}>
						<Text style={[styles.small, { color: c.text }]}>“{card.other}”</Text>
					</View>
				) : null}
				{card.text ? <Text style={[styles.body, { color: c.text }]}>“{card.text}”</Text> : null}
				{card.confidence !== undefined ? (
					<Text style={[styles.small, { color: c.muted }]} testID={`confidence-${id}`}>
						{card.confidence}% sure
					</Text>
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
						<Text style={[styles.small, { color: c.text, fontWeight: "600" }]}>The answer</Text>
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
			<Text style={[styles.label, { color: c.muted }]}>
				{(TOOL_LABEL[row.tool] ?? "Question").toUpperCase()}
			</Text>
			<Markdown text={row.question} style={[styles.body, { color: c.text, fontWeight: "600" }]} />
			<Text style={[styles.small, { color: row.status === "malformed" ? c.danger : c.muted }]}>
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
		>
			<Text style={[styles.small, { color: c.muted }]}>
				{row.streaming ? "Thinking…" : open ? "Thinking (tap to close)" : "Thinking (tap to open)"}
			</Text>
			{open ? (
				<Markdown text={row.text} compact style={[styles.small, { color: c.muted }]} />
			) : null}
		</Pressable>
	);
}

function Row({ row, onOpenPlan }: { row: TranscriptRow; onOpenPlan: () => void }) {
	const c = usePalette();
	switch (row.kind) {
		case "user":
			return (
				<View style={[styles.user, { backgroundColor: c.accent }]} testID={`user-${row.id}`}>
					<Text style={[styles.body, { color: c.onAccent }]}>{row.text}</Text>
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
		case "plan":
			return (
				<Pressable
					onPress={onOpenPlan}
					accessibilityRole="button"
					accessibilityLabel={`Lesson plan, ${stepCount(row.steps)}. Open the plan.`}
					style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
					testID={`plan-${row.id}`}
				>
					<Text style={[styles.label, { color: c.muted }]}>LESSON PLAN</Text>
					<Text style={[styles.body, { color: c.text }]}>
						{stepCount(row.steps)}. Tap to see the steps.
					</Text>
				</Pressable>
			);
		case "divider":
			return <Divider row={row} />;
		case "compaction":
			return row.at === "moment" ? (
				<Text
					style={[styles.small, styles.center, { color: c.muted }]}
					testID={`compaction-${row.id}`}
				>
					Context compacted
				</Text>
			) : (
				<View style={styles.divider} testID={`compaction-cut-${row.id}`}>
					<View style={[styles.rule, { borderColor: c.line }]} />
					<Text style={[styles.label, { color: c.muted }]}>
						{`HISTORY COMPACTED${
							row.tokensBefore ? ` · ${Math.round(row.tokensBefore / 1000)}K TOKENS` : ""
						}`}
					</Text>
					<View style={[styles.rule, { borderColor: c.line }]} />
				</View>
			);
		case "tool":
			return (
				<Text style={[styles.small, { color: row.failed ? c.danger : c.muted }]}>
					{row.failed ? `Tool failed: ${row.name}` : `Tool: ${row.name}`}
				</Text>
			);
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
	list: { gap: 12 },
	body: { fontSize: 16, lineHeight: 23 },
	small: { fontSize: 14, lineHeight: 20 },
	user: { alignSelf: "flex-end", maxWidth: "85%", borderRadius: 14, padding: 12 },
	card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
	label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6 },
	head: { flexDirection: "row", gap: 8, alignItems: "center" },
	option: {
		flexDirection: "row",
		gap: 8,
		alignItems: "center",
		borderWidth: 1,
		borderRadius: 8,
		paddingVertical: 6,
		paddingHorizontal: 10,
	},
	mark: { width: 14, fontSize: 14, fontWeight: "700" },
	thinking: { borderLeftWidth: 3, paddingLeft: 10, gap: 4 },
	reveal: { borderRadius: 8, padding: 8, gap: 2 },
	optionText: { flex: 1 },
	center: { textAlign: "center" },
	divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
	rule: { flex: 1, borderTopWidth: 2, borderStyle: "dotted" },
});
