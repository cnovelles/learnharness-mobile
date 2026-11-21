/**
 * Transcript rows for the phone: a flat list from the shared view messages
 * (projectView). Rows: text, reasoning, question cards, the probe
 * assessment, the lesson plan, the phase dividers and a short line for
 * other tools. Rich rendering
 * (Markdown, math, the plan diagram, visuals) comes in issue 05.
 *
 * Practice rows (issue 06, src/lib/practice.ts): the problem card, the
 * learner's thinking, the conclusion and the "Next problem" line. The
 * problem card stays in the transcript while the dock shows the same
 * problem, as on the desktop: it is the record.
 *
 * Phase dividers (the desktop rules, fork components/chat.tsx):
 * - Planning: at the probe-to-teach handoff marker. It shows the step
 *   count of the first plan that follows ("Plan · 4 steps").
 * - Teaching: where the first tagged check is called (phaseTimeline). When
 *   the call is in a later step of the message, the divider goes at that
 *   step (teachStepIndex), after the plan text.
 */
import { presentAnswer, type AnsweredCard } from "./answer-card";
import { planPartTree } from "./plan";
import {
	CONCLUDE_TOOL,
	PROBLEM_TOOL,
	concludeCardData,
	practiceThinkingData,
	problemCardData,
	type ConcludeCardData,
	type PracticeThinkingData,
	type ProblemCardData,
} from "./practice";
import { probeCardData, type ProbeCardData } from "./probe-card";
import { teacherText } from "./teacher-text";
import { toolRow, type ToolRowData } from "./tool-row";
import {
	QUESTION_TOOLS,
	phaseTimeline,
	teachStepIndex,
	type LhViewMessage,
	type Phase3,
	type PlanTree,
} from "./shared";

export type QuestionStatus =
	/** The question waits for the learner. */
	| "waiting"
	/** The call cannot be shown as a question (bad input); the learner can ask again. */
	| "malformed"
	/** The learner skipped the question. */
	| "skipped"
	/** An answer that the phone can show as a card. */
	| "answered"
	/** An answer record that the phone cannot read. It shows a plain line, never raw data. */
	| "unreadable";

export type TranscriptRow =
	| { kind: "user"; id: string; text: string }
	// `text` of a text or reasoning row is the text as the Mac stores it. The
	// row repairs it with teacherText when it draws (components/transcript.tsx),
	// because the screen draws only the last rows of a long session.
	| { kind: "text"; id: string; text: string; streaming: boolean }
	| { kind: "reasoning"; id: string; text: string; streaming: boolean }
	| {
			kind: "question";
			id: string;
			tool: string;
			question: string;
			status: QuestionStatus;
			/** Only for status "answered". */
			card?: AnsweredCard;
	  }
	| { kind: "plan"; id: string; steps: number; tree: PlanTree }
	/** The probe_done assessment (issue 05 slice D). */
	| ({ kind: "probe"; id: string } & ProbeCardData)
	| { kind: "divider"; id: string; phase: Exclude<Phase3, "probe">; steps?: number }
	/** Practice (issue 06). */
	| ({ kind: "problem"; id: string } & ProblemCardData)
	| ({ kind: "practice-thinking"; id: string } & PracticeThinkingData)
	| { kind: "conclude"; id: string; data: ConcludeCardData }
	| { kind: "practice-next"; id: string }
	/** Compaction: "moment" where it ran, "cut" where the kept history starts. */
	| { kind: "compaction"; id: string; at: "moment" | "cut"; tokensBefore?: number }
	| ToolRowData;

const isQuestionTool = (name: string) => (QUESTION_TOOLS as readonly string[]).includes(name);

export interface TranscriptOptions {
	/** Question calls with bad input (the shared malformedQuestionsOf). */
	malformedCallIds?: ReadonlySet<string>;
	/** The question that the dock shows now. The transcript leaves it out, as on the desktop. */
	dockCallId?: string;
}

/** The step count of the first plan in or after message `from`. */
function stepsAfter(messages: readonly LhViewMessage[], from: number): number | undefined {
	for (let m = from; m < messages.length; m++)
		for (const part of messages[m]!.parts) {
			const tree = planPartTree(part);
			if (tree) return tree.nodes.length;
		}
	return undefined;
}

