/**
 * The top-to-bottom reveal of the transcript (user decision 2026-11-15;
 * the rules are in src/lib/reveal-gate.ts).
 *
 * - RevealProvider: one gate for one transcript (the session screen).
 * - RevealSlot: one block. A hidden block stays mounted, in its place,
 *   with no height and no opacity. So its formula, chart or table loads
 *   and measures itself (an island checks its real place on the screen),
 *   but takes no space and pushes nothing. At the front of the queue, a
 *   small spinner shows. A block that was hidden fades in when it shows.
 * - RevealScope: a text row. Its Markdown makes one slot for each
 *   top-level block, so a long reply shows block by block.
 * - useReportReady: a formula, chart, table or plan graph tells its slot
 *   when it is drawn. A block with no reporter is ready at once.
 *
 * With no provider (the question dock, a card outside the transcript, the
 * tests of one component), a slot shows its block at once.
 */
import {
	createContext,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";

import { createRevealGate, type RevealGate, type RevealKey } from "@/lib/reveal-gate";
import { Spinner } from "./ui";

/** The fade of a block that was hidden. */
const FADE_MS = 200;

const GateContext = createContext<RevealGate | null>(null);

interface Scope {
	prefix: RevealKey;
	/** The space over the first block (the gap between transcript rows). */
	space: number;
}
const ScopeContext = createContext<Scope | null>(null);

interface Group {
	report(id: string, ready: boolean): void;
	drop(id: string): void;
}
const GroupContext = createContext<Group | null>(null);

export function RevealProvider({ children }: { children: ReactNode }) {
	const [gate] = useState(() => createRevealGate());
	useEffect(() => () => gate.dispose(), [gate]);
	return <GateContext.Provider value={gate}>{children}</GateContext.Provider>;
}

/** True inside a RevealProvider: the transcript lays out its rows as slots. */
export function useRevealActive(): boolean {
	return useContext(GateContext) !== null;
}

/** A text row: its Markdown makes one slot for each top-level block. */
export function RevealScope({
	prefix,
	space,
	children,
}: {
	prefix: RevealKey;
	space: number;
	children: ReactNode;
}) {
	const key = prefix.join(".");
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const scope = useMemo(() => ({ prefix, space }), [key, space]);
	return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

/** The scope of a text row, when a gate exists (Markdown reads it). */
export function useRevealScope(): Scope | null {
	const gate = useContext(GateContext);
	const scope = useContext(ScopeContext);
	return gate ? scope : null;
}

/** A formula, chart, table or graph reports whether it is drawn. */
export function useReportReady(ready: boolean) {
	const group = useContext(GroupContext);
	const id = useId();
	useLayoutEffect(() => {
		group?.report(id, ready);
	}, [group, id, ready]);
	useLayoutEffect(() => () => group?.drop(id), [group, id]);
}

function useReduceMotion(): boolean {
	const [reduce, setReduce] = useState(false);
	useEffect(() => {
		let live = true;
		AccessibilityInfo.isReduceMotionEnabled()
			.then((on) => live && setReduce(on))
			.catch(() => {});
		const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
		return () => {
			live = false;
			sub.remove();
		};
	}, []);
	return reduce;
}

const noGate: RevealGate["subscribe"] = () => () => {};

/**
 * One block of the transcript. `space` is the space over it when it shows
 * (the gap to the block above). A hidden block takes no space, so the
 * blocks over the front keep their place.
 */
export function RevealSlot({
	order,
	space,
	children,
}: {
	order: RevealKey;
	space: number;
	children: ReactNode;
}) {
	const gate = useContext(GateContext);
	const id = useId();
	const key = order.join(".");
	const keyRef = useRef(order);
	const reporters = useRef(new Map<string, boolean>());
	const mounted = useRef(false);
	const [fade] = useState(() => new Animated.Value(1));
	const wasHidden = useRef(false);
	const reduceMotion = useReduceMotion();

	const group = useMemo<Group>(() => {
		const push = () => {
			if (!gate || !mounted.current) return;
			gate.set(id, keyRef.current, [...reporters.current.values()].every(Boolean));
		};
		return {
			report(rid, ready) {
				reporters.current.set(rid, ready);
				push();
			},
			drop(rid) {
				reporters.current.delete(rid);
				push();
			},
		};
	}, [gate, id]);

	// The children's layout effects run first: their reports are in when
	// the slot registers, so a ready block shows before the first paint.
	useLayoutEffect(() => {
		if (!gate) return;
		mounted.current = true;
		gate.set(id, keyRef.current, [...reporters.current.values()].every(Boolean));
		if (gate.view(id) !== "shown") {
			wasHidden.current = true;
			fade.setValue(0);
		}
		return () => {
			mounted.current = false;
			gate.remove(id);
		};
	}, [gate, id, fade]);
	// A row that moves (a row above it went away) keeps its slot with the new key.
	useLayoutEffect(() => {
		keyRef.current = order;
		if (gate && mounted.current)
			gate.set(id, order, [...reporters.current.values()].every(Boolean));
		// `key` is the order as text: a new array with the same order changes nothing.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [gate, id, key]);

	const view = useSyncExternalStore(
		gate ? gate.subscribe : noGate,
		() => (gate ? gate.view(id) : "shown"),
		() => (gate ? gate.view(id) : "shown"),
	);
	const shown = view === "shown";

	useEffect(() => {
		if (!shown || !wasHidden.current) return;
		wasHidden.current = false;
		if (reduceMotion) {
			fade.setValue(1);
			return;
		}
		Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
	}, [shown, reduceMotion, fade]);

	return (
		<>
			{view === "front" ? (
				<View style={[styles.wait, { marginTop: space }]} testID="reveal-wait">
					<Spinner />
				</View>
			) : null}
			<Animated.View
				style={shown ? { marginTop: space, opacity: fade } : styles.hidden}
				pointerEvents={shown ? "auto" : "none"}
				accessibilityElementsHidden={!shown}
				importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
			>
				<GroupContext.Provider value={group}>
					<ScopeContext.Provider value={null}>{children}</ScopeContext.Provider>
				</GroupContext.Provider>
			</Animated.View>
		</>
	);
}

const styles = StyleSheet.create({
	// In its place, with no height: it loads and measures, but takes no space.
	hidden: { height: 0, overflow: "hidden", opacity: 0 },
	wait: { alignItems: "flex-start" },
});
