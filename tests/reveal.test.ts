/**
 * When a waiting question arrives closed behind "Check your understanding"
 * (the desktop's questionNeedsReveal and revealArrival rules).
 */
import { revealPlan } from "@/lib/reveal";
import type { LhMessage } from "@/lib/shared";

let seq = 0;
const user = (text: string) =>
	({ role: "user", id: `u${++seq}`, content: text, timestamp: seq }) as unknown as LhMessage;
const call = (name: string, args: unknown, id = `c${++seq}`) =>
	({
		role: "assistant",
		id: `a${++seq}`,
		content: [{ type: "toolCall", id, name, arguments: args }],
		stopReason: "toolUse",
		timestamp: seq,
	}) as unknown as LhMessage;
const result = (toolName: string, toolCallId: string, details: unknown = {}) =>
	({
		role: "toolResult",
		id: `r${++seq}`,
		toolName,
		toolCallId,
		content: [{ type: "text", text: "ok" }],
		details,
		isError: false,
		timestamp: seq,
	}) as unknown as LhMessage;

const QUIZ = {
	question: "Why two bulges?",
	options: [
		{ label: "Gravity difference", value: "diff" },
		{ label: "Wind", value: "wind" },
	],
	explanation: "The pull differs across the Earth.",
	correctAnswer: "diff",
};

/** A record in the teach phase: probe done, then a plan, then teaching text from the learner. */
function teachRecord(): LhMessage[] {
	return [
		user("Teach me tides."),
		call("probe_done", { assessment: { strands: [], summary: "new" } }, "pd"),
		result("probe_done", "pd", { ok: true }),
		user("Yes, the plan is fine."),
	];
}

describe("revealPlan", () => {
	it("a teach-phase check arrives closed, behind the reveal", () => {
		const msgs = [...teachRecord(), call("quiz", { ...QUIZ, type: "check", nodeId: "n1" }, "q1")];
		expect(
			revealPlan(msgs, {
				tool: "quiz",
				toolCallId: "q1",
				input: { ...QUIZ, type: "check", nodeId: "n1" },
			}),
		).toEqual({
			needsReveal: true,
			openOnArrival: false,
		});
	});

	it("a check that follows another question arrives open", () => {
		const first = { ...QUIZ, type: "check", nodeId: "n1" };
		const second = { ...QUIZ, type: "check", nodeId: "n2" };
		const msgs = [
			...teachRecord(),
			call("quiz", first, "q1"),
			result("quiz", "q1", { kind: "quiz", answers: [] }),
			call("quiz", second, "q2"),
		];
		expect(revealPlan(msgs, { tool: "quiz", toolCallId: "q2", input: second })).toEqual({
			needsReveal: true,
			openOnArrival: true,
		});
	});

	it("a predict question arrives open", () => {
		const predict = { ...QUIZ, type: "predict", nodeId: "n1" };
		const msgs = [...teachRecord(), call("quiz", predict, "q1")];
		expect(revealPlan(msgs, { tool: "quiz", toolCallId: "q1", input: predict })).toEqual({
			needsReveal: false,
			openOnArrival: true,
		});
	});

	it("a probe in the probe phase arrives open", () => {
		const msgs = [user("Teach me tides."), call("probe", QUIZ, "p1")];
		expect(revealPlan(msgs, { tool: "probe", toolCallId: "p1", input: QUIZ })).toEqual({
			needsReveal: false,
			openOnArrival: true,
		});
	});

	it("a question call that is not in the record arrives open (no crash)", () => {
		expect(
			revealPlan(teachRecord(), { tool: "quiz", toolCallId: "gone", input: QUIZ }).openOnArrival,
		).toBe(true);
	});
});
