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
 * Decides if new content scrolls the transcript to the end. Only the
 * reader's own drag (and the momentum after it) or a tap on the status bar
 * changes the decision. The app's own animated scrollToEnd also sends
 * scroll events, and on iOS also onMomentumScrollEnd: a frame of it after
 * the content grew again is not at the end, and it must not stop the
 * follow (found on the Simulator, slice D: a growing island left the check
 * card under the screen).
 */
export function createEndFollow() {
	let following = true;
	let userScroll = false;
	const read = (m: ScrollMetrics) => {
		following = isAtEnd(m.offset, m.visible, m.content);
	};
	return {
		/** True when new content scrolls to the end. */
		follows: () => following,
		/** The reader starts a drag. */
		dragStart: () => {
			userScroll = true;
		},
		/** Each scroll event. Only a scroll by the reader changes the decision. */
		scrolled: (m: ScrollMetrics) => {
			if (userScroll) read(m);
		},
		/** The drag ends. With no speed left, no momentum follows: the reader's scroll ends. */
		dragEnd: (m: ScrollMetrics, moving: boolean) => {
			if (!userScroll) return;
			read(m);
			if (!moving) userScroll = false;
		},
		/** A momentum ends. It counts only after the reader's drag. */
		momentumEnd: (m: ScrollMetrics) => {
			if (!userScroll) return;
			read(m);
			userScroll = false;
		},
		/** iOS: the reader tapped the status bar, and the view went to the top. */
		toTop: () => {
			following = false;
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
