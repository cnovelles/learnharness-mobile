/**
 * The probe assessment card (issue 05 slice D): the prober's `probe_done`
 * call. Layout A of the user decision (2026-11-15), as on the desktop: a
 * folded card "PROBE ASSESSMENT · N strands". A tap on the header opens one
 * block for each strand and the summary last. A long press on the header
 * copies the assessment as Markdown. The states with no strands show a
 * short note (error state 13). Data: src/lib/probe-card.ts.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PROBE_NOTE, probeMarkdown, type ProbeCardData } from "@/lib/probe-card";
import { CopyLabel, copyActions, useCopy } from "./copy";
import { Markdown } from "./markdown";
import { usePalette } from "./ui";
import { SPACE } from "./spacing";

const strandCount = (n: number) => `${n} strand${n === 1 ? "" : "s"}`;

export function ProbeCard({ id, data }: { id: string; data: ProbeCardData }) {
	const c = usePalette();
	const [open, setOpen] = useState(false);
	const { copy, state: copyState } = useCopy(() => probeMarkdown(data));
	const card = [styles.card, { borderColor: c.line, backgroundColor: c.panel }];

	if (data.state !== "ready")
		return (
			<View style={[card, styles.noteCard]} testID={`probe-${id}`}>
				<Text style={[styles.label, { color: c.muted }]}>PROBE ASSESSMENT</Text>
				<Text style={[styles.small, { color: c.muted }]} testID={`probe-note-${id}`}>
					{PROBE_NOTE[data.state]}
				</Text>
			</View>
		);

	const count = strandCount(data.strands.length);
	return (
		<View style={card} testID={`probe-${id}`}>
			<Pressable
				onPress={() => setOpen((o) => !o)}
				onLongPress={copy}
				accessibilityRole="button"
				accessibilityLabel={`Probe assessment, ${count}`}
				accessibilityState={{ expanded: open }}
				{...copyActions(copy, "assessment")}
				style={styles.head}
				testID={`probe-head-${id}`}
			>
				<Text style={[styles.label, styles.title, { color: c.muted }]}>PROBE ASSESSMENT</Text>
				<Text style={[styles.small, { color: c.muted }]}>{`${count} ${open ? "▾" : "▸"}`}</Text>
			</Pressable>
			{open ? (
				<View testID={`probe-body-${id}`}>
					{data.strands.map((s, i) => (
						<View
							key={i}
							style={[styles.block, { borderColor: c.line }]}
							testID={`probe-strand-${id}-${i}`}
						>
							<Markdown
								text={s.strand}
								compact
								style={[styles.small, { color: c.text, fontWeight: "600" }]}
							/>
							<Markdown text={s.assessment} compact style={[styles.small, { color: c.muted }]} />
						</View>
					))}
					{data.summary ? (
						<View style={[styles.block, { borderColor: c.line }]} testID={`probe-summary-${id}`}>
							<Markdown text={data.summary} compact style={[styles.small, { color: c.muted }]} />
						</View>
					) : null}
				</View>
			) : null}
			<CopyLabel state={copyState} c={c} />
		</View>
	);
}

const styles = StyleSheet.create({
	card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
	noteCard: { padding: SPACE.md, gap: SPACE.sm },
	head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.md },
	title: { flex: 1 },
	label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6 },
	small: { fontSize: 14, lineHeight: 20 },
	block: {
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
		gap: SPACE.xs,
	},
});
