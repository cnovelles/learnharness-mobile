/**
 * The dictation controls (issue 07, user decisions 2026-11-16):
 * - MicButton: next to the main button of the input on screen (the
 *   composer's Send, the question's Send answer, the practice Submit
 *   thinking, the reading Open).
 * - DictationRow: while a run is on, it takes the place of that row: Stop,
 *   a red dot and the level meter (no live text, as the desktop).
 * - DictationProblemLine: the error line above the row.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useOptionalDictationController } from "@/lib/dictation-context";
import type { Dictation, DictationSnapshot } from "@/lib/dictation";
import { ErrorText, FONT, Icon, Spinner, TYPE, alpha, usePalette } from "./ui";
import { SPACE } from "./spacing";

/** The desktop meter's tuning (fork components/dictation.tsx). */
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;
const METER_TICK_MS = 60;
const METER_CELLS = 24;

/** RMS (0…1) to a bar height (0…1) on the desktop's dB scale. */
export function rmsToMeter(rms: number): number {
	if (!(rms > 0)) return 0;
	const db = 20 * Math.log10(rms);
	return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB)));
}

const IDLE_SNAPSHOT: DictationSnapshot = {
	phase: "idle",
	progress: 0,
	owner: null,
	problem: null,
	orphan: null,
};
const noop = () => () => {};

function useSnapshot(d: Dictation | null): DictationSnapshot {
	return useSyncExternalStore(d ? d.subscribe : noop, d ? d.getSnapshot : () => IDLE_SNAPSHOT);
}

/**
 * One input that can take dictated text. `append` adds the text to the
 * input's value. When the input goes away during its run, the text waits
 * for the composer (orphan text).
 */
export function useDictationInput(append: (text: string) => void) {
	const d = useOptionalDictationController();
	const snapshot = useSnapshot(d);
	const [owner] = useState(() => Symbol("dictation-input"));
	const appendRef = useRef(append);
	useEffect(() => {
		appendRef.current = append;
	});
	useEffect(() => () => d?.release(owner), [d, owner]);
	const mine = snapshot.owner === owner;
	return {
		available: d !== null,
		/** This input's run is on (preparing, installing, listening or stopping). */
		active: mine && snapshot.phase !== "idle",
		/** Another input's run is on: this mic waits. */
		busyElsewhere: snapshot.owner !== null && !mine,
		phase: mine ? snapshot.phase : "idle",
		progress: snapshot.progress,
		/** The last run's problem shows at the input that started it, or at any input after. */
		problem: snapshot.owner === null || mine ? snapshot.problem : null,
		start: () => {
			if (!d) return;
			d.clearProblem();
			void d.start(owner, (text) => appendRef.current(text));
		},
		stop: () => void d?.stop(),
		cancel: () => void d?.cancel(),
		clearProblem: () => d?.clearProblem(),
		level: () => d?.level() ?? 0,
	};
}

export type DictationInput = ReturnType<typeof useDictationInput>;

/** The composer takes text from a run whose input went away. */
export function useOrphanText(onText: (text: string) => void) {
	const d = useOptionalDictationController();
	const snapshot = useSnapshot(d);
	const onTextRef = useRef(onText);
	useEffect(() => {
		onTextRef.current = onText;
	});
	useEffect(() => {
		if (!d || snapshot.orphan === null) return;
		const text = d.takeOrphan();
		if (text) onTextRef.current(text);
	}, [d, snapshot.orphan]);
}

export function MicButton({
	input,
	size = 40,
	testID = "dictate",
}: {
	input: DictationInput;
	size?: number;
	testID?: string;
}) {
	const c = usePalette();
	if (!input.available) return null;
	const disabled = input.busyElsewhere;
	return (
		<Pressable
			testID={testID}
			accessibilityRole="button"
			accessibilityLabel="Start dictation"
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={input.start}
			hitSlop={SPACE.xs}
			style={({ pressed }) => [
				styles.mic,
				{
					width: size,
					height: size,
					borderColor: c.line,
					backgroundColor: pressed ? c.hover : "transparent",
					opacity: disabled ? 0.4 : 1,
				},
			]}
		>
			<Icon name="mic" size={16} color={c.muted} />
		</Pressable>
	);
}

