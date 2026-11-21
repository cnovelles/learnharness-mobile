/**
 * "Developer: performance" in Settings (issue 21 slice A, the mockup of
 * 2026-11-18): the summary of the opens of one build, the five phases of
 * the last open, the list of opens, "Share results" and "Clear". It shows
 * where the developer section shows. The numbers stay on this phone until
 * the user shares them.
 */
import { useState, useSyncExternalStore } from "react";
import { Alert, Share, StyleSheet, Text, View } from "react-native";

import { perf, perfFile } from "@/lib/perf";
import {
	PHASES,
	formatMs,
	phaseTimes,
	summarize,
	type BuildInfo,
	type OpenRecord,
	type PhaseId,
} from "@/lib/perf-marks";
import { userMessage } from "@/lib/user-error";
import { SPACE } from "./spacing";
import { Body, Button, ErrorText, FONT, LABEL, Section, TYPE, alpha, usePalette } from "./ui";

const SHARE_FAILED = userMessage("The phone could not share the timings. Try again.");

/** The rows that show before "Show all". */
const SHORT_LIST = 10;

const sameBuild = (a: BuildInfo, b: BuildInfo) =>
	a.type === b.type && a.commit === b.commit && a.device === b.device;

/** "Release · 8375aa0 · iPhone 13 Pro Max". */
export function buildLine(b: BuildInfo): string {
	return `${b.type === "release" ? "Release" : "Dev"} · ${b.commit} · ${b.device}`;
}

/** The right text of an open row: "4.78 s · 29 islands", or why it has no total. */
export function openLine(o: OpenRecord): string {
	const islands = `${o.islands} ${o.islands === 1 ? "island" : "islands"}`;
	if (o.outcome === "end") return `${formatMs(o.marks.atEnd ?? null)} · ${islands}`;
	return `${o.outcome === "left" ? "closed early" : "no end"} · ${islands}`;
}

function usePhaseColors(): Record<PhaseId, string> {
	const c = usePalette();
	return {
		fetch: c.muted,
		parse: alpha(c.muted, 0.5),
		draw: c.accent,
		reveal: alpha(c.accent, 0.55),
		end: c.line,
	};
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
	const c = usePalette();
	return (
		<View style={styles.stat}>
			<Text style={[styles.small, { color: c.muted }]}>{label}</Text>
			<Text style={[styles.statValue, { color: c.text }]} testID={testID}>
				{value}
			</Text>
		</View>
	);
}

function Line({ left, right, testID }: { left: React.ReactNode; right: string; testID?: string }) {
	const c = usePalette();
	return (
		<View style={styles.line}>
			<Text style={[styles.mono, { color: c.text }]}>{left}</Text>
			<Text style={[styles.mono, { color: c.text }]} testID={testID}>
				{right}
			</Text>
		</View>
	);
}

function LastOpen({ open }: { open: OpenRecord }) {
	const c = usePalette();
	const colors = usePhaseColors();
	const times = phaseTimes(open);
	const sum = PHASES.reduce((n, p) => n + (times[p.id] ?? 0), 0);
	return (
		<View style={styles.group}>
			<Text style={[LABEL, styles.label, { color: c.muted }]} numberOfLines={1}>
				Last open · {open.title || open.chatId} ({open.messages} messages)
			</Text>
			<View style={[styles.card, styles.pad, { backgroundColor: c.panel, borderColor: c.line }]}>
				{sum > 0 ? (
					<View style={styles.bar}>
						{PHASES.map((p) =>
							times[p.id] ? (
								<View
									key={p.id}
									style={{ flex: times[p.id]!, backgroundColor: colors[p.id] }}
									testID={`perf-bar-${p.id}`}
								/>
							) : null,
						)}
					</View>
				) : null}
				{PHASES.map((p) => (
					<Line
						key={p.id}
						left={
							<>
								<Text style={{ color: colors[p.id] }}>■ </Text>
								{p.label}
							</>
						}
						right={formatMs(times[p.id])}
						testID={`perf-phase-${p.id}`}
					/>
				))}
				<View style={[styles.rule, { borderTopColor: c.line }]} />
				<Line
					left="Longest frozen frame"
					right={formatMs(open.longestFrameMs)}
					testID="perf-frozen"
				/>
				<Line left="Islands started" right={String(open.islands)} testID="perf-islands" />
				{open.outcome === "end" ? null : (
					<Text style={[styles.small, { color: c.muted }]}>
						{open.outcome === "left"
							? "The session closed before it reached the end."
							: "The open did not reach the end in 60 s."}
					</Text>
				)}
			</View>
		</View>
	);
}

