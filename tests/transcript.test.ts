/**
 * Transcript rows from the shared view projection (fork src/core/view.ts).
 * The input is native records, as the Mac stores them, so the test also
 * checks that the phone reads the real record format.
 */
import { transcriptRows } from "@/lib/transcript";
import { buildAnswer, projectView, questionDataForCall, type LhMessage } from "@/lib/shared";

const PROBE = {
	question: "What mainly causes the ocean tides on Earth?",
	options: [
		{ label: "The gravity of the Moon", value: "moon" },
		{ label: "The wind over the oceans", value: "wind" },
	],
	correctAnswer: "moon",
};

const user = (id: string, text: string) =>
	({ role: "user", id, content: text, timestamp: 1 }) as unknown as LhMessage;
const assistant = (id: string, content: unknown[]) =>
	({
		role: "assistant",
		id,
		content,
		api: "openai-completions",
		provider: "custom",
		model: "fake",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	}) as unknown as LhMessage;
const result = (id: string, toolCallId: string, toolName: string, details: unknown) =>
	({
		role: "toolResult",
		id,
		toolCallId,
		toolName,
		content: [{ type: "text", text: JSON.stringify(details) }],
		details,
		isError: false,
		timestamp: 3,
	}) as unknown as LhMessage;

const probeTurn = [
	user("u1", "Teach me how the tides work."),
	assistant("a1", [
		{ type: "thinking", thinking: "Start with a probe." },
		{ type: "text", text: "Welcome. First a short question." },
		{ type: "toolCall", id: "call_1", name: "probe", arguments: PROBE },
	]),
];

it("shows the learner's text, the reasoning, the teacher's text and a waiting question", () => {
	const rows = transcriptRows(projectView(probeTurn));
	expect(rows.map((r) => r.kind)).toEqual(["user", "reasoning", "text", "question"]);
	expect(rows[0]).toMatchObject({ kind: "user", text: "Teach me how the tides work." });
	expect(rows[1]).toMatchObject({ kind: "reasoning", text: "Start with a probe." });
	expect(rows[2]).toMatchObject({ kind: "text", text: "Welcome. First a short question." });
	expect(rows[3]).toMatchObject({
		kind: "question",
		tool: "probe",
		question: PROBE.question,
		answer: null,
	});
});

it("an answered question shows the answer and the grade", () => {
	const qd = questionDataForCall("probe", "call_1", PROBE);
	const answer = buildAnswer(qd, { values: ["moon"], confidence: 70 }, "probe");
	const rows = transcriptRows(projectView([...probeTurn, result("r1", "call_1", "probe", answer)]));
	expect(rows.at(-1)).toMatchObject({
		kind: "question",
		answer: "The gravity of the Moon",
		grade: "correct",
		confidence: 70,
	});
});

it('an "I don\'t know" answer and a text answer', () => {
	const qd = questionDataForCall("probe", "call_1", PROBE);
	const dontKnow = buildAnswer(qd, { dontKnow: true }, "probe");
	const rows = transcriptRows(
		projectView([...probeTurn, result("r1", "call_1", "probe", dontKnow)]),
	);
	expect(rows.at(-1)).toMatchObject({ answer: "I don't know", grade: "wrong" });

	const recallInput = { question: "Why two bulges?", correctAnswer: "Uneven pull." };
	const recall = buildAnswer(
		questionDataForCall("recall", "call_2", recallInput),
		{ text: "The pull is uneven." },
		"recall",
	);
	const textRows = transcriptRows(
		projectView([
			user("u1", "Go on."),
			assistant("a2", [{ type: "toolCall", id: "call_2", name: "recall", arguments: recallInput }]),
			result("r2", "call_2", "recall", recall),
		]),
	);
	expect(textRows.at(-1)).toMatchObject({ answer: "The pull is uneven." });
	expect(textRows.at(-1)).not.toHaveProperty("grade");
});

it("other tools show as one short line with their name", () => {
	const rows = transcriptRows(
		projectView([
			user("u1", "Plan it."),
			assistant("a1", [
				{ type: "toolCall", id: "call_9", name: "plan_init", arguments: { mermaid: "graph TD" } },
			]),
		]),
	);
	expect(rows.at(-1)).toMatchObject({ kind: "tool", name: "plan_init" });
});

it("leaves out empty text and unknown parts", () => {
	const rows = transcriptRows([
		{ id: "m", role: "assistant", parts: [{ type: "text", text: "  " }, { type: "data-x" }] },
	]);
	expect(rows).toEqual([]);
});

it("marks a waiting question that the shared check found malformed", () => {
	const rows = transcriptRows(projectView(probeTurn), new Set(["call_1"]));
	expect(rows.at(-1)).toMatchObject({ kind: "question", answer: null, malformed: true });
});
