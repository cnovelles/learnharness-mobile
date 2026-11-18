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

	it("ends when the reveal is idle and the view is at the end, and then the normal rules apply", () => {
		const follow = createEndFollow();
		// The view is not at the end yet: an idle moment does not end the opening.
		follow.scrolled(at(1500));
		follow.revealIdle();
		expect(follow.opening()).toBe(true);
		// The app's scroll reaches the end.
		follow.scrolled(at(3200));
		expect(follow.opening()).toBe(false);
		expect(follow.follows()).toBe(true);
		// Now a drag that ends away from the end stops the follow.
		follow.dragStart(at(3200));
		follow.dragEnd(at(3100), false);
		expect(follow.follows()).toBe(false);
	});

	it("ends at once when the reveal is idle and the view is already at the end", () => {
		const follow = createEndFollow();
		follow.scrolled(at(3200));
		follow.revealIdle();
		expect(follow.opening()).toBe(false);
	});

	it("ends with a tap on the status bar (the view goes to the top)", () => {
		const follow = createEndFollow();
		follow.toTop();
		expect(follow.opening()).toBe(false);
		expect(follow.follows()).toBe(false);
	});

	it("follows again after a tap on the Latest button", () => {
		const follow = createEndFollow();
		follow.scrolled(at(3200));
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

describe("a touch stops the animated scroll to the end (iOS)", () => {
	it("asks for the scroll again after a short drag during the opening", () => {
		const follow = createEndFollow();
		// The touch stopped the scroll at 1500; the content does not grow after it.
		follow.dragStart(at(1500));
		expect(follow.dragEnd(at(1510), false)).toBe(true);
		expect(follow.follows()).toBe(true);
	});

	it("waits for the momentum, and then asks for the scroll again", () => {
		const follow = createEndFollow();
		follow.dragStart(at(1500));
		expect(follow.dragEnd(at(1600), true)).toBe(false);
		expect(follow.momentumEnd(at(2100))).toBe(true);
	});

	it("does not ask when the drag ends at the end", () => {
		const follow = createEndFollow();
		follow.dragStart(at(3150));
		expect(follow.dragEnd(at(3200), false)).toBe(false);
	});

	it("does not ask after a clear drag up (the reader wants to read above)", () => {
		const follow = createEndFollow();
		follow.dragStart(at(1500));
		expect(follow.dragEnd(at(1000), false)).toBe(false);
		expect(follow.follows()).toBe(false);
	});

	it("asks for the scroll again after a tap with no drag", () => {
		const follow = createEndFollow();
		// No scroll event yet: nothing is known, nothing to ask.
		expect(follow.touchEnd()).toBe(false);
		follow.scrolled(at(1500));
		expect(follow.touchEnd()).toBe(true);
		// At the end: no scroll.
		follow.scrolled(at(3200));
		expect(follow.touchEnd()).toBe(false);
	});

	it("leaves a tap during a drag to dragEnd", () => {
		const follow = createEndFollow();
		follow.scrolled(at(1500));
		follow.dragStart(at(1500));
		expect(follow.touchEnd()).toBe(false);
	});

	it("does not ask after a tap when the reader scrolled up (no follow)", () => {
		const follow = createEndFollow();
		follow.scrolled(at(3200));
		follow.revealIdle();
		follow.dragStart(at(3200));
		follow.dragEnd(at(1000), false);
		expect(follow.touchEnd()).toBe(false);
	});

	it("asks again when the app's own scroll stopped short of the end", () => {
		const follow = createEndFollow();
		expect(follow.momentumEnd(at(2000))).toBe(true);
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
