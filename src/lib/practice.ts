/**
 * Practice sessions (issue 06): the data of the practice rows, read from
 * the shared view parts (fork src/core/view.ts) as the desktop cards read
 * them (fork components/practice-cards.tsx).
 *
 * - `tool-problem`: the problem card. Only the statement is the learner's.
 *   The model solution rides the same call and is never shown here.
 * - `tool-conclude`: the conclusion. The model solution is `part.reveal`
 *   (the view joins it from the problem call), the mode and the targets are
 *   `part.problemInput`.
 * - `data-practice-thinking`: the learner's thinking for a problem.
 * - `data-practice-next`: the learner's "Next problem".
 *
 * Every field can be missing or of the wrong type in an old or broken
 * record: the cards then show what they have, never raw data.
 */
import { teacherText } from "./teacher-text";
import type { LhViewMessage } from "./shared";

type Part = LhViewMessage["parts"][number];

export const PROBLEM_TOOL = "problem";
export const CONCLUDE_TOOL = "conclude";

export interface ProblemCardData {
	statement: string;
	/** The call's arguments still stream. */
	streaming: boolean;
}

export function problemCardData(part: Part): ProblemCardData {
	const input = (part.input ?? {}) as { statement?: unknown };
	return {
		statement: typeof input.statement === "string" ? teacherText(input.statement) : "",
		streaming: part.state === "input-streaming",
	};
}

export type OutcomeTone = "ok" | "warning" | "danger" | "muted";

/** The desktop's outcome labels and chip colors (practice-cards.tsx). */
const OUTCOMES: Record<string, { label: string; tone: OutcomeTone }> = {
	solved: { label: "Solved", tone: "ok" },
	solvedWithHints: { label: "Solved with hints", tone: "warning" },
	movedOn: { label: "Moved on", tone: "muted" },
	surrendered: { label: "Surrendered", tone: "danger" },
};

export interface PracticeMetadata {
	mode: string;
	/** Proposition ids. The card shows their names when the graph has them. */
	targets: string[];
	outcome: string;
	rung: string;
	missClass: string;
	retest: boolean | undefined;
}

export type ConcludeCardData =
	| { dismissed: true }
	| {
			dismissed: false;
			/** null for an outcome that the phone does not know: no chip. */
			outcome: { label: string; tone: OutcomeTone } | null;
			verdict: string;
			/** The model solution, verbatim from the problem call. */
			reveal: string;
			/** null when the agent filled no metadata field. */
			metadata: PracticeMetadata | null;
	  };

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function concludeCardData(part: Part): ConcludeCardData {
	const input = (part.input ?? {}) as {
		outcome?: unknown;
		verdict?: unknown;
		solutionReveal?: unknown;
		rung?: unknown;
		missClass?: unknown;
		retest?: unknown;
	};
	const outcome = str(input.outcome);
	if (outcome === "dismissed") return { dismissed: true };
	const extra = part as { reveal?: unknown; problemInput?: unknown };
	// Old records carry their own solutionReveal (the desktop's fallback).
	const reveal = typeof extra.reveal === "string" ? extra.reveal : str(input.solutionReveal);
	const problem = (extra.problemInput ?? {}) as { mode?: unknown; target?: unknown };
	const targets = Array.isArray(problem.target)
		? problem.target.filter((t): t is string => typeof t === "string")
		: [];
	const metadata: PracticeMetadata = {
		mode: str(problem.mode),
		targets,
		outcome,
		rung: str(input.rung),
		missClass: str(input.missClass),
		retest: typeof input.retest === "boolean" ? input.retest : undefined,
	};
	const hasMetadata =
		!!metadata.mode ||
		targets.length > 0 ||
		!!metadata.rung ||
		!!metadata.missClass ||
		metadata.retest !== undefined;
	return {
		dismissed: false,
		outcome: OUTCOMES[outcome] ?? null,
		verdict: teacherText(str(input.verdict)),
		reveal: teacherText(reveal),
		metadata: hasMetadata ? metadata : null,
	};
}

export interface PracticeThinkingData {
	text: string;
	/** Images that came with the thinking (from the Mac). The phone does not show them. */
	images: number;
}

export function practiceThinkingData(part: Part): PracticeThinkingData {
	const data = (part.data ?? {}) as { text?: unknown; images?: unknown };
	return {
		text: str(data.text),
		images: Array.isArray(data.images) ? data.images.length : 0,
	};
}

/**
 * The names of the graph's propositions, by id, for the metadata targets.
 * One read of GET /api/graph for each Mac connection. A failure gives an
 * empty map: the card then shows the ids (as the desktop does), and the
 * next card that opens reads the graph again.
 */
const nameMaps = new WeakMap<typeof fetch, Promise<Record<string, string>>>();

export function nodeNames(macFetch: typeof fetch): Promise<Record<string, string>> {
	let names = nameMaps.get(macFetch);
	if (!names) {
		names = macFetch("/api/graph")
			.then((r) => {
				if (!r.ok) throw new Error("graph");
				return r.json() as Promise<{ nodes?: unknown }>;
			})
			.then((g) => {
				const out: Record<string, string> = {};
				for (const n of Array.isArray(g.nodes) ? g.nodes : []) {
					const node = n as { id?: unknown; name?: unknown };
					if (typeof node.id === "string")
						out[node.id] = typeof node.name === "string" ? node.name : node.id;
				}
				return out;
			})
			.catch(() => {
				// Read again the next time a card opens.
				nameMaps.delete(macFetch);
				return {};
			});
		nameMaps.set(macFetch, names);
	}
	return names;
}
