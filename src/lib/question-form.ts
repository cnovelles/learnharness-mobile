/**
 * The question form of the phone's question dock, as plain functions over
 * the shared question code (fork src/core/question-core.ts). The rules are
 * the desktop dock's rules (components/question-dock.tsx):
 * - Single select: a choice replaces the one before. Multi select: choices add up.
 * - "I don't know" clears the choice; a choice turns "I don't know" off.
 * - Quiz answers (probe, quiz) always carry the confidence; buildAnswer
 *   drops it for "I don't know". 50% is the resting value.
 * - Text questions (recall, explain, ask without options) need text.
 */
import {
	CONFIDENCE_STOPS,
	DEFAULT_CONFIDENCE_INDEX,
	buildAnswer,
	emptyDockSelection,
	toggleOption,
	toggleOther,
	type AnswerRequest,
	type DockSelection,
	type QuestionAnswerData,
	type QuestionData,
} from "./shared";

export interface QuestionForm {
	selection: DockSelection;
	thinking: string;
	other: string;
	text: string;
	confidenceIndex: number;
}

export function newQuestionForm(): QuestionForm {
	return {
		selection: emptyDockSelection(),
		thinking: "",
		other: "",
		text: "",
		confidenceIndex: DEFAULT_CONFIDENCE_INDEX,
	};
}

const selectMode = (qd: QuestionData) =>
	qd.mode === "multi-select" ? ("multi-select" as const) : ("single-select" as const);

export function chooseOption(qd: QuestionData, form: QuestionForm, index: number): QuestionForm {
	return { ...form, selection: toggleOption(selectMode(qd), form.selection, index) };
}

export function chooseOther(qd: QuestionData, form: QuestionForm): QuestionForm {
	return { ...form, selection: toggleOther(selectMode(qd), form.selection) };
}

export function setDontKnow(form: QuestionForm, on: boolean): QuestionForm {
	return {
		...form,
		selection: on ? { ...emptyDockSelection(), dontKnow: true } : emptyDockSelection(),
	};
}

export function setConfidence(form: QuestionForm, index: number): QuestionForm {
	const max = CONFIDENCE_STOPS.length - 1;
	return { ...form, confidenceIndex: Math.max(0, Math.min(max, Math.round(index))) };
}

export function canSubmit(qd: QuestionData, form: QuestionForm): boolean {
	if (qd.mode === "text") return form.text.trim().length > 0;
	const sel = form.selection;
	return sel.dontKnow || sel.selected.size > 0 || (sel.otherSelected && form.other.trim() !== "");
}

function requestFor(qd: QuestionData, form: QuestionForm): AnswerRequest {
	const sel = form.selection;
	return {
		dontKnow: sel.dontKnow,
		values: [...sel.selected].flatMap((i) => (qd.options[i] ? [qd.options[i]!.value] : [])),
		other: sel.otherSelected ? form.other : undefined,
		text: qd.mode === "text" ? form.text : undefined,
		thinking: qd.mode !== "text" ? form.thinking.trim() || undefined : undefined,
		confidence: qd.kind === "quiz" ? CONFIDENCE_STOPS[form.confidenceIndex] : undefined,
	};
}

/** The answer record for submitAnswer: the same record as the desktop dock makes. */
export function answerFor(qd: QuestionData, form: QuestionForm, tool: string): QuestionAnswerData {
	return buildAnswer(qd, requestFor(qd, form), tool);
}
