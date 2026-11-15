/**
 * Native practice records for the tests (issue 06), in the Mac's format
 * (fork src/core/native-messages.ts, src/agent/tool-execute.ts): a problem
 * call and its ack, a conclude call and its ack, and the practice markers.
 */
type Rec = Record<string, unknown>;

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

export const PROBLEM = {
	statement: "Solve $a_n = 3a_{n-1} - 2a_{n-2}$ with $a_0 = 1$, $a_1 = 3$.",
	mode: "composition",
	target: ["n_recurrence"],
	modelSolution: "The roots are 1 and 2, so the closed form is 2 to the n+1, minus 1.",
};

export function assistantMsg(content: Rec[]): Rec {
	return {
		role: "assistant",
		id: nextId("m"),
		content,
		api: "openai-completions",
		provider: "custom",
		model: "fake",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
		timestamp: 2,
	};
}

export function toolResultMsg(
	toolCallId: string,
	toolName: string,
	text: string,
	isError = false,
): Rec {
	return {
		role: "toolResult",
		id: nextId("r"),
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		details: null,
		isError,
		timestamp: 3,
	};
}

/** The teacher's turn that poses a problem: the call and its ack. */
export function pose(callId: string, input: Rec = PROBLEM, text = "Here is a problem."): Rec[] {
	return [
		assistantMsg([
			{ type: "text", text },
			{ type: "toolCall", id: callId, name: "problem", arguments: input },
		]),
		toolResultMsg(callId, "problem", "Problem posed — the turn ends here."),
	];
}

/** The teacher's turn that concludes: the call, its ack and the closing words. */
export function conclude(callId: string, input: Rec, closing = "Well done."): Rec[] {
	return [
		assistantMsg([{ type: "toolCall", id: callId, name: "conclude", arguments: input }]),
		toolResultMsg(callId, "conclude", "Problem concluded."),
		assistantMsg([{ type: "text", text: closing }]),
	];
}

export const SOLVED = {
	outcome: "solved",
	verdict: "Correct roots and constants.",
	rung: null,
	missClass: null,
	retest: false,
};

export function thinkingMarker(problemCallId: string, text: string, images = 0): Rec {
	return {
		id: nextId("pt"),
		role: "custom",
		customType: "practice-thinking",
		content: `Your thinking:\n${text}`,
		display: true,
		details: {
			problemCallId,
			text,
			...(images
				? {
						images: Array.from({ length: images }, () => ({
							type: "image",
							data: "AA==",
							mimeType: "image/png",
						})),
					}
				: {}),
		},
		timestamp: 4,
	};
}

export function nextMarker(): Rec {
	return {
		id: nextId("pn"),
		role: "custom",
		customType: "practice-next",
		content: "[NEXT PROBLEM]",
		display: true,
		details: {},
		timestamp: 5,
	};
}

export function dismissedMarker(problemCallId: string): Rec {
	return {
		id: nextId("pd"),
		role: "custom",
		customType: "problem-dismissed",
		content: "",
		display: true,
		details: { problemCallId },
		timestamp: 6,
	};
}
