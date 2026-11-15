/**
 * Issue 05 slice F (acceptance): the fork's recorded sessions draw as full
 * transcripts with no fallback. The records go through the same path as on
 * the phone: `projectView`, then `transcriptRows`, then `Transcript`. The
 * fork's tool-rendering regressions (model text with math and escapes) draw
 * as Markdown with no plain fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react-native";

import { Markdown } from "@/components/markdown";
import { Transcript } from "@/components/transcript";
import { PROBE_NOTE } from "@/lib/probe-card";
import { projectView, type LhMessage } from "@/lib/shared";
import { teacherText } from "@/lib/teacher-text";
import { transcriptRows } from "@/lib/transcript";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const FIXTURES = path.resolve(__dirname, "../../learnharness/tests/fixtures");

interface ChatRecord {
	id: string;
	messages: LhMessage[];
}

const chats: ChatRecord[] = fs
	.readdirSync(path.join(FIXTURES, "golden-data/chats"))
	.filter((f) => f.endsWith(".json"))
	.map(
		(f) =>
			JSON.parse(
				fs.readFileSync(path.join(FIXTURES, "golden-data/chats", f), "utf8"),
			) as ChatRecord,
	);

const rowsOf = (chat: ChatRecord) => transcriptRows(projectView(chat.messages));

afterEach(() => jest.restoreAllMocks());

describe("golden sessions", () => {
	it("finds the recorded sessions", () => {
		expect(chats.length).toBeGreaterThanOrEqual(2);
	});

	it.each(chats.map((c) => [c.id, c] as const))(
		"%s draws as a transcript with no fallback and no error",
		async (_id, chat) => {
			const error = jest.spyOn(console, "error");
			const rows = rowsOf(chat);
			expect(rows.length).toBeGreaterThan(0);
			await render(<Transcript rows={rows} onOpenPlan={() => {}} />);
			// No message falls back to plain text (error state 2).
			expect(screen.queryByTestId("md-plain")).toBeNull();
			// No probe card shows a failure note.
			for (const note of [PROBE_NOTE.malformed, PROBE_NOTE.unreadable]) {
				expect(screen.queryByText(note)).toBeNull();
			}
			// No tool line shows a raw record.
			expect(screen.queryByText(/"toolCallId"|\{"strands"/)).toBeNull();
			expect(error).not.toHaveBeenCalled();
		},
	);

	it("draws the plan of the probe-and-teach session as a graph, not the text card", async () => {
		const chat = chats.find((c) => rowsOf(c).some((r) => r.kind === "plan"));
		expect(chat).toBeDefined();
		const plans = rowsOf(chat!).filter((r) => r.kind === "plan");
		await render(<Transcript rows={plans} onOpenPlan={() => {}} />);
		for (const row of plans) {
			expect(screen.getByTestId(`plan-svg-${row.id}`)).toBeTruthy();
		}
		expect(screen.queryByText("LESSON PLAN")).toBeNull();
	});

	it("draws the recorded probe assessment as the folded card with its strands", async () => {
		const chat = chats.find((c) => rowsOf(c).some((r) => r.kind === "probe"));
		expect(chat).toBeDefined();
		const probes = rowsOf(chat!).filter((r) => r.kind === "probe");
		await render(<Transcript rows={probes} onOpenPlan={() => {}} />);
		const cards = probes.filter((r) => screen.queryByTestId(`probe-head-${r.id}`));
		expect(cards.length).toBeGreaterThan(0);
	});
});

describe("the recorded practice session (issue 06)", () => {
	const chat = chats.find((c) => rowsOf(c).some((r) => r.kind === "problem"));

	it("draws its problems, thinking, conclusions and the Next problem line", async () => {
		expect(chat).toBeDefined();
		const rows = rowsOf(chat!);
		const kinds = rows.map((r) => r.kind);
		expect(kinds.filter((k) => k === "problem")).toHaveLength(2);
		expect(kinds.filter((k) => k === "practice-thinking")).toHaveLength(2);
		expect(kinds.filter((k) => k === "conclude")).toHaveLength(2);
		expect(kinds.filter((k) => k === "practice-next")).toHaveLength(1);
		await render(<Transcript rows={rows} onOpenPlan={() => {}} />);
		expect(screen.getByText("SOLVED")).toBeTruthy();
		expect(screen.getByText("Problem dismissed.")).toBeTruthy();
		expect(screen.getAllByText("MODEL SOLUTION")).toHaveLength(1);
	});

	it("never shows a problem's model solution in its problem card", async () => {
		const rows = rowsOf(chat!).filter((r) => r.kind === "problem");
		await render(<Transcript rows={rows} onOpenPlan={() => {}} />);
		expect(screen.queryByText("MODEL SOLUTION")).toBeNull();
		// The first words of each committed solution are not on the screen.
		const solutions = chat!.messages.flatMap((m) =>
			m.role === "assistant"
				? m.content.flatMap((b) =>
						b.type === "toolCall" && b.name === "problem"
							? [String((b.arguments as { modelSolution?: unknown }).modelSolution ?? "")]
							: [],
					)
				: [],
		);
		expect(solutions).toHaveLength(2);
		for (const solution of solutions) {
			const start = solution.trim().split(/\s+/).slice(0, 4).join(" ");
			expect(start.length).toBeGreaterThan(0);
			expect(
				screen.queryByText(new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
			).toBeNull();
		}
		expect(screen.queryByTestId(/^tool-/)).toBeNull();
	});
});

describe("tool-rendering regressions", () => {
	// The fork's frozen model text that broke the desktop display before.
	const texts: string[] = [];
	for (const file of fs.readdirSync(path.join(FIXTURES, "tool-rendering"))) {
		if (!file.endsWith(".json")) continue;
		const data = JSON.parse(
			fs.readFileSync(path.join(FIXTURES, "tool-rendering", file), "utf8"),
		) as { cases?: { raw?: unknown }[] };
		for (const c of data.cases ?? []) if (typeof c.raw === "string") texts.push(c.raw);
	}

	it("finds the regression texts", () => {
		expect(texts.length).toBeGreaterThan(0);
	});

	it("draws each text as Markdown with no plain fallback and no error", async () => {
		const error = jest.spyOn(console, "error");
		for (const text of texts) {
			await render(<Markdown text={teacherText(text)} style={{ fontSize: 16, lineHeight: 23 }} />);
			expect(screen.queryByTestId("md-plain")).toBeNull();
		}
		expect(error).not.toHaveBeenCalled();
	});
});
