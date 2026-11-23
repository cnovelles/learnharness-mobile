/**
 * The session stats (issue 08 slice E, user choice 3A): one quiet line under
 * the composer, "36.9k / 128k · $0.0123", as the desktop stats bar. A tap
 * opens the "Session stats" sheet: the context, the total cost, the cache
 * hit rate, the unpriced turns, the error notes, and one row for each turn.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { openLink } from "@/lib/open-link";
import { CHATGPT_USAGE_URL, stepsLabel, type SessionStats } from "@/lib/session-stats";
import { BottomSheet } from "./bottom-sheet";
import { SPACE } from "./spacing";
import { FONT, LABEL, TYPE, usePalette } from "./ui";

export function SessionStatsLine({ stats }: { stats: SessionStats }) {
	const c = usePalette();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Pressable
				onPress={() => setOpen(true)}
				hitSlop={SPACE.sm}
				accessibilityRole="button"
				accessibilityLabel={`Session stats: context ${stats.context}, cost ${stats.cost}`}
				accessibilityHint="Opens the session stats"
				testID="session-stats"
				style={styles.line}
			>
				<Text style={[styles.lineText, { color: c.muted }]} numberOfLines={1}>
					<Text testID="session-stats-context">{stats.context}</Text>
					{" · "}
					<Text testID="session-stats-cost">{stats.cost}</Text>
				</Text>
			</Pressable>
			<SessionStatsSheet stats={stats} visible={open} onClose={() => setOpen(false)} />
		</>
	);
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
	const c = usePalette();
	return (
		<View style={styles.row} testID={testID}>
			<Text style={[styles.cell, styles.label, { color: c.muted }]}>{label}</Text>
			<Text style={[styles.cell, { color: c.text }]}>{value}</Text>
		</View>
	);
}

export function SessionStatsSheet({
	stats,
	visible,
	onClose,
}: {
	stats: SessionStats;
	visible: boolean;
	onClose: () => void;
}) {
	const c = usePalette();
	return (
		<BottomSheet
			visible={visible}
			onClose={onClose}
			testID="session-stats-sheet"
			title={
				<Text style={[LABEL, { color: c.muted }]} accessibilityRole="header">
					Session stats
				</Text>
			}
		>
			<View style={styles.group}>
				<Row label="Context (last call)" value={stats.context} testID="stats-sheet-context" />
				{stats.cliNote ? (
					<Text style={[styles.note, { color: c.muted }]}>
						Window reported by Claude Code; may be lower for auto-compaction.
					</Text>
				) : null}
				<Row label={stats.costTitle} value={stats.cost} testID="stats-sheet-cost" />
				{stats.cacheHitRate !== null ? (
					<Row label="Cache hit rate" value={stats.cacheHitRate} testID="stats-sheet-cache" />
				) : null}
				{stats.chatGptUsage ? (
					<Text
						style={[styles.note, styles.link, { color: c.accent }]}
						accessibilityRole="link"
						onPress={() => openLink(CHATGPT_USAGE_URL)}
					>
						Manage ChatGPT usage
					</Text>
				) : null}
				{stats.unpriced > 0 ? (
					<Row
						label="Unpriced turns"
						value={String(stats.unpriced)}
						testID="stats-sheet-unpriced"
					/>
				) : null}
				{stats.notes.map((note) => (
					<Text key={note} style={[styles.note, { color: c.muted }]} testID="stats-sheet-note">
						{note}
					</Text>
				))}
			</View>
			{stats.turns.length > 0 ? (
				<View style={[styles.turns, { borderTopColor: c.line }]}>
					<Text style={[LABEL, { color: c.muted }]}>Turns</Text>
					{stats.turns.map((t, i) => (
						<View key={t.key} style={styles.row} testID={`stats-turn-${i + 1}`}>
							<Text style={[styles.cell, styles.turnLabel, { color: c.muted }]} numberOfLines={1}>
								{t.label}
							</Text>
							<Text style={[styles.cell, { color: c.muted }]}>{stepsLabel(t.steps)}</Text>
							<Text style={[styles.cell, { color: c.text }]}>{t.cost}</Text>
						</View>
					))}
				</View>
			) : null}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	line: { alignSelf: "flex-start" },
	lineText: { fontFamily: FONT.ui, ...TYPE.xs, fontVariant: ["tabular-nums"] },
	group: { gap: SPACE.xs },
	row: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm },
	cell: { fontFamily: FONT.ui, ...TYPE.xs, fontVariant: ["tabular-nums"] },
	label: { flex: 1 },
	turnLabel: { flex: 1 },
	note: { fontFamily: FONT.prose, ...TYPE.sm },
	link: { textDecorationLine: "underline" },
	turns: {
		gap: SPACE.xs,
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingTop: SPACE.sm,
	},
});
