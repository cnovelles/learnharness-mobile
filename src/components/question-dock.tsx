/**
 * The question dock: the form for the question that waits (probe, quiz,
 * recall, explain, ask). The rules are in src/lib/question-form.ts; the
 * question data and the answer record come from the shared code, so the
 * Mac gets the same answer as from the desktop dock.
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
	answerFor,
	canSubmit,
	chooseOption,
	chooseOther,
	newQuestionForm,
	setConfidence,
	setDontKnow,
} from "@/lib/question-form";
import {
	CONFIDENCE_STOPS,
	questionDataForCall,
	type QuestionAnswerData,
	type QuestionData,
} from "@/lib/shared";
import { Body, Button, Field, Panel, usePalette } from "./ui";

export interface PendingQuestionCall {
	tool: string;
	toolCallId: string;
	input: unknown;
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

function DockForm({
	qd,
	tool,
	onSubmit,
}: {
	qd: QuestionData;
	tool: string;
	onSubmit: (answer: QuestionAnswerData) => Promise<void>;
}) {
	const [form, setForm] = useState(newQuestionForm);
	const [sending, setSending] = useState(false);
	const multi = qd.mode === "multi-select";
	const ask = qd.kind === "ask";
	const ready = canSubmit(qd, form);

	async function submit() {
		if (!ready || sending) return;
		setSending(true);
		try {
			await onSubmit(answerFor(qd, form, tool));
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
				disabled={!ready}
				busy={sending}
				testID="submit-answer"
			/>
		</Panel>
	);
}

export function QuestionDock({
	call,
	onSubmit,
}: {
	call: PendingQuestionCall;
	onSubmit: (answer: QuestionAnswerData) => Promise<void>;
}) {
	const qd = useMemo(
		() =>
			questionDataForCall(call.tool, call.toolCallId, call.input, (m) =>
				console.warn(`question: ${m}`),
			),
		[call.tool, call.toolCallId, call.input],
	);
	// A new question gets a new, empty form.
	return <DockForm key={call.toolCallId} qd={qd} tool={call.tool} onSubmit={onSubmit} />;
}

const styles = StyleSheet.create({
	choice: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 2 },
	choiceText: { fontSize: 15, lineHeight: 21 },
	small: { fontSize: 13, lineHeight: 18 },
	stops: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	stop: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
});
