/**
 * Issue 18: the desktop look in the transcript. The folded tool row (with
 * its error states), the learner's band, the confidence rail and the
 * option tints.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { CONFIDENCE_COLORS, confidenceColor } from "@/components/confidence-rail";
import { Transcript } from "@/components/transcript";
import { alpha, PALETTES } from "@/components/ui";
import type { AnsweredCard } from "@/lib/answer-card";
import { TOOL_INPUT_MAX, TOOL_OUTPUT_MAX, headlineArg, outputText, toolRow } from "@/lib/tool-row";
import type { TranscriptRow } from "@/lib/transcript";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const show = (rows: TranscriptRow[]) => render(<Transcript rows={rows} onOpenPlan={() => {}} />);
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe("tool row data", () => {
	it("takes the desktop's headline argument", () => {
		expect(headlineArg("read", { path: "notes/tides.md" })).toBe("notes/tides.md");
		expect(headlineArg("ls", {})).toBe("~");
		expect(headlineArg("grep", { pattern: "moon" })).toBe("moon");
		expect(headlineArg("list_propositions", { session: "chat_1" })).toBe("chat_1");
		expect(headlineArg("visual", { title: "x" })).toBe("");
		expect(headlineArg("read", null)).toBe("~");
	});

	it("writes the output as the desktop does, with an image note", () => {
		expect(outputText("a\nb")).toBe("a\nb");
		expect(outputText({ text: "page 1", images: [{}, {}] })).toBe(
			"page 1\n[2 images attached to the model]",
		);
		expect(outputText({ ok: true })).toBe('{\n  "ok": true\n}');
		expect(outputText(undefined)).toBeNull();
	});

	it("cuts very long input and output", () => {
		const row = toolRow(
			{
				input: { pattern: "x".repeat(TOOL_INPUT_MAX * 2) },
				output: "y".repeat(TOOL_OUTPUT_MAX * 2),
			},
			"t1",
			"grep",
			false,
		);
		expect(row.input!.length).toBeLessThan(TOOL_INPUT_MAX + 5);
		expect(row.output!.length).toBeLessThan(TOOL_OUTPUT_MAX + 5);
	});

	it("never throws on input that is not JSON (a cycle)", () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		const row = toolRow({ input: cycle }, "t1", "read", false);
		expect(row.input).toBe("The phone cannot show this value.");
	});

	it("keeps no output for a failed call (no raw error text)", () => {
		const row = toolRow(
			{ input: { path: "a" }, output: "ENOENT: /secret/path" },
			"t1",
			"read",
			true,
		);
		expect(row.output).toBeNull();
	});
});

describe("tool row", () => {
	const row = toolRow(
		{ input: { path: "notes/tides.md" }, output: "The Moon pulls." },
		"t1",
		"read",
		false,
	);

	it("is folded: the name in small caps and the headline argument", async () => {
		await show([row]);
		expect(screen.getByText("READ")).toBeTruthy();
		expect(screen.getByText("notes/tides.md")).toBeTruthy();
		expect(screen.queryByTestId("tool-panel-t1")).toBeNull();
	});

	it("opens to the input and the output, and folds again", async () => {
		await show([row]);
		await fireEvent.press(screen.getByTestId("tool-t1"));
		expect(screen.getByText("INPUT")).toBeTruthy();
		expect(screen.getByText("OUTPUT")).toBeTruthy();
		expect(screen.getByText("The Moon pulls.")).toBeTruthy();
		await fireEvent.press(screen.getByTestId("tool-t1"));
		expect(screen.queryByTestId("tool-panel-t1")).toBeNull();
	});

	it("a failed call says that the tool failed, never the raw error", async () => {
		const failed = toolRow(
			{ input: { path: "a" }, output: "ENOENT: /secret/path" },
			"t2",
			"read",
			true,
		);
		await show([failed]);
		await fireEvent.press(screen.getByTestId("tool-t2"));
		expect(screen.getByText("The tool failed.")).toBeTruthy();
		expect(screen.queryByText(/ENOENT/)).toBeNull();
	});

	it("a call with no input and no output says so", async () => {
		await show([toolRow({}, "t3", "list_sessions", false)]);
		await fireEvent.press(screen.getByTestId("tool-t3"));
		expect(screen.getByText("No input or output.")).toBeTruthy();
	});
});

describe("learner band", () => {
	it("shows the YOU label and the text on a band with a rail", async () => {
		await show([{ kind: "user", id: "u1", text: "Teach me tides." }]);
		expect(screen.getByText("YOU")).toBeTruthy();
		expect(screen.getByText("Teach me tides.")).toBeTruthy();
		expect(flat("user-u1").borderLeftWidth).toBeGreaterThan(0);
	});
});

describe("confidence rail", () => {
	it("takes the color of the highest stop at or under the value", () => {
		expect(confidenceColor(0)).toBe(CONFIDENCE_COLORS[0]);
		expect(confidenceColor(29)).toBe(CONFIDENCE_COLORS[0]);
		expect(confidenceColor(50)).toBe(CONFIDENCE_COLORS[2]);
		expect(confidenceColor(100)).toBe(CONFIDENCE_COLORS[5]);
	});

	const card = (confidence: number): AnsweredCard =>
		({
			label: "Check",
			question: "Why?",
			verdict: "correct",
			options: [
				{ label: "Closer", selected: true, mark: "check" },
				{ label: "Warmer", selected: false, mark: null },
			],
			confidence,
		}) as unknown as AnsweredCard;

	it("fills to the value, shows the number and reads the value to VoiceOver", async () => {
		await show([
			{
				kind: "question",
				id: "q1",
				tool: "quiz",
				question: "Why?",
				status: "answered",
				card: card(70),
			},
		]);
		expect(flat("confidence-q1-fill").width).toBe("70%");
		expect(flat("confidence-q1-fill").backgroundColor).toBe(CONFIDENCE_COLORS[3]);
		expect(screen.getByText("70%")).toBeTruthy();
		expect(screen.getByLabelText("70% sure")).toBeTruthy();
	});

	it("keeps a value out of range inside the rail", async () => {
		await show([
			{
				kind: "question",
				id: "q2",
				tool: "quiz",
				question: "Why?",
				status: "answered",
				card: card(140),
			},
		]);
		expect(flat("confidence-q2-fill").width).toBe("100%");
	});

	it("tints the chosen correct option green and leaves the other plain", async () => {
		await show([
			{
				kind: "question",
				id: "q3",
				tool: "quiz",
				question: "Why?",
				status: "answered",
				card: card(50),
			},
		]);
		expect(flat("answered-option-q3-0").backgroundColor).toBe(alpha(PALETTES.light.ok, 0.1));
		expect(flat("answered-option-q3-1").backgroundColor).toBeUndefined();
	});
});
