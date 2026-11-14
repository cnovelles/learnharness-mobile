/**
 * Transcript rows for the phone: a flat list from the shared view messages
 * (projectView). Issue 03 shows text, reasoning, questions and a short line
 * for other tools. Rich rendering (Markdown, math, lesson map, visuals)
 * comes in issue 05.
 */
import { QUESTION_TOOLS, type LhViewMessage, type QuestionAnswerData } from "./shared";

export type TranscriptRow =
	| { kind: "user"; id: string; text: string }
	| { kind: "text"; id: string; text: string; streaming: boolean }
	| { kind: "reasoning"; id: string; text: string; streaming: boolean }
	| {
			kind: "question";
			id: string;
			tool: string;
			question: string;
			/** null while the question waits. */
			answer: string | null;
			/** The call cannot be shown as a question (bad input); the learner can ask again. */
			malformed?: boolean;
			grade?: "correct" | "wrong";
			confidence?: number;
	  }
	| { kind: "tool"; id: string; name: string; failed: boolean };

const isQuestionTool = (name: string) => (QUESTION_TOOLS as readonly string[]).includes(name);

function answerText(a: QuestionAnswerData): string {
	if ((a as { dismissed?: unknown }).dismissed === true) return "Skipped";
	if (a.dontKnow) return "I don't know";
	const parts = [...a.answers.map((o) => o.label)];
	if (a.other) parts.push(a.other);
	if (a.text) parts.push(a.text);
	return parts.join(", ") || "Answered";
}

function isAnswer(value: unknown): value is QuestionAnswerData {
	return typeof value === "object" && value !== null && "kind" in value && "answers" in value;
}

export interface TranscriptOptions {
	/** Question calls with bad input (the shared malformedQuestionsOf). */
	malformedCallIds?: ReadonlySet<string>;
	/** The question that the dock shows now. The transcript leaves it out, as on the desktop. */
	dockCallId?: string;
}

export function transcriptRows(
	messages: readonly LhViewMessage[],
	{ malformedCallIds = new Set(), dockCallId }: TranscriptOptions = {},
): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	for (const m of messages) {
		m.parts.forEach((part, i) => {
			const id = part.id ?? part.toolCallId ?? `${m.id}-${i}`;
			const text = typeof part.text === "string" ? part.text : "";
			const streaming = part.state === "streaming";
			if (part.type === "text") {
				if (!text.trim()) return;
				rows.push(
					m.role === "user" ? { kind: "user", id, text } : { kind: "text", id, text, streaming },
				);
			} else if (part.type === "reasoning") {
				if (text.trim() || streaming) rows.push({ kind: "reasoning", id, text, streaming });
			} else if (part.type.startsWith("tool-")) {
				const name = part.type.slice("tool-".length);
				if (isQuestionTool(name)) {
					if (
						dockCallId !== undefined &&
						part.toolCallId === dockCallId &&
						part.state !== "output-available"
					)
						return;
					const input = (part.input ?? {}) as { question?: unknown };
					const output = part.state === "output-available" ? part.output : undefined;
					const answer = isAnswer(output) ? output : null;
					rows.push({
						kind: "question",
						id,
						tool: name,
						question: typeof input.question === "string" ? input.question : "",
						answer: answer ? answerText(answer) : null,
						...(!answer && part.toolCallId && malformedCallIds.has(part.toolCallId)
							? { malformed: true }
							: {}),
						...(answer && typeof answer.correct === "boolean"
							? { grade: answer.correct ? "correct" : "wrong" }
							: {}),
						...(answer && typeof answer.confidence === "number"
							? { confidence: answer.confidence }
							: {}),
					});
				} else rows.push({ kind: "tool", id, name, failed: part.state === "output-error" });
			}
		});
	}
	return rows;
}
