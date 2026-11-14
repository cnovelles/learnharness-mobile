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
		status: "waiting",
	});
});

it("an answered question shows the answer and the grade", () => {
	const qd = questionDataForCall("probe", "call_1", PROBE);
	const answer = buildAnswer(qd, { values: ["moon"], confidence: 70 }, "probe");
	const rows = transcriptRows(projectView([...probeTurn, result("r1", "call_1", "probe", answer)]));
	expect(rows.at(-1)).toMatchObject({
		kind: "question",
		status: "answered",
		card: {
			label: "Probe",
			verdict: "correct",
			confidence: 70,
			// The options are in the shuffled order that the learner saw.
			options: expect.arrayContaining([
				{ label: "The gravity of the Moon", selected: true, mark: "check" },
				{ label: "The wind over the oceans", selected: false },
			]),
		},
	});
});

it('an "I don\'t know" answer and a text answer', () => {
	const qd = questionDataForCall("probe", "call_1", PROBE);
	const dontKnow = buildAnswer(qd, { dontKnow: true }, "probe");
	const rows = transcriptRows(
		projectView([...probeTurn, result("r1", "call_1", "probe", dontKnow)]),
	);
	expect(rows.at(-1)).toMatchObject({ status: "answered", card: { verdict: "didntKnow" } });
	expect((rows.at(-1) as { card: object }).card).not.toHaveProperty("confidence");

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
	expect(textRows.at(-1)).toMatchObject({
		card: { label: "Recall", text: "The pull is uneven." },
	});
	expect((textRows.at(-1) as { card: object }).card).not.toHaveProperty("verdict");
});

it("other tools show as one short line with their name", () => {
	const rows = transcriptRows(
		projectView([
			user("u1", "Look it up."),
			assistant("a1", [{ type: "toolCall", id: "call_9", name: "list_sessions", arguments: {} }]),
		]),
	);
	expect(rows.at(-1)).toMatchObject({ kind: "tool", name: "list_sessions" });
});

it("leaves out empty text and unknown parts", () => {
	const rows = transcriptRows([
		{ id: "m", role: "assistant", parts: [{ type: "text", text: "  " }, { type: "data-x" }] },
	]);
	expect(rows).toEqual([]);
});

it("marks a waiting question that the shared check found malformed", () => {
	const rows = transcriptRows(projectView(probeTurn), { malformedCallIds: new Set(["call_1"]) });
	expect(rows.at(-1)).toMatchObject({ kind: "question", status: "malformed" });
});

it("leaves out the question that the dock shows, but keeps it once answered", () => {
	const rows = transcriptRows(projectView(probeTurn), { dockCallId: "call_1" });
	expect(rows.map((r) => r.kind)).toEqual(["user", "reasoning", "text"]);
	const qd = questionDataForCall("probe", "call_1", PROBE);
	const answered = [
		...probeTurn,
		result("r1", "call_1", "probe", buildAnswer(qd, { values: ["moon"] }, "probe")),
	];
	expect(transcriptRows(projectView(answered), { dockCallId: "call_1" }).at(-1)).toMatchObject({
		kind: "question",
		status: "answered",
	});
});

