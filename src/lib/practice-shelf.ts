/**
 * The Practice tab shelf (issue 20, slice C). Pure code: the screen gives it
 * the practice sessions, and it gives the continue card and the time groups.
 *
 * The rules (user decisions 2026-11-18, docs/ISSUES.md issue 20):
 * - Time groups by `updatedAt` in the iPhone time zone: Today (since
 *   midnight), This week (the 6 days before today), Earlier. A group with
 *   no sessions does not show. Each group is newest first.
 * - The row number is all problems in the session (`problemCount` from the
 *   fork's `GET /api/chats`): "4 problems", "1 problem", "0 problems".
 * - The continue card is the newest practice session (`continueSession`
 *   of src/lib/teach-shelf.ts), with the line
 *   "Problem 4 · 3 done" and a badge.
 * - Done is `problemCount` less the problem that waits (`pendingProblem`).
 * - An older fork build sends no `problemCount`: the rows show no number,
 *   and the card line shows no count.
 */
import type { ChatListItem } from "./shared";

export type TimeGroupKey = "today" | "week" | "earlier";

export const TIME_GROUP_LABEL: Record<TimeGroupKey, string> = {
	today: "Today",
	week: "This week",
	earlier: "Earlier",
};

export interface TimeGroup {
	key: TimeGroupKey;
	label: string;
	sessions: ChatListItem[];
}

/** The days in "This week" before today. */
const WEEK_DAYS_BEFORE_TODAY = 6;

/** The group of a time: local midnight starts Today, and 6 days before it start This week. */
export function timeGroupOf(updatedAt: string, now: Date): TimeGroupKey {
	const time = Date.parse(updatedAt);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const week = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() - WEEK_DAYS_BEFORE_TODAY,
	);
	// A bad date, or a date after now (a clock difference): keep the session visible in Today.
	if (Number.isNaN(time) || time >= today.getTime()) return "today";
	return time >= week.getTime() ? "week" : "earlier";
}

const newestFirst = (a: ChatListItem, b: ChatListItem) =>
	b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

/** The time groups of the Practice tab, in the order Today, This week, Earlier. */
export function practiceGroups(chats: readonly ChatListItem[], now: Date): TimeGroup[] {
	const keys: TimeGroupKey[] = ["today", "week", "earlier"];
	return keys
		.map((key) => ({
			key,
			label: TIME_GROUP_LABEL[key],
			sessions: chats.filter((c) => timeGroupOf(c.updatedAt, now) === key).sort(newestFirst),
		}))
		.filter((g) => g.sessions.length > 0);
}

/**
 * The problem count of a session, or null when the Mac does not send it
 * (a fork build from before issue 20 slice C).
 */
export function problemCount(chat: ChatListItem): number | null {
	const count: unknown = (chat as { problemCount?: unknown }).problemCount;
	return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

/** The problems that do not wait now (concluded or dismissed), or null with no count. */
export function doneCount(chat: ChatListItem): number | null {
	const count = problemCount(chat);
	if (count === null) return null;
	return chat.pendingProblem ? Math.max(0, count - 1) : count;
}

/** "1 problem", "4 problems". */
export function problemLabel(count: number): string {
	return count === 1 ? "1 problem" : `${count} problems`;
}

/**
 * The mono line of the continue card: "Problem 4 · 3 done" while a problem
 * waits, "Practice · 3 done" between problems, and "Practice" with no
 * problem yet or with no count.
 */
export function practiceLine(chat: ChatListItem): string {
	const count = problemCount(chat);
	const done = doneCount(chat);
	if (count === null || done === null || count === 0) return "Practice";
	if (chat.pendingProblem) return `Problem ${count} · ${done} done`;
	return `Practice · ${done} done`;
}

/** The badge of the continue card. */
export function practiceBadge(chat: ChatListItem): string {
	if (chat.busy) return "Working…";
	if (chat.compacting) return "Making the history shorter";
	if (chat.pendingProblem) return "A problem waits";
	return "Your turn";
}
