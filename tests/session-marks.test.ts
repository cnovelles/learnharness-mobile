import { sessionMarks } from "@/components/session-list";
import type { ChatListItem } from "@/lib/shared";

const now = new Date("2026-11-15T12:00:00Z");
const chat = (over: Partial<ChatListItem> = {}): ChatListItem => ({
	id: "c1",
	title: "Tides",
	createdAt: "2026-11-15T10:00:00Z",
	updatedAt: "2026-11-15T11:55:00Z",
	kind: "teach",
	messageCount: 4,
	phase: "teach",
	pendingQuestion: false,
	pendingProblem: false,
	busy: false,
	compacting: false,
	...over,
});

describe("sessionMarks (the second line of a home row)", () => {
	it("shows the phase and how long ago when nothing waits", () => {
		expect(sessionMarks(chat(), now)).toBe("Teaching · 5m ago");
		expect(sessionMarks(chat({ phase: "probe" }), now)).toBe("Finding out what you know · 5m ago");
		expect(sessionMarks(chat({ phase: "plan" }), now)).toBe("Planning · 5m ago");
		expect(sessionMarks(chat({ kind: "practice" }), now)).toBe("Practice · 5m ago");
	});

	it("shows the waiting state in place of the phase", () => {
		expect(sessionMarks(chat({ pendingQuestion: true }), now)).toBe("A question waits · 5m ago");
		expect(sessionMarks(chat({ pendingProblem: true }), now)).toBe("A problem waits · 5m ago");
		expect(sessionMarks(chat({ compacting: true, pendingQuestion: true }), now)).toBe(
			"Making the history shorter · 5m ago",
		);
	});

	it("shows only Working… while a turn runs", () => {
		expect(sessionMarks(chat({ busy: true, pendingQuestion: true }), now)).toBe("Working…");
	});

	it("leaves out the time when the date does not parse", () => {
		expect(sessionMarks(chat({ updatedAt: "bad" }), now)).toBe("Teaching");
	});
});
