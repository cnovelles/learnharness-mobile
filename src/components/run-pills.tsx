/**
 * The run pills of the Graph tab (issue 08 slice F): one pill for each
 * pipeline run in progress, as the desktop pills under the cost number. A
 * pill shows the spinner, the phase, the title and the seconds since the
 * start. The seconds count up once a second while a pill shows. The Mac
 * sends `activity-changed` when a phase changes, and the Graph tab reads
 * the status again then.
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { PipelineRun } from "@/lib/graph-api";
import { runPills } from "@/lib/pipeline-cost";
import { SPACE } from "./spacing";
import { FONT, Spinner, TYPE, usePalette } from "./ui";

export function RunPills({ runs }: { runs: PipelineRun[] | null }) {
	const c = usePalette();
	const [now, setNow] = useState(() => Date.now());
	const live = (runs?.length ?? 0) > 0;
	useEffect(() => {
		if (!live) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [live]);
	// A run never shows a time before its own start (a stale clock after a
	// long time with no pills): the first tick comes within one second.
	const pills = runPills(runs, Math.max(now, ...(runs ?? []).map((r) => r.startedAt)));
	if (pills.length === 0) return null;
	return (
		<View style={styles.list}>
			{pills.map((pill) => (
				<View
					key={pill.id}
					style={[styles.pill, { backgroundColor: c.panel, borderColor: c.line }]}
					accessible
					accessibilityLabel={pill.label}
					testID={`run-pill-${pill.id}`}
				>
					<Spinner color={c.muted} />
					<Text style={[styles.text, { color: c.muted }]}>{pill.phase}</Text>
					<Text style={[styles.text, styles.title, { color: c.text }]} numberOfLines={1}>
						{pill.title}
					</Text>
					<Text style={[styles.text, styles.seconds, { color: c.muted }]}>{pill.seconds}</Text>
				</View>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	list: { alignItems: "flex-end", gap: SPACE.xs },
	pill: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		maxWidth: "100%",
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 999,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.xs,
	},
	text: { ...TYPE.xs, fontFamily: FONT.ui },
	title: { flexShrink: 1 },
	seconds: { fontVariant: ["tabular-nums"] },
});