export function PerfSection() {
	const c = usePalette();
	const opens = useSyncExternalStore(perf.subscribe, perf.opens);
	const live = useSyncExternalStore(perf.subscribe, perf.liveIslands);
	const [all, setAll] = useState(false);
	const [shareError, setShareError] = useState(false);
	const last = opens.at(-1);
	const sameAsLast = last ? opens.filter((o) => sameBuild(o.build, last.build)) : [];
	const summary = summarize(sameAsLast);
	const newestFirst = [...opens].reverse();
	const shown = all ? newestFirst : newestFirst.slice(0, SHORT_LIST);

	async function share() {
		setShareError(false);
		try {
			await Share.share({ url: perfFile().uri });
		} catch {
			setShareError(true);
		}
	}

	function confirmClear() {
		Alert.alert("Clear the timings?", "This deletes the timings of all opens on this phone.", [
			{ text: "Cancel", style: "cancel" },
			{ text: "Clear", style: "destructive", onPress: () => perf.clear() },
		]);
	}

	return (
		<Section
			title="Developer: performance"
			hint="Timings of each session open on this phone. They stay on this phone until you share them."
		>
			<View style={[styles.card, styles.pad, { backgroundColor: c.panel, borderColor: c.line }]}>
				{last ? (
					<Text style={[styles.mono, { color: c.muted }]} testID="perf-build">
						{buildLine(last.build)}
					</Text>
				) : (
					<Body testID="perf-empty">Open a session to record its timings.</Body>
				)}
				<View style={styles.stats}>
					<Stat label="Opens" value={String(sameAsLast.length)} testID="perf-opens" />
					<Stat label="Median" value={formatMs(summary.medianMs)} testID="perf-median" />
					<Stat label="p95" value={formatMs(summary.p95Ms)} testID="perf-p95" />
				</View>
				<View style={[styles.rule, { borderTopColor: c.line }]} />
				<View style={styles.line}>
					<Text style={[styles.prose, { color: c.text }]}>Island WebViews mounted now</Text>
					<Text style={[styles.mono, { color: live > 0 ? c.danger : c.text }]} testID="perf-live">
						{live}
					</Text>
				</View>
			</View>
			{last ? <LastOpen open={last} /> : null}
			{opens.length > 0 ? (
				<View style={styles.group}>
					<Text style={[LABEL, styles.label, { color: c.muted }]}>
						All opens (last {opens.length})
					</Text>
					<View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
						{shown.map((o, i) => (
							<View
								key={`${o.at}-${i}`}
								style={[
									styles.row,
									i === 0
										? null
										: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
								]}
							>
								<Text style={[styles.prose, styles.rowTitle, { color: c.text }]} numberOfLines={1}>
									{o.title || o.chatId}
								</Text>
								<Text style={[styles.mono, { color: c.muted }]}>{openLine(o)}</Text>
							</View>
						))}
					</View>
					{opens.length > SHORT_LIST ? (
						<Button
							title={all ? "Show fewer" : `Show all ${opens.length}`}
							kind="plain"
							size="sm"
							onPress={() => setAll(!all)}
							testID="perf-show-all"
						/>
					) : null}
				</View>
			) : null}
			{shareError ? <ErrorText testID="perf-share-error">{SHARE_FAILED}</ErrorText> : null}
			{opens.length > 0 ? (
				<View style={styles.buttons}>
					<Button
						title="Share results"
						kind="plain"
						onPress={() => void share()}
						testID="perf-share"
					/>
					<Button title="Clear" kind="plain" onPress={confirmClear} testID="perf-clear" />
				</View>
			) : null}
		</Section>
	);
}

const styles = StyleSheet.create({
	group: { gap: SPACE.xs },
	label: { paddingHorizontal: SPACE.xs },
	card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
	pad: { padding: SPACE.md, gap: SPACE.xs },
	stats: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.xs },
	stat: { flex: 1 },
	statValue: { fontFamily: FONT.prose, fontSize: 20, lineHeight: 26, fontWeight: "600" },
	small: { ...TYPE.xs, fontFamily: FONT.prose },
	mono: { ...TYPE.xs, fontFamily: FONT.ui },
	prose: { ...TYPE.sm, fontFamily: FONT.prose },
	line: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.sm },
	rule: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: SPACE.xs },
	bar: {
		flexDirection: "row",
		height: 14,
		borderRadius: 4,
		overflow: "hidden",
		marginBottom: SPACE.xs,
	},
	row: {
		minHeight: 44,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
	},
	rowTitle: { flex: 1 },
	buttons: { flexDirection: "row", gap: SPACE.sm },
});
