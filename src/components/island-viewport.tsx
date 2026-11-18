/**
 * Which islands are near the screen (issue 05 slice C, decision 3). An
 * island starts its WebView only when it comes near the visible part of the
 * transcript, and stops it again when it is far away, so a long lesson does
 * not hold a WebView process for each formula.
 *
 * The scroll view that holds the transcript gives a viewport with
 * `createIslandViewport()` and calls `notify` on scroll and on a size change.
 * With no viewport (the question dock, a card), every island is near.
 */
import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ComponentRef,
	type RefObject,
} from "react";
import { Dimensions, type View } from "react-native";

export type IslandViewport = {
	subscribe: (check: () => void) => () => void;
	notify: () => void;
};

export function createIslandViewport(): IslandViewport {
	const checks = new Set<() => void>();
	return {
		subscribe(check) {
			checks.add(check);
			return () => checks.delete(check);
		},
		notify() {
			for (const check of checks) check();
		},
	};
}

export const IslandViewportContext = createContext<IslandViewport | null>(null);

/**
 * Near or not, from the island's place in the window. An island comes near
 * within one screen of the visible part, and goes far only at three screens,
 * so a small scroll does not start and stop it again.
 */
export function isNearScreen(
	top: number,
	height: number,
	screen: number,
	wasNear: boolean,
): boolean {
	const margin = screen * (wasNear ? 3 : 1);
	return top < screen + margin && top + height > -margin;
}

/** How close to the end of the transcript still counts as "at the end". */
export const AT_END_MARGIN = 80;

/** True when the reader sees the end of the transcript (within AT_END_MARGIN). */
export function isAtEnd(offset: number, visible: number, content: number): boolean {
	return offset + visible >= content - AT_END_MARGIN;
}

export interface ScrollMetrics {
	offset: number;
	visible: number;
	content: number;
}

/**
 * During the opening, a drag up (toward the top) by more than this many
 * points stops the follow. A smaller touch is not a wish to read above.
 */
export const OPEN_DRAG_UP = 80;

/** The "↓ Latest" button shows more than one screen up from the end. */
export function showsLatest(m: ScrollMetrics): boolean {
	return m.content - (m.offset + m.visible) > m.visible;
}

/**
 * Decides if new content scrolls the transcript to the end. Only the
 * reader's own drag (and the momentum after it) or a tap on the status bar
 * changes the decision. The app's own animated scrollToEnd also sends
 * scroll events, and on iOS also onMomentumScrollEnd: a frame of it after
 * the content grew again is not at the end, and it must not stop the
 * follow (found on the Simulator, slice D: a growing island left the check
 * card under the screen).
 *
 * The opening (bug 2026-11-17): a session opens and scrolls down to its
 * last message while the top-to-bottom reveal grows the transcript. That
 * can take seconds when formulas draw. During the opening, a touch does not
 * stop the follow. Only a clear drag up (OPEN_DRAG_UP) does. The opening
 * ends when the reveal is idle and the view is at the end, or with a tap on
 * the status bar.
 *
 * On iOS a touch also stops the native animated scrollToEnd (the iPhone
 * check of e1b060e). When the content does not grow after that, no
 * onContentSizeChange calls scrollToEnd again. Thus dragEnd, momentumEnd
 * and touchEnd return true when the screen must call scrollToEnd again: the
 * follow is on and the view is not at the end.
 */
export function createEndFollow() {
	let following = true;
	let opening = true;
	let idle = false;
	let userScroll = false;
	let dragFrom: number | null = null;
	let last: ScrollMetrics | null = null;
	const seen = (m: ScrollMetrics) => {
		last = m;
		if (opening && idle && isAtEnd(m.offset, m.visible, m.content)) opening = false;
	};
	const read = (m: ScrollMetrics) => {
		following = isAtEnd(m.offset, m.visible, m.content);
	};
	/** The opening: stop the follow only for a clear drag up. */
	const openingRead = (m: ScrollMetrics) => {
		if (dragFrom === null || dragFrom - m.offset <= OPEN_DRAG_UP) return;
		following = false;
		opening = false;
	};
	/** True when the follow is on and the view is not at the end. */
	const again = (m: ScrollMetrics | null) =>
		following && m !== null && !isAtEnd(m.offset, m.visible, m.content);
	return {
		/** True when new content scrolls to the end. */
		follows: () => following,
		/** True until the first reveal of the transcript is done and the view is at the end. */
		opening: () => opening,
		/** The reader starts a drag. */
		dragStart: (m?: ScrollMetrics) => {
			userScroll = true;
			dragFrom = m?.offset ?? null;
		},
		/** Each scroll event. Only a scroll by the reader changes the decision. */
		scrolled: (m: ScrollMetrics) => {
			if (userScroll && !opening) read(m);
			seen(m);
		},
		/**
		 * The drag ends. With no speed left, no momentum follows: the
		 * reader's scroll ends. Returns true when the screen must scroll to
		 * the end again.
		 */
		dragEnd: (m: ScrollMetrics, moving: boolean): boolean => {
			if (!userScroll) return false;
			if (opening) openingRead(m);
			else read(m);
			seen(m);
			if (moving) return false;
			userScroll = false;
			return again(m);
		},
		/**
		 * A momentum ends. It changes the decision only after the reader's
		 * drag. Returns true when the screen must scroll to the end again (also
		 * after the app's own animated scroll stopped short of the end).
		 */
		momentumEnd: (m: ScrollMetrics): boolean => {
			if (userScroll) {
				if (opening) openingRead(m);
				else read(m);
				userScroll = false;
			}
			seen(m);
			return again(m);
		},
		/**
		 * A touch ends. A tap with no drag sends no drag events, but on iOS
		 * it stops the animated scrollToEnd. Returns true when the screen
		 * must scroll to the end again. During a drag, dragEnd decides.
		 */
		touchEnd: (): boolean => {
			if (userScroll) return false;
			return again(last);
		},
		/** The reveal has no block that waits: the opening ends at the end. */
		revealIdle: () => {
			idle = true;
			if (last) seen(last);
		},
		/** The reader tapped "↓ Latest": go to the end and follow again. */
		toEnd: () => {
			following = true;
			userScroll = false;
		},
		/** iOS: the reader tapped the status bar, and the view went to the top. */
		toTop: () => {
			following = false;
			opening = false;
		},
	};
}

/** Where a view is: near the visible part, far from it, or not measured yet. */
export type NearState = "unknown" | "near" | "far";

/**
 * Near, far or not measured yet. The top-to-bottom reveal needs "not
 * measured yet": a far island counts as ready (it loads later), but an
 * island that was not measured must not count as far.
 */
export function useNearScreenState(ref: RefObject<ComponentRef<typeof View> | null>): NearState {
	const viewport = useContext(IslandViewportContext);
	const [state, setState] = useState<NearState>(viewport === null ? "near" : "unknown");
	useEffect(() => {
		// With no viewport, the view is near and stays near.
		if (!viewport) return;
		let live = true;
		const check = () => {
			ref.current?.measureInWindow((_x, y, _w, h) => {
				if (!live || !Number.isFinite(y)) return;
				const screen = Dimensions.get("window").height;
				setState((was) => (isNearScreen(y, h, screen, was === "near") ? "near" : "far"));
			});
		};
		check();
		const unsubscribe = viewport.subscribe(check);
		return () => {
			live = false;
			unsubscribe();
		};
	}, [viewport, ref]);
	return state;
}

/** True when the view is near the visible part of the transcript. */
export function useNearScreen(ref: RefObject<ComponentRef<typeof View> | null>): boolean {
	return useNearScreenState(ref) === "near";
}
