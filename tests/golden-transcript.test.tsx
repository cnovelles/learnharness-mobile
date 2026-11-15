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
