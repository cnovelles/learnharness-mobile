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
import { alpha, FONT, Icon, LABEL, TYPE, usePalette } from "./ui";
import { SPACE } from "./spacing";

const strandCount = (n: number) => `${n} strand${n === 1 ? "" : "s"}`;

export function ProbeCard({ id, data }: { id: string; data: ProbeCardData }) {
	const c = usePalette();
	const [open, setOpen] = useState(false);
	const { copy, state: copyState } = useCopy(() => probeMarkdown(data));
	// The desktop card: rounded-xl border bg-card/60.
	const card = [styles.card, { borderColor: c.line, backgroundColor: alpha(c.panel, 0.6) }];

	if (data.state !== "ready")
		return (
			<View style={[card, styles.noteCard]} testID={`probe-${id}`}>
				<View style={styles.eyebrow}>
					<Icon name="checklist" size={14} color={c.text} />
					<Text style={[LABEL, { color: c.muted }]}>Probe assessment</Text>
				</View>
				<Text style={[styles.note, { color: c.muted }]} testID={`probe-note-${id}`}>
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
				style={({ pressed }) => [
					styles.head,
					open ? { borderBottomWidth: 1, borderColor: c.line } : null,
					pressed ? { backgroundColor: alpha(c.hover, 0.4) } : null,
				]}
				testID={`probe-head-${id}`}
			>
				<Icon name="checklist" size={14} color={c.text} />
				<Text style={[LABEL, styles.title, { color: c.muted }]} numberOfLines={1}>
					Probe assessment
				</Text>
				<Text style={[styles.count, { color: alpha(c.muted, 0.7) }]}>{count}</Text>
				<View style={[styles.chevron, open ? styles.chevronOpen : null]}>
					<Icon name="chevron.right" size={12} color={c.muted} />
				</View>
			</Pressable>
			{open ? (
				<View testID={`probe-body-${id}`}>
					{data.strands.map((s, i) => (
						<View
							key={i}
							style={[styles.block, i > 0 ? { borderTopWidth: 1, borderColor: c.line } : null]}
							testID={`probe-strand-${id}-${i}`}
						>
							<Markdown
								text={s.strand}
								compact
								style={[styles.prose, { color: c.text, fontWeight: "500" }]}
							/>
							<Markdown text={s.assessment} compact style={[styles.prose, { color: c.muted }]} />
						</View>
					))}
					{data.summary ? (
						<View
							style={[styles.block, { borderTopWidth: 1, borderColor: c.line }]}
							testID={`probe-summary-${id}`}
						>
							<Markdown text={data.summary} compact style={[styles.prose, { color: c.muted }]} />
						</View>
					) : null}
				</View>
			) : null}
			<CopyLabel state={copyState} c={c} />
		</View>
	);
}

/** The desktop's probe-done card (fork components/artifacts/probe-done-card.tsx). */
const styles = StyleSheet.create({
	card: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
	noteCard: { padding: SPACE.md, gap: SPACE.sm },
	eyebrow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.md },
	title: { flex: 1 },
	count: { ...TYPE.xs, fontFamily: FONT.ui },
	chevron: { opacity: 0.5 },
	chevronOpen: { transform: [{ rotate: "90deg" }] },
	note: { ...TYPE.sm, fontFamily: FONT.ui },
	prose: { ...TYPE.prose, fontFamily: FONT.prose },
	block: { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, gap: SPACE.xs },
});
