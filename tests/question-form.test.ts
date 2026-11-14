/**
 * The phone's question form (probe, quiz, recall, ask) on top of the shared
 * question code. The answers must be the same records that the desktop dock
 * makes, so the server and the agents see no difference.
 */
import {
	answerFor,
	canSubmit,
	chooseOption,
	newQuestionForm,
	setConfidence,
	setDontKnow,
	type QuestionForm,
} from "@/lib/question-form";
import { CONFIDENCE_STOPS, questionDataForCall } from "@/lib/shared";

const PROBE = {
	question: "What mainly causes the ocean tides on Earth?",
	options: [
		{ label: "The gravity of the Moon", value: "moon" },
		{ label: "The wind over the oceans", value: "wind" },
		{ label: "The rotation of the Earth alone", value: "rotation" },
	],
	explanation: "The Moon's gravity pulls the near side of the oceans more than the far side.",
	correctAnswer: "moon",
};

const probe = questionDataForCall("probe", "call_probe_1", PROBE);
const indexOf = (value: string) => probe.options.findIndex((o) => o.value === value);

describe("probe (a graded quiz)", () => {
	it("a new form has no choice and rests at 50% confidence", () => {
		const form = newQuestionForm();
		expect(CONFIDENCE_STOPS[form.confidenceIndex]).toBe(50);
		expect(canSubmit(probe, form)).toBe(false);
	});

	it("grades the chosen option and sends the confidence and the thinking", () => {
		let form = chooseOption(probe, newQuestionForm(), indexOf("moon"));
		form = setConfidence(form, CONFIDENCE_STOPS.indexOf(90));
		form = { ...form, thinking: "  The Moon is close.  " };
		expect(canSubmit(probe, form)).toBe(true);
		const answer = answerFor(probe, form, "probe");
		expect(answer).toMatchObject({
			kind: "quiz",
			tool: "probe",
			questionText: PROBE.question,
			dontKnow: false,
			correct: true,
			confidence: 90,
			thinking: "The Moon is close.",
		});
		expect(answer.answers.map((a) => a.value)).toEqual(["moon"]);
	});

	it("a wrong option is graded wrong", () => {
		const form = chooseOption(probe, newQuestionForm(), indexOf("wind"));
		expect(answerFor(probe, form, "probe").correct).toBe(false);
	});

	it("single select: a second choice replaces the first", () => {
		let form = chooseOption(probe, newQuestionForm(), indexOf("wind"));
		form = chooseOption(probe, form, indexOf("moon"));
		expect([...form.selection.selected]).toEqual([indexOf("moon")]);
	});

	it('"I don\'t know" clears the choice, sends no confidence and counts as wrong', () => {
		let form = chooseOption(probe, newQuestionForm(), indexOf("moon"));
		form = setDontKnow(form, true);
		expect(form.selection.selected.size).toBe(0);
		expect(canSubmit(probe, form)).toBe(true);
		const answer = answerFor(probe, form, "probe");
		expect(answer.dontKnow).toBe(true);
		expect(answer.correct).toBe(false);
		expect(answer.confidence).toBeUndefined();
	});

	it('a choice after "I don\'t know" turns it off', () => {
		let form = setDontKnow(newQuestionForm(), true);
		form = chooseOption(probe, form, indexOf("moon"));
		expect(form.selection.dontKnow).toBe(false);
	});

	it("keeps the confidence index inside the stops", () => {
		expect(setConfidence(newQuestionForm(), 99).confidenceIndex).toBe(CONFIDENCE_STOPS.length - 1);
		expect(setConfidence(newQuestionForm(), -3).confidenceIndex).toBe(0);
	});
});

describe("multi-select quiz", () => {
	const multi = questionDataForCall("quiz", "call_multi", {
		question: "Which bodies pull on the oceans?",
		multiSelect: true,
		options: [
			{ label: "Moon", value: "moon" },
			{ label: "Sun", value: "sun" },
			{ label: "Mars", value: "mars" },
		],
		correctAnswer: ["moon", "sun"],
	});
	const at = (v: string) => multi.options.findIndex((o) => o.value === v);

	it("choices add up and a second tap removes one", () => {
		let form: QuestionForm = newQuestionForm();
		for (const v of ["moon", "sun", "mars"]) form = chooseOption(multi, form, at(v));
		form = chooseOption(multi, form, at("mars"));
		const answer = answerFor(multi, form, "quiz");
		expect(answer.answers.map((a) => a.value).sort()).toEqual(["moon", "sun"]);
		expect(answer.correct).toBe(true);
	});
});

describe("recall (a text answer)", () => {
	const recall = questionDataForCall("recall", "call_recall", {
		question: "Explain in your own words why there are two tidal bulges.",
		correctAnswer: "The pull differs across the Earth.",
	});

	it("needs text, sends it, and keeps the commitment for the reveal", () => {
		expect(recall.mode).toBe("text");
		expect(canSubmit(recall, newQuestionForm())).toBe(false);
		const form = { ...newQuestionForm(), text: "  The Moon pulls the near side more.  " };
		expect(canSubmit(recall, form)).toBe(true);
		const answer = answerFor(recall, form, "recall");
		expect(answer).toMatchObject({
			kind: "explain",
			text: "The Moon pulls the near side more.",
			committed: "The pull differs across the Earth.",
		});
		expect(answer.confidence).toBeUndefined();
	});
});

describe("ask_user_question with options and Other", () => {
	const ask = questionDataForCall("ask_user_question", "call_ask", {
		question: "How do you want to learn?",
		options: [{ label: "Short steps" }, { label: "Big picture first" }],
	});

	it("an option or a typed Other answer can be sent", () => {
		const picked = chooseOption(ask, newQuestionForm(), 1);
		expect(answerFor(ask, picked, "ask_user_question").answers[0]!.label).toBe("Big picture first");
		const other: QuestionForm = {
			...newQuestionForm(),
			selection: { selected: new Set(), otherSelected: true, dontKnow: false },
			other: "  With examples  ",
		};
		expect(canSubmit(ask, other)).toBe(true);
		expect(answerFor(ask, other, "ask_user_question").other).toBe("With examples");
		expect(canSubmit(ask, { ...other, other: "  " })).toBe(false);
	});
});
