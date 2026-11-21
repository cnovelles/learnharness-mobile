/**
 * The answered question card (issue 04 slice B), from the saved answer
 * record and the question call. The rules are the desktop's (fork
 * components/answered-card.tsx):
 * - answerForPresentation gives the question text, the options, the
 *   explanation (quiz) and the committed answer (explain) from the call.
 * - Quiz answers are graded: correct, incorrect or didn't know, ✓ on the
 *   correct options and ✗ on a wrong choice. Ask and explain answers have
 *   no grade.
 * - A record that the phone cannot read gives null: the screen shows a
 *   plain line, never the raw record.
 */
import { answerForPresentation, type QuestionAnswerData } from "./shared";
import { teacherText } from "./teacher-text";

export type CardLabel = "Probe" | "Recall" | "Prediction" | "Check" | "Explain" | "Question";

export interface CardOption {
	label: string;
	selected: boolean;
	/** Quiz only: ✓ on a correct option, ✗ on a wrong choice. */
	mark?: "check" | "x";
}

export interface AnsweredCard {
	label: CardLabel;
	question: string;
	/** Quiz only. */
	verdict?: "correct" | "incorrect" | "didntKnow";
	options: CardOption[];
	/** Ask: the learner's own option. */
	other?: string;
	/** Ask or explain: the text answer. */
	text?: string;
	/** Quiz only, 0–100. */
	confidence?: number;
	thinking?: string;
	readingThinking?: string;
	/** Quiz: the explanation behind "Why". */
	explanation?: string;
	/** Explain: the teacher's answer ("The answer"). */
	committed?: string;
}

const KINDS = new Set(["quiz", "explain", "ask"]);

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** The minimum shape that the card needs. Other fields are checked one by one. */
function isAnswerRecord(v: unknown): v is QuestionAnswerData {
	if (typeof v !== "object" || v === null) return false;
	const a = v as { kind?: unknown; answers?: unknown };
	return (
		typeof a.kind === "string" &&
		KINDS.has(a.kind) &&
		Array.isArray(a.answers) &&
		a.answers.every(
			(x) =>
				typeof x === "object" && x !== null && typeof (x as { index?: unknown }).index === "number",
		)
	);
}

export function cardLabel(answer: {
	kind: string;
	tool?: string;
	questionType?: string;
}): CardLabel {
	if (answer.tool === "probe") return "Probe";
	if (answer.tool === "recall") return "Recall";
	if (answer.kind === "quiz") return answer.questionType === "predict" ? "Prediction" : "Check";
	if (answer.kind === "explain") return "Explain";
	return "Question";
}

/**
 * The card for an answer record, "skipped" for a skipped question, or null
 * for a record that the phone cannot read.
 */
export function presentAnswer(
	output: unknown,
	input: unknown,
	tool: string,
): AnsweredCard | "skipped" | null {
	if (
		typeof output === "object" &&
		output !== null &&
		(output as { dismissed?: unknown }).dismissed === true
	)
		return "skipped";
	if (!isAnswerRecord(output)) return null;
	let a: QuestionAnswerData = output;
	try {
		a = answerForPresentation(output, input);
	} catch (e) {
		// The saved record is still correct. Show it without the call's text.
		console.warn("[answer-card] answerForPresentation failed:", e);
	}
	const isQuiz = a.kind === "quiz";
	const selected = new Set(a.answers.map((x) => x.index));
	const correct = new Set(
		Array.isArray(a.correctIndices) ? a.correctIndices.filter((i) => typeof i === "number") : [],
	);
	const options: CardOption[] = (Array.isArray(a.options) ? a.options : [])
		.filter(
			(o): o is { index: number; label: string } =>
				typeof o === "object" &&
				o !== null &&
				typeof o.index === "number" &&
				typeof o.label === "string",
		)
		.map((o) => {
			const sel = selected.has(o.index);
			const key = isQuiz && correct.has(o.index);
			const mark = !isQuiz ? undefined : key ? "check" : sel ? "x" : undefined;
			return { label: teacherText(o.label), selected: sel, ...(mark ? { mark } : {}) };
		});
	const card: AnsweredCard = {
		label: cardLabel({
			kind: a.kind,
			tool: typeof a.tool === "string" ? a.tool : tool,
			questionType: typeof a.questionType === "string" ? a.questionType : undefined,
		}),
		question: teacherText(str(a.questionText) ?? ""),
		options,
	};
	if (isQuiz)
		card.verdict = a.dontKnow === true ? "didntKnow" : a.correct === true ? "correct" : "incorrect";
	const other = str(a.other);
	if (other) card.other = other;
	const text = str(a.text);
	if (text) card.text = text;
	if (
		isQuiz &&
		a.dontKnow !== true &&
		typeof a.confidence === "number" &&
		Number.isFinite(a.confidence)
	)
		card.confidence = Math.round(a.confidence);
	const thinking = str(a.thinking) ?? str(a.note);
	if (thinking) card.thinking = thinking;
	const reading = str(a.readingThinking);
	if (reading) card.readingThinking = reading;
	const explanation = isQuiz ? str(a.explanation) : undefined;
	if (explanation) card.explanation = teacherText(explanation);
	const committed = a.kind === "explain" ? str(a.committed) : undefined;
	if (committed) card.committed = teacherText(committed);
	return card;
}
