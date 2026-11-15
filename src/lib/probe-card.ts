/**
 * The probe_done card data (issue 05 slice D). The prober ends the probe
 * phase with a `probe_done` call. Its input is the learner assessment: one
 * entry for each strand, and an optional summary. The desktop draws it in
 * components/artifacts/probe-done-card.tsx; this file reads the part in the
 * same order, with the same shared parser (`parseProbeDoneInput`).
 *
 * The phone never shows the refusal text of the Mac (`output.error`), and
 * never shows an input that does not parse (an `output-error` input can have
 * any shape). See docs/ISSUES.md, issue 05, error state 13.
 */
import { parseProbeDoneInput } from "./shared";
import { teacherText } from "./teacher-text";

export type ProbeCardState =
	/** The prober still writes the call (the input is partial or missing). */
	| "writing"
	/** The Mac refused the input (`output-error`). The prober sent a new call. */
	| "malformed"
	/** The tool answered `ok: false`. The prober retried. */
	| "refused"
	/** The call finished, but its input does not parse on the phone. */
	| "unreadable"
	/** The assessment parsed: the card shows the strands. */
	| "ready";

export interface ProbeStrandView {
	strand: string;
	assessment: string;
}

export interface ProbeCardData {
	state: ProbeCardState;
	/** Only for state "ready". At least one strand (the schema has minItems 1). */
	strands: ProbeStrandView[];
	summary?: string;
}

/** The text of the note for each state that has no strand list. */
export const PROBE_NOTE: Record<Exclude<ProbeCardState, "ready">, string> = {
	writing: "Writing the assessment…",
	malformed: "The assessment was malformed. The prober sent a corrected one.",
	refused: "The prober retried with a corrected assessment.",
	unreadable: "The phone cannot show this assessment.",
};

interface ToolPart {
	state?: unknown;
	input?: unknown;
	output?: unknown;
}

export function probeCardData(part: ToolPart): ProbeCardData {
	const state = typeof part.state === "string" ? part.state : "";
	const output = part.output as { ok?: unknown } | null | undefined;
	if (state === "output-available" && output?.ok === false)
		return { state: "refused", strands: [] };
	if (state === "output-error") return { state: "malformed", strands: [] };
	const input = parseProbeDoneInput(part.input);
	if (!input)
		return { state: state === "output-available" ? "unreadable" : "writing", strands: [] };
	const { strands, summary } = input.assessment;
	return {
		state: "ready",
		strands: strands.map((s) => ({
			strand: teacherText(s.strand),
			assessment: teacherText(s.assessment),
		})),
		...(summary?.trim() ? { summary: teacherText(summary) } : {}),
	};
}

/**
 * The assessment as Markdown, for copy (decision 3): each strand as a bold
 * name and its text, then the summary. The strand text is already Markdown.
 */
export function probeMarkdown(data: Pick<ProbeCardData, "strands" | "summary">): string {
	// Bold signs inside the name would close the outer bold early.
	const name = (strand: string) => strand.replace(/\*\*|__/g, "").trim();
	const blocks = data.strands.map((s) => `**${name(s.strand)}**\n${s.assessment.trim()}`);
	if (data.summary) blocks.push(data.summary.trim());
	return blocks.join("\n\n");
}
