/**
 * The Practice tab shelf (issue 20, slice C): time groups, problem counts,
 * and the continue card text.
 */
import {
	doneCount,
	practiceBadge,
	practiceGroups,
	practiceLine,
	problemCount,
	problemLabel,
	timeGroupOf,
} from "@/lib/practice-shelf";
import type { ChatListItem } from "@/lib/shared";

function chat(
	id: string,
	extra: Omit<Partial<ChatListItem>, "problemCount"> & { problemCount?: unknown } = {},
): ChatListItem {
	return {
		id,
		title: id,
		createdAt: "2026-11-10T10:00:00.000Z",
		updatedAt: "2026-11-10T10:00:00.000Z",
		kind: "practice",
		messageCount: 4,
		phase: "teach",
		pendingQuestion: false,
		pendingProblem: false,
		problemCount: 0,
		busy: false,
		compacting: false,
		...extra,
	} as ChatListItem;
}

/** A local time, so the tests do not depend on the time zone. */
const at = (day: number, hour: number, minute = 0) =>
	new Date(2026, 10, day, hour, minute).toISOString();
const now = new Date(2026, 10, 18, 15, 0);

describe("timeGroupOf", () => {
	it("starts Today at local midnight", () => {
		expect(timeGroupOf(at(18, 0, 0), now)).toBe("today");
		expect(timeGroupOf(at(17, 23, 59), now)).toBe("week");
	});

	it("puts the 6 days before today in This week, and older days in Earlier", () => {
		expect(timeGroupOf(at(12, 0, 0), now)).toBe("week");
		expect(timeGroupOf(at(11, 23, 59), now)).toBe("earlier");
		expect(timeGroupOf(at(1, 9), now)).toBe("earlier");
	});

	it("keeps a bad date or a date after now in Today", () => {
		expect(timeGroupOf("not a date", now)).toBe("today");
		expect(timeGroupOf(at(19, 9), now)).toBe("today");
	});

	it("counts days across a month start", () => {
		const first = new Date(2026, 11, 2, 8, 0);
		expect(timeGroupOf(at(26, 9), first)).toBe("week");
		expect(timeGroupOf(at(25, 9), first)).toBe("earlier");
	});
});

describe("practiceGroups", () => {
	it("gives Today, This week and Earlier, newest first, with no empty group", () => {
		const groups = practiceGroups(
			[
				chat("old", { updatedAt: at(2, 9) }),
				chat("morning", { updatedAt: at(18, 9) }),
				chat("monday", { updatedAt: at(16, 9) }),
				chat("noon", { updatedAt: at(18, 12) }),
			],
			now,
		);
		expect(groups.map((g) => [g.label, g.sessions.map((c) => c.id)])).toEqual([
			["Today", ["noon", "morning"]],
			["This week", ["monday"]],
			["Earlier", ["old"]],
		]);
		expect(practiceGroups([chat("x", { updatedAt: at(2, 9) })], now).map((g) => g.key)).toEqual([
			"earlier",
		]);
		expect(practiceGroups([], now)).toEqual([]);
	});
});

describe("counts", () => {
	it("reads the count, and gives null when an older Mac does not send it", () => {
		expect(problemCount(chat("a", { problemCount: 4 }))).toBe(4);
		expect(problemCount(chat("a", { problemCount: undefined }))).toBeNull();
		expect(problemCount(chat("a", { problemCount: "4" }))).toBeNull();
		expect(problemCount(chat("a", { problemCount: -1 }))).toBeNull();
		expect(problemCount(chat("a", { problemCount: 1.5 }))).toBeNull();
	});

	it("does not count the problem that waits as done", () => {
		expect(doneCount(chat("a", { problemCount: 4, pendingProblem: true }))).toBe(3);
		expect(doneCount(chat("a", { problemCount: 4 }))).toBe(4);
		expect(doneCount(chat("a", { problemCount: 0, pendingProblem: true }))).toBe(0);
		expect(doneCount(chat("a", { problemCount: undefined }))).toBeNull();
	});

	it("writes the count with the right noun", () => {
		expect(problemLabel(0)).toBe("0 problems");
		expect(problemLabel(1)).toBe("1 problem");
		expect(problemLabel(4)).toBe("4 problems");
	});
});

describe("continue card", () => {
	it("writes the problem and the done count", () => {
		expect(practiceLine(chat("a", { problemCount: 4, pendingProblem: true }))).toBe(
			"Problem 4 · 3 done",
		);
		expect(practiceLine(chat("a", { problemCount: 3 }))).toBe("Practice · 3 done");
		expect(practiceLine(chat("a", { problemCount: 0 }))).toBe("Practice");
		expect(practiceLine(chat("a", { problemCount: undefined, pendingProblem: true }))).toBe(
			"Practice",
		);
	});

	it("says whose turn it is", () => {
		expect(practiceBadge(chat("a"))).toBe("Your turn");
		expect(practiceBadge(chat("a", { pendingProblem: true }))).toBe("A problem waits");
		expect(practiceBadge(chat("a", { busy: true, pendingProblem: true }))).toBe("Working…");
		expect(practiceBadge(chat("a", { compacting: true }))).toBe("Making the history shorter");
	});
});
