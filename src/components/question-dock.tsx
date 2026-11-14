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
 * Skip (at the bottom of the dock, user decision 2026-11-14) asks first:
 * "Skip this question? The teacher moves on without it." While the Mac
 * compacts, Send answer waits (`waiting`).
 */
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

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
import { Body, Button, Field, Panel, usePalette } from "./ui";

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
					borderColor: selected ? c.accent : c.line,
					backgroundColor: selected ? c.bg : "transparent",
				},
			]}
		>
			<Text style={[styles.choiceText, { color: c.text, fontWeight: selected ? "600" : "400" }]}>
				{label}
			</Text>
			{detail ? <Text style={[styles.small, { color: c.muted }]}>{detail}</Text> : null}
		</Pressable>
	);
}

function Confidence({ index, onChange }: { index: number; onChange: (index: number) => void }) {
	const c = usePalette();
	return (
		<View style={{ gap: 6 }}>
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
								borderColor: i === index ? c.accent : c.line,
								backgroundColor: i === index ? c.accent : "transparent",
							},
						]}
					>
						<Text style={{ color: i === index ? c.onAccent : c.text, fontSize: 14 }}>{stop}%</Text>
					</Pressable>
				))}
			</View>
		</View>
	);
}

/** Skip, with a confirm. */
function SkipButton({ onSkip }: { onSkip: () => Promise<void> }) {
	const [busy, setBusy] = useState(false);
	function confirm() {
		Alert.alert("Skip this question?", "The teacher moves on without it.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Skip",
				style: "destructive",
				onPress: () => {
					setBusy(true);
					void onSkip().finally(() => setBusy(false));
				},
			},
		]);
	}
	return <Button title="Skip" kind="plain" onPress={confirm} busy={busy} testID="skip-question" />;
}

function DockForm({
	qd,
	tool,
	draft,
	onDraft,
	onSubmit,
	onSkip,
	waiting,
}: {
	qd: QuestionData;
	tool: string;
	draft: QuestionDraft | undefined;
	onDraft: (draft: Partial<QuestionDraft>) => void;
	onSubmit: (answer: QuestionAnswerData) => Promise<boolean>;
	onSkip: () => Promise<void>;
	waiting: boolean;
}) {
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
			<Body style={{ fontWeight: "600" }} testID="dock-question">
				{qd.question}
			</Body>
			{qd.context ? <Body muted>{qd.context}</Body> : null}
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
							label={o.label}
							detail={o.description}
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
			<SkipButton onSkip={onSkip} />
		</Panel>
	);
}

/** The closed check: a short preview and Open, with the reading-thinking field. */
function RevealBar({
	qd,
	readingThinking,
	onReadingThinking,
	onOpen,
	onSkip,
}: {
	qd: QuestionData;
	readingThinking: string;
	onReadingThinking: (text: string) => void;
	onOpen: () => void;
	onSkip: () => Promise<void>;
}) {
	const preview = qd.question.length > 90 ? `${qd.question.slice(0, 90)}…` : qd.question;
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
				<View testID="reveal-check" style={{ gap: 6 }}>
					<Body style={{ fontWeight: "600" }}>Check your understanding</Body>
					<Body muted>{preview}</Body>
				</View>
				<Button title="Open" onPress={onOpen} testID="reveal-open" />
				<SkipButton onSkip={onSkip} />
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
	onSkip,
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
	onSkip: () => Promise<void>;
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
				onSkip={onSkip}
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
			onSkip={onSkip}
			waiting={waiting}
		/>
	);
}

const styles = StyleSheet.create({
	choice: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 2 },
	choiceText: { fontSize: 15, lineHeight: 21 },
	small: { fontSize: 13, lineHeight: 18 },
	stops: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	stop: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
});
