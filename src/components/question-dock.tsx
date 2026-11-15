/**
 * The question dock: the form for the question that waits (probe, quiz,
 * recall, explain, ask). The rules are in src/lib/question-form.ts; the
 * question data and the answer record come from the shared code, so the
 * Mac gets the same answer as from the desktop dock.
 *
 * A teach-phase check waits closed behind "Check your understanding" with
 * the reading-thinking field (src/lib/reveal.ts). The form and the reading
 * thinking are kept in the session's question draft, so a refused answer
 * or a turn that interrupts the dock does not lose them.
 *
 * The form starts with the kind label, as on the desktop: PROBE, RECALL,
 * PREDICTION, CHECK, EXPLAIN or QUESTION. The teacher's text goes through
 * teacherText (literal "\n" becomes a line break), as on the desktop.
 *
 * There is no Skip (user decision 2026-11-14): "I don't know" gives the
 * teacher an honest answer, and the desktop has no skip button either.
 * While the Mac compacts, Send answer waits (`waiting`).
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { cardLabel } from "@/lib/answer-card";
import {
	type QuestionForm,
	answerFor,
	canSubmit,
	chooseOption,
	chooseOther,
	newQuestionForm,
	setConfidence,
	setDontKnow,
} from "@/lib/question-form";
import type { RevealPlan } from "@/lib/reveal";
import {
	CONFIDENCE_STOPS,
	questionDataForCall,
	type QuestionAnswerData,
	type QuestionData,
	type QuestionDraft,
} from "@/lib/shared";
import { markdownPreview } from "@/lib/markdown";
import { teacherText } from "@/lib/teacher-text";
import { Markdown } from "./markdown";
import { confidenceColor } from "./confidence-rail";
import { Body, Button, FONT, Field, LABEL, Panel, alpha, usePalette } from "./ui";
import { SPACE } from "./spacing";

export interface PendingQuestionCall {
	tool: string;
	toolCallId: string;
	input: unknown;
	/** The pending question's key (the shared pendingQuestionOf), for its draft. */
	key: string;
}

function Choice({
	label,
	detail,
	selected,
	multi,
	onPress,
	testID,
}: {
	label: string;
	detail?: string;
	selected: boolean;
	multi: boolean;
	onPress: () => void;
	testID: string;
}) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			testID={testID}
			accessibilityRole={multi ? "checkbox" : "radio"}
			accessibilityState={multi ? { checked: selected } : { selected }}
			style={[
				styles.choice,
				{
					borderColor: selected ? c.primary : c.line,
					backgroundColor: selected ? c.hover : "transparent",
				},
			]}
		>
			<Markdown
				text={label}
				compact
				style={[styles.choiceText, { color: c.text, fontWeight: selected ? "600" : "400" }]}
			/>
			{detail ? (
				<Markdown text={detail} compact style={[styles.small, { color: c.muted }]} />
			) : null}
		</Pressable>
	);
}

function Confidence({ index, onChange }: { index: number; onChange: (index: number) => void }) {
	const c = usePalette();
	return (
		<View style={{ gap: SPACE.sm }}>
			<Body muted>How sure are you?</Body>
			<View style={styles.stops} accessibilityRole="radiogroup">
				{CONFIDENCE_STOPS.map((stop, i) => (
					<Pressable
						key={stop}
						onPress={() => onChange(i)}
						testID={`confidence-${stop}`}
						accessibilityRole="radio"
						accessibilityLabel={`${stop} percent`}
						accessibilityState={{ selected: i === index }}
						style={[
							styles.stop,
							{
								borderColor: i === index ? confidenceColor(stop) : c.line,
								backgroundColor: i === index ? alpha(confidenceColor(stop), 0.15) : "transparent",
							},
						]}
					>
						<Text
							numberOfLines={1}
							adjustsFontSizeToFit
							style={{ color: c.text, fontSize: 13, fontFamily: FONT.ui }}
						>
							{stop}%
						</Text>
					</Pressable>
				))}
			</View>
		</View>
	);
}

/** The kind label at the top of the form, the desktop dock's text. */
export function dockLabel(qd: QuestionData, tool: string): string {
	const label = cardLabel({ kind: qd.kind, tool, questionType: qd.questionType }).toUpperCase();
	return qd.mode === "multi-select" ? `${label} · SELECT ALL THAT APPLY` : label;
}

