/**
 * The session open position (bug 2026-11-17). A long session opens and
 * scrolls down to its last message while the top-to-bottom reveal runs.
 * A touch during that opening must not stop the scroll. Only a clear drag
 * up stops it. The "↓ Latest" button shows more than one screen up.
 */
import {
	OPEN_DRAG_UP,
	createEndFollow,
	showsLatest,
	type ScrollMetrics,
} from "@/components/island-viewport";

const at = (offset: number, content = 4000, visible = 800): ScrollMetrics => ({
	offset,
	visible,
	content,
});

describe("the opening of a session", () => {
	it("keeps the follow when the reader touches the screen during the opening", () => {
		const follow = createEndFollow();
		expect(follow.opening()).toBe(true);
		// A short touch while the reveal still grows the transcript at the bottom.
		follow.dragStart(at(600));
		follow.scrolled(at(620));
		follow.dragEnd(at(630), false);
		expect(follow.follows()).toBe(true);
		// A flick down (toward the end), with momentum.
		follow.dragStart(at(700));
		follow.dragEnd(at(900), true);
		follow.momentumEnd(at(1400));
		expect(follow.follows()).toBe(true);
		expect(follow.opening()).toBe(true);
	});

	it("stops the follow when the reader clearly drags up during the opening", () => {
		const follow = createEndFollow();
		follow.dragStart(at(1200));
		// A small move up is not enough.
		follow.dragEnd(at(1200 - OPEN_DRAG_UP + 1), false);
		expect(follow.follows()).toBe(true);
		follow.dragStart(at(1200));
		follow.dragEnd(at(1200 - OPEN_DRAG_UP - 1), false);
		expect(follow.follows()).toBe(false);
		expect(follow.opening()).toBe(false);
	});

	it("counts the momentum of a drag up during the opening", () => {
		const follow = createEndFollow();
		follow.dragStart(at(1200));
		follow.dragEnd(at(1180), true);
		expect(follow.follows()).toBe(true);
		follow.momentumEnd(at(700));
		expect(follow.follows()).toBe(false);
	});

	it("ends when the reveal is idle, and then the normal rules apply", () => {
		const follow = createEndFollow();
		follow.revealIdle();
		expect(follow.opening()).toBe(false);
		expect(follow.follows()).toBe(true);
		// Now a drag that ends away from the end stops the follow.
		follow.dragStart(at(3200));
		follow.dragEnd(at(3100), false);
		expect(follow.follows()).toBe(false);
	});

	it("ends with a tap on the status bar (the view goes to the top)", () => {
		const follow = createEndFollow();
		follow.toTop();
		expect(follow.opening()).toBe(false);
		expect(follow.follows()).toBe(false);
	});

	it("follows again after a tap on the Latest button", () => {
		const follow = createEndFollow();
		follow.revealIdle();
		follow.dragStart(at(3200));
		follow.dragEnd(at(500), false);
		expect(follow.follows()).toBe(false);
		follow.toEnd();
		expect(follow.follows()).toBe(true);
		// The app's scroll to the end sends frames that are not at the end.
		follow.scrolled(at(1500));
		follow.momentumEnd(at(2000));
		expect(follow.follows()).toBe(true);
	});
});

describe("the Latest button", () => {
	it("shows only more than one screen up from the end", () => {
		// content 4000, visible 800: the end offset is 3200.
		expect(showsLatest(at(3200))).toBe(false);
		expect(showsLatest(at(2400))).toBe(false);
		expect(showsLatest(at(2399))).toBe(true);
		expect(showsLatest(at(0))).toBe(true);
	});

	it("does not show for a transcript shorter than two screens", () => {
		expect(showsLatest(at(0, 1500))).toBe(false);
	});
});

describe("the open at a message (issue 08 slice C2)", () => {
	it("does not follow the end and has no opening; Latest follows again", () => {
		const follow = createEndFollow({ atEnd: false });
		expect(follow.follows()).toBe(false);
		expect(follow.opening()).toBe(false);
		follow.toEnd();
		expect(follow.follows()).toBe(true);
	});
});
