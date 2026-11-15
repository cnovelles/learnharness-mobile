/**
 * Issue 05 slice D: the probe_done card (the learner assessment), with error
 * state 13 (docs/ISSUES.md, issue 05). The rows come from native records
 * through the shared view projection, as on the Mac.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import { COPY_LABEL_MS } from "@/components/markdown";
import { Transcript } from "@/components/transcript";
import * as md from "@/lib/markdown";
import { PROBE_NOTE, probeCardData, probeMarkdown } from "@/lib/probe-card";
import { projectView, type LhMessage } from "@/lib/shared";
import { transcriptRows, type TranscriptRow } from "@/lib/transcript";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
const setString = Clipboard.setStringAsync as jest.MockedFunction<typeof Clipboard.setStringAsync>;

const ASSESSMENT = {
	strands: [
		{
			strand: "Limits",
			assessment: "Solid on `lim` notation. **Unsure** when a limit does not exist.",
		},
		{ strand: "Slope of a line", assessment: "Reliable. Build from here." },
		{ strand: "The derivative as a limit", assessment: "Knows the rule, not why." },
	],
	summary: "Goal: understand derivatives. Enter at *secant to tangent*.",
};

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
const result = (toolCallId: string, details: unknown, isError = false) =>
	({
		role: "toolResult",
		id: `r_${toolCallId}`,
		toolCallId,
		toolName: "probe_done",
		content: [{ type: "text", text: isError ? "Validation failed" : "Assessment recorded" }],
		details,
		isError,
		timestamp: 3,
	}) as unknown as LhMessage;
const call = (id: string, args: unknown) =>
	assistant(`a_${id}`, [{ type: "toolCall", id, name: "probe_done", arguments: args }]);

const rowsOf = (messages: LhMessage[]) => transcriptRows(projectView(messages));
const probeRows = (messages: LhMessage[]) => rowsOf(messages).filter((r) => r.kind === "probe");

describe("probe rows", () => {
	it("a finished assessment gives a probe row with the strands and the summary, not a tool line", () => {
		const rows = rowsOf([call("pd", { assessment: ASSESSMENT }), result("pd", { ok: true })]);
		expect(rows.some((r) => r.kind === "tool")).toBe(false);
		expect(rows).toEqual([
			{
				kind: "probe",
				id: "pd",
				state: "ready",
				strands: ASSESSMENT.strands,
				summary: ASSESSMENT.summary,
			},
		]);
	});

	it("repairs a literal \\n paragraph break in the strand text, as the desktop does", () => {
		const assessment = {
			strands: [{ strand: "Loops", assessment: "First line.\\n\\nSecond paragraph." }],
		};
		const [row] = probeRows([call("pd", { assessment }), result("pd", { ok: true })]);
		expect(row).toMatchObject({ strands: [{ assessment: "First line.\n\nSecond paragraph." }] });
	});

	it("13. no summary: the strands only", () => {
		const assessment = { strands: [ASSESSMENT.strands[0]], summary: "  " };
		const [row] = probeRows([call("pd", { assessment }), result("pd", { ok: true })]);
		expect(row).toMatchObject({ state: "ready", strands: [ASSESSMENT.strands[0]] });
		expect(row).not.toHaveProperty("summary");
	});

	it("13. still writing: the call has no result yet, or its input is partial", () => {
		expect(probeRows([call("pd", { assessment: { strands: [{ strand: "Lim" }] } })])).toMatchObject(
			[{ state: "writing", strands: [] }],
		);
		expect(probeCardData({ state: "input-streaming", input: { assessment: {} } }).state).toBe(
			"writing",
		);
		expect(probeCardData({ state: "input-available" }).state).toBe("writing");
	});

	it("13. malformed: the Mac refused the input (output-error), whatever its shape", () => {
		const rows = probeRows([
			call("pd", { assessment: JSON.stringify(ASSESSMENT) }),
			result("pd", {}, true),
		]);
		expect(rows).toMatchObject([{ state: "malformed", strands: [] }]);
	});

	it("13. refused: ok false hides the strands and the Mac's error text", () => {
		const data = probeCardData({
			state: "output-available",
			input: { assessment: ASSESSMENT },
			output: { ok: false, error: "probe_done refused: an open question is pending" },
		});
		expect(data).toEqual({ state: "refused", strands: [] });
	});

	it("13. finished but the input does not parse (an empty strand list): the phone cannot show it", () => {
		const rows = probeRows([
			call("pd", { assessment: { strands: [] } }),
			result("pd", { ok: true }),
		]);
		expect(rows).toMatchObject([{ state: "unreadable", strands: [] }]);
	});

	it("copies the assessment as Markdown: a bold name and its text for each strand, then the summary", () => {
		expect(probeMarkdown({ strands: ASSESSMENT.strands.slice(0, 2), summary: ASSESSMENT.summary }))
			.toBe(`**Limits**
Solid on \`lim\` notation. **Unsure** when a limit does not exist.

**Slope of a line**
Reliable. Build from here.

Goal: understand derivatives. Enter at *secant to tangent*.`);
		expect(probeMarkdown({ strands: [{ strand: " A ", assessment: " b " }] })).toBe("**A**\nb");
		// Bold inside the name (found on the Simulator) would break the outer bold.
		expect(
			probeMarkdown({
				strands: [{ strand: "The Moon's **gravity** and __mass__", assessment: "x" }],
			}),
		).toBe("**The Moon's gravity and mass**\nx");
	});
});

describe("the probe card", () => {
	const ready = (summary: string | null = ASSESSMENT.summary): TranscriptRow => ({
		kind: "probe",
		id: "pd",
		state: "ready",
		strands: ASSESSMENT.strands,
		...(summary ? { summary } : {}),
	});
	const show = (row: TranscriptRow) => render(<Transcript rows={[row]} onOpenPlan={() => {}} />);
	const tapHead = async () => {
		await act(async () => {
			fireEvent.press(screen.getByTestId("probe-head-pd"));
		});
	};

	beforeEach(() => {
		setString.mockReset();
		setString.mockResolvedValue(true);
	});
	afterEach(() => jest.restoreAllMocks());

	it("starts folded with the strand count, as on the desktop", async () => {
		await show(ready());
		expect(screen.getByTestId("probe-head-pd")).toHaveTextContent("Probe assessment3 strands");
		expect(screen.getByTestId("probe-head-pd").props.accessibilityLabel).toBe(
			"Probe assessment, 3 strands",
		);
		expect(screen.getByTestId("probe-head-pd").props.accessibilityState).toMatchObject({
			expanded: false,
		});
		expect(screen.queryByTestId("probe-body-pd")).toBeNull();
	});

	it("a tap opens one block for each strand as Markdown and the summary last; a second tap folds it", async () => {
		await show(ready());
		await tapHead();
		expect(screen.getByTestId("probe-head-pd")).toHaveTextContent("3 strands", { exact: false });
		expect(screen.getByTestId("probe-head-pd").props.accessibilityState).toMatchObject({
			expanded: true,
		});
		const body = screen.getByTestId("probe-body-pd");
		expect(body.children).toHaveLength(4);
		expect(screen.getByTestId("probe-strand-pd-0")).toHaveTextContent(
			"LimitsSolid on lim notation. Unsure when a limit does not exist.",
		);
		expect(screen.getAllByTestId("md-inline-code")[0]).toHaveTextContent("lim", { exact: false });
		expect(screen.getByTestId("probe-summary-pd")).toHaveTextContent(
			"Goal: understand derivatives. Enter at secant to tangent.",
		);
		expect(screen.queryByText(/\*\*|`/)).toBeNull();
		await tapHead();
		expect(screen.queryByTestId("probe-body-pd")).toBeNull();
	});

	it("says 1 strand for one strand, and has no summary block without a summary", async () => {
		await show({ kind: "probe", id: "pd", state: "ready", strands: [ASSESSMENT.strands[1]!] });
		expect(screen.getByTestId("probe-head-pd")).toHaveTextContent("1 strand", { exact: false });
		await tapHead();
		expect(screen.queryByTestId("probe-summary-pd")).toBeNull();
	});

	it.each(["writing", "malformed", "refused", "unreadable"] as const)(
		"13. %s: a note in the card, no strands and no raw text",
		async (state) => {
			await show({ kind: "probe", id: "pd", state, strands: [] });
			expect(screen.getByTestId("probe-note-pd")).toHaveTextContent(PROBE_NOTE[state]);
			expect(screen.queryByTestId("probe-head-pd")).toBeNull();
			expect(screen.queryByText(/refused|Validation|error/i)).toBeNull();
		},
	);

	it("uses the word prober in the retry notes (user decision 2026-11-15)", () => {
		expect(PROBE_NOTE.refused).toBe("The prober retried with a corrected assessment.");
		expect(PROBE_NOTE.malformed).toBe(
			"The assessment was malformed. The prober sent a corrected one.",
		);
	});

	it("a long press on the header copies the assessment as Markdown and shows Copied", async () => {
		jest.useFakeTimers();
		try {
			await show(ready());
			await act(async () => {
				fireEvent(screen.getByTestId("probe-head-pd"), "longPress");
			});
			expect(setString).toHaveBeenCalledWith(
				probeMarkdown({ strands: ASSESSMENT.strands, summary: ASSESSMENT.summary }),
			);
			expect(screen.getByTestId("md-copy-label")).toHaveTextContent("Copied");
			// The long press does not open or fold the card.
			expect(screen.queryByTestId("probe-body-pd")).toBeNull();
			await act(async () => {
				await jest.advanceTimersByTimeAsync(COPY_LABEL_MS);
			});
			expect(screen.queryByTestId("md-copy-label")).toBeNull();
		} finally {
			jest.useRealTimers();
		}
	});

	it("gives VoiceOver a Copy action on the header", async () => {
		await show(ready(null));
		await act(async () => {
			fireEvent(screen.getByTestId("probe-head-pd"), "accessibilityAction", {
				nativeEvent: { actionName: "longpress" },
			});
		});
		expect(setString).toHaveBeenCalledWith(probeMarkdown({ strands: ASSESSMENT.strands }));
	});

	it("17. says Could not copy. when the clipboard throws, with no raw text", async () => {
		setString.mockRejectedValueOnce(new Error("pasteboard locked"));
		await show(ready());
		await act(async () => {
			fireEvent(screen.getByTestId("probe-head-pd"), "longPress");
		});
		expect(screen.getByTestId("md-copy-label")).toHaveTextContent("Could not copy.");
		expect(screen.queryByText(/pasteboard/)).toBeNull();
	});

	it("2. the renderer throws on one strand: that strand shows plain, the others still draw", async () => {
		const real = md.parseMarkdown;
		jest.spyOn(md, "parseMarkdown").mockImplementation((text, ...rest) => {
			if (text.startsWith("Solid on")) throw new Error("internal parser detail");
			return real(text, ...rest);
		});
		jest.spyOn(console, "error").mockImplementation(() => {});
		await show(ready());
		await tapHead();
		expect(screen.getByTestId("probe-strand-pd-0")).toHaveTextContent(
			ASSESSMENT.strands[0]!.assessment,
			{ exact: false },
		);
		expect(screen.getByTestId("probe-strand-pd-1")).toHaveTextContent(
			"Slope of a lineReliable. Build from here.",
		);
		expect(screen.queryByText(/internal parser detail/)).toBeNull();
	});
});