function DockForm({
	qd,
	tool,
	draft,
	onDraft,
	onSubmit,
	waiting,
}: {
	qd: QuestionData;
	tool: string;
	draft: QuestionDraft | undefined;
	onDraft: (draft: Partial<QuestionDraft>) => void;
	onSubmit: (answer: QuestionAnswerData) => Promise<boolean>;
	waiting: boolean;
}) {
	const c = usePalette();
	const [form, setFormState] = useState(() => draft?.form ?? newQuestionForm());
	function setForm(next: QuestionForm) {
		setFormState(next);
		onDraft({ form: next });
	}
	const [sending, setSending] = useState(false);
	const multi = qd.mode === "multi-select";
	const ask = qd.kind === "ask";
	const ready = canSubmit(qd, form);

	async function submit() {
		if (!ready || sending || waiting) return;
		setSending(true);
		try {
			await onSubmit(answerFor(qd, form, tool, draft?.readingThinking));
		} finally {
			setSending(false);
		}
	}

	return (
		<Panel>
			<Text style={[styles.kind, { color: c.muted }]} testID="dock-kind">
				{dockLabel(qd, tool)}
			</Text>
			<Markdown
				text={teacherText(qd.question)}
				style={[styles.body, { color: c.text, fontWeight: "600" }]}
				testID="dock-question"
			/>
			{qd.context ? (
				<Markdown text={teacherText(qd.context)} style={[styles.body, { color: c.muted }]} />
			) : null}
			{qd.mode === "text" ? (
				<Field
					value={form.text}
					onChangeText={(text) => setForm({ ...form, text })}
					label="Your answer"
					placeholder="Your answer"
					multiline
					testID="answer-text"
				/>
			) : (
				<>
					{qd.options.map((o, i) => (
						<Choice
							key={o.value}
							label={teacherText(o.label)}
							detail={o.description ? teacherText(o.description) : undefined}
							selected={form.selection.selected.has(i)}
							multi={multi}
							onPress={() => setForm(chooseOption(qd, form, i))}
							testID={`option-${o.value}`}
						/>
					))}
					{ask ? (
						<Choice
							label="Other…"
							selected={form.selection.otherSelected}
							multi={multi}
							onPress={() => setForm(chooseOther(qd, form))}
							testID="option-other"
						/>
					) : null}
					{ask && form.selection.otherSelected ? (
						<Field
							value={form.other}
							onChangeText={(other) => setForm({ ...form, other })}
							label="Your own answer"
							placeholder="Your own answer"
							testID="other-text"
						/>
					) : null}
					{qd.kind === "quiz" ? (
						<Choice
							label="I don't know"
							selected={form.selection.dontKnow}
							multi={false}
							onPress={() => setForm(setDontKnow(form, !form.selection.dontKnow))}
							testID="dont-know"
						/>
					) : null}
					{qd.kind === "quiz" && !form.selection.dontKnow ? (
						<Confidence
							index={form.confidenceIndex}
							onChange={(i) => setForm(setConfidence(form, i))}
						/>
					) : null}
					<Field
						value={form.thinking}
						onChangeText={(thinking) => setForm({ ...form, thinking })}
						label="Your thinking"
						placeholder="Your thinking (optional)"
						multiline
						testID="thinking"
					/>
				</>
			)}
			<Button
				title="Send answer"
				onPress={() => void submit()}
				disabled={!ready || waiting}
				busy={sending}
				testID="submit-answer"
			/>
		</Panel>
	);
}

/** The closed check: a short preview and Open, with the reading-thinking field. */
function RevealBar({
	qd,
	readingThinking,
	onReadingThinking,
	onOpen,
}: {
	qd: QuestionData;
	readingThinking: string;
	onReadingThinking: (text: string) => void;
	onOpen: () => void;
}) {
	const preview = markdownPreview(teacherText(qd.question));
	return (
		<>
			<Field
				value={readingThinking}
				onChangeText={onReadingThinking}
				label="Your thinking while you read"
				placeholder="Whatever comes to mind as you read."
				multiline
				testID="reading-thinking"
			/>
			<Panel>
				<View testID="reveal-check" style={{ gap: SPACE.sm }}>
					<Body style={{ fontWeight: "600" }}>Check your understanding</Body>
					<Body muted>{preview}</Body>
				</View>
				<Button title="Open" onPress={onOpen} testID="reveal-open" />
			</Panel>
		</>
	);
}

export function QuestionDock({
	call,
	reveal,
	opened,
	onOpen,
	draft,
	onDraft,
	onSubmit,
	waiting = false,
}: {
	call: PendingQuestionCall;
	reveal: RevealPlan;
	/** The learner opened this check. */
	opened: boolean;
	onOpen: () => void;
	draft: QuestionDraft | undefined;
	onDraft: (draft: Partial<QuestionDraft>) => void;
	onSubmit: (answer: QuestionAnswerData) => Promise<boolean>;
	/** The Mac compacts: the answer waits. */
	waiting?: boolean;
}) {
	const qd = useMemo(
		() =>
			questionDataForCall(call.tool, call.toolCallId, call.input, (m) =>
				console.warn(`question: ${m}`),
			),
		[call.tool, call.toolCallId, call.input],
	);
	const [readingThinking, setReadingThinking] = useState(draft?.readingThinking ?? "");
	const closed = reveal.needsReveal && !reveal.openOnArrival && !opened;
	if (closed)
		return (
			<RevealBar
				qd={qd}
				readingThinking={readingThinking}
				onReadingThinking={(text) => {
					setReadingThinking(text);
					onDraft({ readingThinking: text });
				}}
				onOpen={onOpen}
			/>
		);
	// A new question gets a new form (or its draft).
	return (
		<DockForm
			key={call.key}
			qd={qd}
			tool={call.tool}
			draft={draft}
			onDraft={onDraft}
			onSubmit={onSubmit}
			waiting={waiting}
		/>
	);
}

const styles = StyleSheet.create({
	kind: LABEL,
	/** The desktop dock options: rounded-lg (12 in the fork's ladder). */
	choice: { borderWidth: 1, borderRadius: 12, padding: SPACE.md, gap: SPACE.xs },
	body: { fontSize: 15, lineHeight: 21, fontFamily: FONT.prose },
	choiceText: { fontSize: 15, lineHeight: 21, fontFamily: FONT.prose },
	small: { fontSize: 13, lineHeight: 18, fontFamily: FONT.prose },
	// One row of equal stops on every iPhone width (375 pt and up): no wrap.
	stops: { flexDirection: "row", gap: SPACE.sm },
	stop: {
		flex: 1,
		minWidth: 0,
		alignItems: "center",
		borderWidth: 1,
		borderRadius: 8,
		paddingVertical: SPACE.sm,
		paddingHorizontal: SPACE.xs,
	},
});