describe("lesson plan and phase dividers (issue 04 slice B)", () => {
	const TREE = {
		nodes: [
			{ id: "pull", title: "Uneven pull" },
			{ id: "bulges", title: "Two bulges" },
		],
		edges: [{ from: "pull", to: "bulges" }],
		version: 1,
	};
	const CHECK = { ...PROBE, type: "check", explanation: "Gravity.", nodeId: "pull" };
	const handoff = {
		role: "custom",
		id: "steer_probe_c1",
		customType: "probe-handoff",
		content: "hand off",
		display: true,
		details: { chatId: "c1" },
		timestamp: 4,
	} as unknown as LhMessage;
	const probeDone = [
		assistant("a_pd", [{ type: "toolCall", id: "pd", name: "probe_done", arguments: {} }]),
		result("r_pd", "pd", "probe_done", { ok: true }),
		handoff,
	];
	const planCall = (id: string, details: unknown, isError = false) => [
		assistant(`a_${id}`, [
			{ type: "text", text: "Here is the plan." },
			{ type: "toolCall", id, name: "plan_init", arguments: { mermaid: "graph TD" } },
		]),
		{ ...(result(`r_${id}`, id, "plan_init", details) as object), isError } as unknown as LhMessage,
	];

	it("a successful plan shows a plan row and the Planning divider with the step count", () => {
		const rows = transcriptRows(
			projectView([...probeTurn, ...probeDone, ...planCall("p1", { ok: true, tree: TREE })]),
		);
		expect(rows.filter((r) => r.kind === "divider")).toEqual([
			{ kind: "divider", id: "plan-steer_probe_c1", phase: "plan", steps: 2 },
		]);
		expect(rows.find((r) => r.kind === "plan")).toMatchObject({ steps: 2 });
		expect(rows.some((r) => r.kind === "tool" && r.name === "plan_init")).toBe(false);
	});

	it("error state: a failed plan call shows a failed tool row, no plan row and no step count", () => {
		const rows = transcriptRows(
			projectView([
				...probeTurn,
				...probeDone,
				...planCall("p1", { ok: false, error: "bad mermaid" }, true),
			]),
		);
		expect(rows.find((r) => r.kind === "tool" && r.name === "plan_init")).toMatchObject({
			failed: true,
		});
		expect(rows.some((r) => r.kind === "plan")).toBe(false);
		expect(rows.find((r) => r.kind === "divider")).toEqual({
			kind: "divider",
			id: "plan-steer_probe_c1",
			phase: "plan",
		});
	});

	it("error state: a plan result with ok false (not an error result) is a failed tool row", () => {
		const rows = transcriptRows(
			projectView([...probeDone, ...planCall("p1", { ok: false, error: "x" })]),
		);
		expect(rows.find((r) => r.kind === "tool" && r.name === "plan_init")).toMatchObject({
			failed: true,
		});
	});

	it("error state: a plan with no nodes shows no plan row", () => {
		const rows = transcriptRows(
			projectView([...probeDone, ...planCall("p1", { ok: true, tree: { ...TREE, nodes: [] } })]),
		);
		expect(rows.some((r) => r.kind === "plan")).toBe(false);
	});

	it("the Teaching divider comes before the message with the first tagged check", () => {
		const rows = transcriptRows(
			projectView([
				...probeDone,
				...planCall("p1", { ok: true, tree: TREE }),
				user("u3", "Looks good."),
				assistant("a_t", [
					{ type: "text", text: "The Moon pulls unevenly." },
					{ type: "toolCall", id: "c_check", name: "quiz", arguments: CHECK },
				]),
			]),
		);
		const kinds = rows.map((r) => (r.kind === "divider" ? `divider-${r.phase}` : r.kind));
		expect(kinds.filter((k) => k.startsWith("divider"))).toEqual(["divider-plan", "divider-teach"]);
		const teach = kinds.indexOf("divider-teach");
		expect(rows[teach + 1]).toMatchObject({ kind: "text", text: "The Moon pulls unevenly." });
	});
});