/** The level meter: its own 60 ms timer reads the level, so only this view repaints. */
function Meter({ level }: { level: () => number }) {
	const c = usePalette();
	const [cells, setCells] = useState<number[]>(() => new Array(METER_CELLS).fill(0));
	useEffect(() => {
		const id = setInterval(() => {
			setCells((ring) => [...ring.slice(1), rmsToMeter(level())]);
		}, METER_TICK_MS);
		return () => clearInterval(id);
	}, [level]);
	return (
		<View style={styles.meter} testID="dictation-meter" accessibilityElementsHidden>
			{cells.map((v, i) => (
				<View
					key={i}
					style={[
						styles.cell,
						{ height: 2 + Math.round(v * 14), backgroundColor: alpha(c.text, 0.4) },
					]}
				/>
			))}
		</View>
	);
}

/** The row while this input's run is on. It takes the place of the mic and the main button. */
export function DictationRow({ input }: { input: DictationInput }) {
	const c = usePalette();
	if (input.phase === "installing") {
		const percent = Math.round(input.progress * 100);
		return (
			<View style={styles.row} testID="dictation-installing">
				<Icon name="arrow.down.circle" size={16} color={c.muted} />
				<Text style={[styles.note, { color: c.muted }]} numberOfLines={2}>
					Getting the speech model… {percent}%
				</Text>
				<Pressable
					onPress={input.cancel}
					accessibilityRole="button"
					testID="dictation-cancel"
					hitSlop={SPACE.sm}
				>
					<Text style={[styles.note, { color: c.text }]}>Cancel</Text>
				</Pressable>
			</View>
		);
	}
	const listening = input.phase === "listening";
	return (
		<View style={styles.row} testID="dictation-bar">
			<Pressable
				onPress={input.stop}
				disabled={!listening}
				accessibilityRole="button"
				accessibilityLabel="Stop dictation"
				accessibilityState={{ disabled: !listening, busy: !listening }}
				testID="dictation-stop"
				style={({ pressed }) => [
					styles.stop,
					{ backgroundColor: alpha(c.danger, pressed ? 0.2 : 0.1) },
				]}
			>
				{listening ? (
					<Icon name="mic.fill" size={14} color={c.danger} />
				) : (
					<Spinner color={c.danger} />
				)}
				<Text style={[styles.stopText, { color: c.danger }]}>Stop</Text>
			</Pressable>
			<View style={[styles.dot, { backgroundColor: c.danger, opacity: listening ? 1 : 0.4 }]} />
			<Meter level={input.level} />
		</View>
	);
}

/** The last run's problem, with Open Settings for a refused permission. */
export function DictationProblemLine({ input }: { input: DictationInput }) {
	const c = usePalette();
	if (!input.problem) return null;
	return (
		<View style={styles.problem} testID="dictation-problem">
			<View style={styles.grow}>
				<ErrorText>{input.problem.text}</ErrorText>
			</View>
			{input.problem.action === "settings" ? (
				<Pressable
					onPress={() => {
						input.clearProblem();
						void Linking.openSettings();
					}}
					accessibilityRole="link"
					testID="dictation-open-settings"
					hitSlop={SPACE.sm}
				>
					<Text style={[styles.note, styles.link, { color: c.text }]}>Open Settings</Text>
				</Pressable>
			) : null}
			<Pressable
				onPress={input.clearProblem}
				accessibilityRole="button"
				accessibilityLabel="Close the dictation message"
				testID="dictation-problem-close"
				hitSlop={SPACE.sm}
			>
				<Icon name="xmark" size={12} color={c.muted} />
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	mic: {
		borderWidth: 1,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
	},
	/** As high as the main buttons (44), so the dock does not move when a run starts. */
	row: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		minHeight: 44,
	},
	stop: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		paddingHorizontal: SPACE.sm,
		height: 32,
		borderRadius: 8,
	},
	stopText: { ...TYPE.sm, fontFamily: FONT.ui, fontWeight: "600" },
	dot: { width: 6, height: 6, borderRadius: 3 },
	meter: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		height: 16,
		minWidth: 0,
	},
	cell: { flex: 1, borderRadius: 1 },
	note: { ...TYPE.sm, fontFamily: FONT.prose, flexShrink: 1 },
	link: { textDecorationLine: "underline" },
	problem: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	grow: { flex: 1 },
});
