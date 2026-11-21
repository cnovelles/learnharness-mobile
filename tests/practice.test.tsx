/**
 * Issue 06 slice B: the practice rows. Native practice records go through
 * the phone's path (`projectView`, `transcriptRows`, `Transcript`). The
 * model solution must never show before the conclusion.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { Transcript } from "@/components/transcript";
import { MacFetchContext } from "@/lib/connection-context";
import { concludeCardData, nodeNames } from "@/lib/practice";
import { projectView, type LhMessage } from "@/lib/shared";
import { transcriptRows } from "@/lib/transcript";
import {
	SOLVED,
	assistantMsg,
	conclude,
	dismissedMarker,
	nextMarker,
	pose,
	thinkingMarker,
	toolResultMsg,
} from "./helpers/practice-record";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const user = (text: string) => ({ role: "user", id: "u_1", content: text, timestamp: 1 });
const rowsOf = (messages: unknown[]) => transcriptRows(projectView(messages as LhMessage[]));
const draw = (messages: unknown[]) =>
	render(<Transcript rows={rowsOf(messages)} onOpenPlan={() => {}} />);

describe("practice rows", () => {
	it("a posed problem is a problem card with the statement only, never the model solution", async () => {
		const rows = rowsOf([user("Recurrences"), ...pose("call_p1")]);
		expect(rows.map((r) => r.kind)).toEqual(["user", "text", "problem"]);
		expect(rows[2]).toMatchObject({ kind: "problem", id: "call_p1", streaming: false });
		await draw([user("Recurrences"), ...pose("call_p1")]);
		expect(screen.getByTestId("problem-call_p1")).toBeTruthy();
		expect(screen.getByText("PROBLEM")).toBeTruthy();
		expect(screen.queryByText(/roots are 1 and 2/)).toBeNull();
		// No tool line for the call (its input carries the model solution).
		expect(screen.queryByTestId("tool-call_p1")).toBeNull();
	});

	it("the thinking, the conclusion with its model solution, and the Next problem line", async () => {
		const record = [
			user("Recurrences"),
			...pose("call_p1"),
			thinkingMarker("call_p1", "Roots 1 and 2, so 2^(n+1) - 1."),
			...conclude("call_c1", SOLVED),
			nextMarker(),
		];
		const rows = rowsOf(record);
		expect(rows.map((r) => r.kind)).toEqual([
			"user",
			"text",
			"problem",
			"practice-thinking",
			"conclude",
			"text",
			"practice-next",
		]);
		await draw(record);
		expect(screen.getByText("YOUR THINKING")).toBeTruthy();
		expect(screen.getByText("Roots 1 and 2, so 2^(n+1) - 1.")).toBeTruthy();
		expect(screen.getByText("CONCLUDED")).toBeTruthy();
		expect(screen.getByTestId("outcome-call_c1")).toHaveTextContent("SOLVED");
		expect(screen.getByText("MODEL SOLUTION")).toBeTruthy();
		expect(screen.getByText(/roots are 1 and 2/)).toBeTruthy();
		expect(screen.getByText("NEXT PROBLEM")).toBeTruthy();
	});

	it("a dismissal shows one muted line, with no verdict and no solution", async () => {
		const record = [
			user("Recurrences"),
			...pose("call_p1"),
			dismissedMarker("call_p1"),
			...conclude("call_c1", { outcome: "dismissed" }, "Fine, next one."),
		];
		await draw(record);
		expect(screen.getByText("Problem dismissed.")).toBeTruthy();
		expect(screen.queryByText("MODEL SOLUTION")).toBeNull();
		expect(screen.queryByText("CONCLUDED")).toBeNull();
	});

	it("metadata: closed at first; a tap opens the rows; a second tap closes them", async () => {
		const record = [
			...pose("call_p1"),
			...conclude("call_c1", { ...SOLVED, rung: "R2", missClass: "execution", retest: true }),
		];
		await draw(record);
		expect(screen.queryByTestId("metadata-rows-call_c1")).toBeNull();
		await fireEvent.press(screen.getByTestId("metadata-call_c1"));
		const rows = screen.getByTestId("metadata-rows-call_c1");
		expect(rows).toHaveTextContent(/Modecomposition/);
		// No Mac here: the target shows its id.
		expect(rows).toHaveTextContent(/Targetsn_recurrence/);
		expect(rows).toHaveTextContent(/Hint rungR2/);
		expect(rows).toHaveTextContent(/Miss classexecution/);
		expect(rows).toHaveTextContent(/Retestyes/);
		await fireEvent.press(screen.getByTestId("metadata-call_c1"));
		expect(screen.queryByTestId("metadata-rows-call_c1")).toBeNull();
	});

	it("metadata: the targets show their names from the Mac's graph", async () => {
		const macFetch = jest.fn(
			async () =>
				new Response(
					JSON.stringify({ nodes: [{ id: "n_recurrence", name: "Linear recurrences" }] }),
				),
		) as unknown as typeof fetch;
		const record = [...pose("call_p1"), ...conclude("call_c1", SOLVED)];
		await render(
			<MacFetchContext value={macFetch}>
				<Transcript rows={rowsOf(record)} onOpenPlan={() => {}} />
			</MacFetchContext>,
		);
		await fireEvent.press(screen.getByTestId("metadata-call_c1"));
		await waitFor(() =>
			expect(screen.getByTestId("metadata-rows-call_c1")).toHaveTextContent(/Linear recurrences/),
		);
	});

	it("error state: a problem call that failed is the quiet failed tool line, not a card", async () => {
		const record = [
			assistantMsg([
				{ type: "toolCall", id: "call_bad", name: "problem", arguments: { mode: "recall" } },
			]),
			toolResultMsg("call_bad", "problem", "statement is required", true),
		];
		const rows = rowsOf(record);
		expect(rows).toEqual([expect.objectContaining({ kind: "tool", id: "call_bad", failed: true })]);
		await draw(record);
		expect(screen.queryByTestId("problem-call_bad")).toBeNull();
	});

	it("error state: a problem with no statement shows a note, never raw data", async () => {
		await draw(pose("call_p1", { mode: "recall", modelSolution: "secret" }));
		expect(screen.getByText("This problem has no text.")).toBeTruthy();
		expect(screen.queryByText(/secret/)).toBeNull();
	});

	it("error state: an unknown outcome has no chip; missing fields show what the card has", async () => {
		await draw([...pose("call_p1"), ...conclude("call_c1", { outcome: "weird" })]);
		expect(screen.getByText("CONCLUDED")).toBeTruthy();
		expect(screen.queryByTestId("outcome-call_c1")).toBeNull();
		expect(screen.queryByText(/weird/)).toBeNull();
		// The model solution still comes from the problem call.
		expect(screen.getByText(/roots are 1 and 2/)).toBeTruthy();
	});

	it("thinking with images says to open them on the Mac", async () => {
		await draw([...pose("call_p1"), thinkingMarker("call_p1", "See my sketch.", 2)]);
		expect(screen.getByText("2 images. Open them on the Mac.")).toBeTruthy();
	});
});

describe("concludeCardData", () => {
	const part = (input: unknown, extra: Record<string, unknown> = {}) =>
		({ type: "tool-conclude", input, ...extra }) as Parameters<typeof concludeCardData>[0];

	it("maps each outcome to the desktop's label and color", () => {
		const outcome = (o: string) => {
			const d = concludeCardData(part({ outcome: o }));
			return d.dismissed ? null : d.outcome;
		};
		expect(outcome("solved")).toEqual({ label: "Solved", tone: "ok" });
		expect(outcome("solvedWithHints")).toEqual({ label: "Solved with hints", tone: "warning" });
		expect(outcome("movedOn")).toEqual({ label: "Moved on", tone: "muted" });
		expect(outcome("surrendered")).toEqual({ label: "Surrendered", tone: "danger" });
		expect(outcome("other")).toBeNull();
	});

	it("an old record's own solutionReveal is the fallback", () => {
		const d = concludeCardData(part({ outcome: "solved", solutionReveal: "Old reveal." }));
		// The outcome alone is no metadata (as on the desktop).
		expect(d).toMatchObject({ dismissed: false, reveal: "Old reveal.", metadata: null });
	});

	it("no metadata when the agent filled no field", () => {
		const d = concludeCardData(part({ outcome: "solved", rung: null, missClass: null }));
		expect(d).toMatchObject({ metadata: null });
	});

	it("wrong types read as missing", () => {
		const d = concludeCardData(
			part({ outcome: 3, verdict: { x: 1 }, retest: "yes" }, { reveal: 7 }),
		);
		expect(d).toEqual({ dismissed: false, outcome: null, verdict: "", reveal: "", metadata: null });
	});
});

describe("nodeNames", () => {
	it("reads the graph once for each Mac connection", async () => {
		const macFetch = jest.fn(
			async () =>
				new Response(JSON.stringify({ nodes: [{ id: "a", name: "A" }, { id: "b" }, {}] })),
		) as unknown as typeof fetch;
		expect(await nodeNames(macFetch)).toEqual({ a: "A", b: "b" });
		expect(await nodeNames(macFetch)).toEqual({ a: "A", b: "b" });
		expect(macFetch).toHaveBeenCalledTimes(1);
	});

	it("error state: a failed read gives no names and reads again the next time", async () => {
		const macFetch = jest
			.fn()
			.mockResolvedValueOnce(new Response("{}", { status: 500 }))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(new Response(JSON.stringify({ nodes: [{ id: "a", name: "A" }] })));
		const f = macFetch as unknown as typeof fetch;
		expect(await nodeNames(f)).toEqual({});
		expect(await nodeNames(f)).toEqual({});
		expect(await nodeNames(f)).toEqual({ a: "A" });
	});
});
