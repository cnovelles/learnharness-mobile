/**
 * Whether a waiting question arrives closed behind "Check your
 * understanding". The rules are the desktop's (fork components/chat.tsx):
 * - questionNeedsReveal: a quiz or explain check in the teach phase (not a
 *   predict question) waits behind the reveal, so the learner reads first.
 * - revealArrival: such a check arrives open when it follows another
 *   question, because the learner is already answering.
 */
import { QUESTION_TOOLS, phaseAt3Lh, questionNeedsReveal, type LhMessage } from "./shared";

export interface RevealPlan {
	/** The question waits behind the reveal and the reading-thinking field. */
	needsReveal: boolean;
	/** The question shows open when it arrives. */
	openOnArrival: boolean;
}

const isQuestionTool = (name: unknown) =>
	typeof name === "string" && (QUESTION_TOOLS as readonly string[]).includes(name);

/** The learner's last input before the call was the answer to another question. */
export function followsQuestion(messages: readonly LhMessage[], toolCallId: string): boolean {
	const at = messages.findIndex(
		(m) =>
			m.role === "assistant" && m.content.some((b) => b.type === "toolCall" && b.id === toolCallId),
	);
	for (let i = at - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "assistant") continue;
		return m.role === "toolResult" && isQuestionTool(m.toolName);
	}
	return false;
}

export function revealPlan(
	messages: readonly LhMessage[],
	call: { tool: string; toolCallId: string; input: unknown },
): RevealPlan {
	const needsReveal = questionNeedsReveal(call.tool, call.input, phaseAt3Lh(messages));
	return {
		needsReveal,
		openOnArrival: !needsReveal || followsQuestion(messages, call.toolCallId),
	};
}