type Part = LhViewMessage["parts"][number];

function questionRow(
	part: Part,
	id: string,
	name: string,
	malformedCallIds: ReadonlySet<string>,
): TranscriptRow {
	const input = (part.input ?? {}) as { question?: unknown };
	const question = typeof input.question === "string" ? teacherText(input.question) : "";
	if (part.state !== "output-available")
		return {
			kind: "question",
			id,
			tool: name,
			question,
			status: part.toolCallId && malformedCallIds.has(part.toolCallId) ? "malformed" : "waiting",
		};
	const presented = presentAnswer(part.output, part.input, name);
	if (presented === "skipped")
		return { kind: "question", id, tool: name, question, status: "skipped" };
	if (!presented) return { kind: "question", id, tool: name, question, status: "unreadable" };
	return {
		kind: "question",
		id,
		tool: name,
		question: presented.question || question,
		status: "answered",
		card: presented,
	};
}

export function transcriptRows(
	messages: readonly LhViewMessage[],
	{ malformedCallIds = new Set(), dockCallId }: TranscriptOptions = {},
): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	const phases = phaseTimeline(messages);
	messages.forEach((m, mi) => {
		if (m.role === "user" && m.parts.some((p) => p.type === "data-probe-handoff")) {
			const steps = stepsAfter(messages, mi + 1);
			rows.push({
				kind: "divider",
				id: `plan-${m.id}`,
				phase: "plan",
				...(steps ? { steps } : {}),
			});
			return;
		}
		const teachSeam =
			m.role === "assistant" && mi > 0 && phases[mi] === "teach" && phases[mi - 1] !== "teach";
		const teachAt = teachSeam ? teachStepIndex(m.parts) : -2;
		if (teachAt === -1) rows.push({ kind: "divider", id: `teach-${m.id}`, phase: "teach" });
		m.parts.forEach((part, i) => {
			if (i === teachAt) rows.push({ kind: "divider", id: `teach-${m.id}`, phase: "teach" });
			const id = part.id ?? part.toolCallId ?? `${m.id}-${i}`;
			const text = typeof part.text === "string" ? part.text : "";
			const streaming = part.state === "streaming";
			if (part.type === "text") {
				if (!text.trim()) return;
				rows.push(
					m.role === "user" ? { kind: "user", id, text } : { kind: "text", id, text, streaming },
				);
			} else if (part.type === "data-compaction" || part.type === "data-compaction-cut") {
				const before = (part.data as { details?: { tokensBefore?: unknown } } | undefined)?.details
					?.tokensBefore;
				rows.push({
					kind: "compaction",
					id,
					at: part.type === "data-compaction" ? "moment" : "cut",
					...(typeof before === "number" && before > 0 ? { tokensBefore: before } : {}),
				});
			} else if (part.type === "data-practice-thinking") {
				rows.push({ kind: "practice-thinking", id, ...practiceThinkingData(part) });
			} else if (part.type === "data-practice-next") {
				rows.push({ kind: "practice-next", id });
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
					rows.push(questionRow(part, id, name, malformedCallIds));
				} else if (
					(name === PROBLEM_TOOL || name === CONCLUDE_TOOL) &&
					part.state !== "output-error"
				) {
					// A call with an error goes back to the agent, which tries
					// again: it stays the quiet failed tool line below.
					rows.push(
						name === PROBLEM_TOOL
							? { kind: "problem", id, ...problemCardData(part) }
							: { kind: "conclude", id, data: concludeCardData(part) },
					);
				} else if (name === "probe_done") {
					rows.push({ kind: "probe", id, ...probeCardData(part) });
				} else if (name.startsWith("plan_")) {
					const tree = planPartTree(part);
					if (tree) rows.push({ kind: "plan", id, steps: tree.nodes.length, tree });
					else
						rows.push(
							toolRow(
								part,
								id,
								name,
								part.state === "output-error" ||
									(part.state === "output-available" &&
										(part.output as { ok?: unknown } | null)?.ok === false),
							),
						);
				} else rows.push(toolRow(part, id, name, part.state === "output-error"));
			}
		});
	});
	return rows;
}
