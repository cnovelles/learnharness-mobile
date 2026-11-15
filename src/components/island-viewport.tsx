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

/** True when the view is near the visible part of the transcript. */
export function useNearScreen(ref: RefObject<ComponentRef<typeof View> | null>): boolean {
	const viewport = useContext(IslandViewportContext);
	const [near, setNear] = useState(viewport === null);
	useEffect(() => {
		// With no viewport, `near` starts true and stays true.
		if (!viewport) return;
		let live = true;
		const check = () => {
			ref.current?.measureInWindow((_x, y, _w, h) => {
				if (!live || !Number.isFinite(y)) return;
				const screen = Dimensions.get("window").height;
				setNear((was) => isNearScreen(y, h, screen, was));
			});
		};
		check();
		const unsubscribe = viewport.subscribe(check);
		return () => {
			live = false;
			unsubscribe();
		};
	}, [viewport, ref]);
	return near;
}