describe("answered cards (issue 04 slice B)", () => {
	const turnWith = (name: string, input: unknown, answer: unknown) =>
		projectView([
			user("u1", "Go."),
			assistant("a1", [{ type: "toolCall", id: "q1", name, arguments: input }]),
			result("r1", "q1", name, answer),
		]);

	it("a wrong check: ✗ on the choice, ✓ on the correct option, the explanation and the reading thinking", () => {
		const input = { ...PROBE, type: "check", explanation: "Gravity differs.", nodeId: "n" };
		const qd = questionDataForCall("quiz", "q1", input);
		const answer = buildAnswer(
			qd,
			{ values: ["wind"], confidence: 30, thinking: "Waves.", readingThinking: "Hmm." },
			"quiz",
		);
		const row = transcriptRows(turnWith("quiz", input, answer)).at(-1)!;
		expect(row).toMatchObject({
			kind: "question",
			status: "answered",
			card: {
				label: "Check",
				verdict: "incorrect",
				confidence: 30,
				thinking: "Waves.",
				readingThinking: "Hmm.",
				explanation: "Gravity differs.",
			},
		});
		const options = (row as { card: { options: unknown[] } }).card.options;
		expect(options).toEqual(
			expect.arrayContaining([
				{ label: "The gravity of the Moon", selected: false, mark: "check" },
				{ label: "The wind over the oceans", selected: true, mark: "x" },
			]),
		);
	});

	it("an explain answer shows the text and the teacher's answer, with no grade", () => {
		const input = { question: "Why two bulges?", correctAnswer: "The pull differs.", nodeId: "n" };
		const answer = buildAnswer(
			questionDataForCall("explain", "q1", input),
			{ text: "Uneven." },
			"explain",
		);
		const row = transcriptRows(turnWith("explain", input, answer)).at(-1)!;
		expect(row).toMatchObject({
			card: { label: "Explain", text: "Uneven.", committed: "The pull differs." },
		});
		expect((row as { card: object }).card).not.toHaveProperty("verdict");
	});

	it("a skipped question shows skipped", () => {
		const row = transcriptRows(
			turnWith("quiz", PROBE, { kind: "quiz", dismissed: true, questionText: "x", answers: [] }),
		).at(-1)!;
		expect(row).toMatchObject({ status: "skipped" });
	});

	it.each([
		["a string", "{ raw json }"],
		["no answers", { kind: "quiz", questionText: "x" }],
		["an unknown kind", { kind: "weird", answers: [] }],
		["bad answers", { kind: "quiz", answers: [{ value: "x" }] }],
	])("error state: a malformed answer record (%s) shows a plain line, not raw data", (_n, bad) => {
		const row = transcriptRows(turnWith("probe", PROBE, bad)).at(-1)!;
		expect(row).toMatchObject({ kind: "question", status: "unreadable", question: PROBE.question });
		expect(row).not.toHaveProperty("card");
	});

	it("error state: bad fields in an answer record are left out, not shown", () => {
		const row = transcriptRows(
			turnWith(
				"ask_user_question",
				{ question: "Pick", options: [{ label: "A", value: "a" }] },
				{
					kind: "ask",
					questionText: "Pick",
					answers: [{ index: 1, value: "a" }],
					options: [{ index: 1, label: "A" }, { index: 2 }, "junk"],
					thinking: { nested: true },
					confidence: "high",
					dontKnow: false,
					answeredAt: "now",
				},
			),
		).at(-1)!;
		expect(row).toMatchObject({
			status: "answered",
			card: { label: "Question", options: [{ label: "A", selected: true }] },
		});
		const card = (row as { card: object }).card;
		expect(card).not.toHaveProperty("thinking");
		expect(card).not.toHaveProperty("confidence");
	});
});

describe("compaction dividers (issue 04 slice D)", () => {
	it("shows the compaction moment and the cut, with the token count when it is known", () => {
		const rows = transcriptRows([
			{
				id: "cut_c1",
				role: "user",
				parts: [
					{ type: "data-compaction-cut", id: "cc_1", data: { details: { tokensBefore: 41000 } } },
				],
			},
			{
				id: "c1",
				role: "user",
				parts: [{ type: "data-compaction", id: "cm_1", data: { details: {} } }],
			},
		] as never);
		expect(rows).toEqual([
			{ kind: "compaction", id: "cc_1", at: "cut", tokensBefore: 41000 },
			{ kind: "compaction", id: "cm_1", at: "moment" },
		]);
	});

	it("error state: a compaction part with bad data shows the divider without a count", () => {
		const rows = transcriptRows([
			{ id: "x", role: "user", parts: [{ type: "data-compaction-cut", id: "cc", data: "junk" }] },
		] as never);
		expect(rows).toEqual([{ kind: "compaction", id: "cc", at: "cut" }]);
	});
});
