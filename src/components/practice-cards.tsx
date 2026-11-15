/**
 * The practice rows in the transcript (issue 06), as the desktop cards
 * (fork components/practice-cards.tsx, chat.tsx):
 *
 * - ProblemCard: "PROBLEM" and the statement. The model solution never
 *   shows here.
 * - PracticeThinking: the learner's thinking, the rail of the thinking rows.
 * - ConcludeCard: "CONCLUDED" with the outcome chip, the verdict (muted),
 *   then "MODEL SOLUTION". "METADATA" opens the rows inside the card (user
 *   decision 2026-11-15). A dismissal shows one muted line.
 * - NextProblemLine: the centered "→ NEXT PROBLEM" line.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useOptionalMacFetch } from "@/lib/connection-context";
import {
	nodeNames,
	type ConcludeCardData,
	type OutcomeTone,
	type PracticeMetadata,
	type PracticeThinkingData,
	type ProblemCardData,
} from "@/lib/practice";
import { Markdown } from "./markdown";
import { FONT, Icon, LABEL, TYPE, alpha, usePalette } from "./ui";
import { SPACE } from "./spacing";

export function ProblemCard({ id, data }: { id: string; data: ProblemCardData }) {
	const c = usePalette();
	return (
		<View
			style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
			testID={`problem-${id}`}
		>
			<Text style={[LABEL, { color: c.muted }]}>PROBLEM</Text>
			{data.statement ? (
				<Markdown text={data.statement} style={[styles.body, { color: c.text }]} />
			) : (
				<Text style={[styles.note, { color: c.muted }]}>
					{data.streaming ? "The teacher writes the problem…" : "This problem has no text."}
				</Text>
			)}
		</View>
	);
}

export function PracticeThinking({ id, data }: { id: string; data: PracticeThinkingData }) {
	const c = usePalette();
	return (
		<View
			style={[styles.rail, { borderColor: alpha(c.muted, 0.3) }]}
			testID={`practice-thinking-${id}`}
		>
			<Text style={[LABEL, { color: c.muted }]}>YOUR THINKING</Text>
			{data.text ? <Text style={[styles.thought, { color: c.muted }]}>{data.text}</Text> : null}
			{data.images > 0 ? (
				<Text style={[styles.note, { color: c.muted }]}>
					{data.images === 1
						? "1 image. Open it on the Mac."
						: `${data.images} images. Open them on the Mac.`}
				</Text>
			) : null}
		</View>
	);
}

function toneColor(c: ReturnType<typeof usePalette>, tone: OutcomeTone) {
	return tone === "ok"
		? c.ok
		: tone === "warning"
			? c.warning
			: tone === "danger"
				? c.danger
				: c.muted;
}

export function ConcludeCard({ id, data }: { id: string; data: ConcludeCardData }) {
	const c = usePalette();
	if (data.dismissed)
		return (
			<Text style={[styles.note, { color: c.muted }]} testID={`conclude-${id}`}>
				Problem dismissed.
			</Text>
		);
	const color = data.outcome ? toneColor(c, data.outcome.tone) : c.muted;
	return (
		<View
			style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
			testID={`conclude-${id}`}
		>
			<View style={styles.head}>
				<Text style={[LABEL, { color: c.muted }]}>CONCLUDED</Text>
				{data.outcome ? (
					<Text
						style={[
							LABEL,
							styles.badge,
							{
								color,
								backgroundColor: data.outcome.tone === "muted" ? c.hover : alpha(color, 0.15),
							},
						]}
						testID={`outcome-${id}`}
					>
						{data.outcome.label.toUpperCase()}
					</Text>
				) : null}
			</View>
			{data.verdict ? (
				<Markdown
					text={data.verdict}
					compact
					style={[styles.small, { color: alpha(c.text, 0.5) }]}
				/>
			) : null}
			{data.reveal ? (
				<>
					<View style={[styles.rule, { borderColor: c.line }]} />
					<Text style={[LABEL, { color: c.muted }]}>MODEL SOLUTION</Text>
					<Markdown text={data.reveal} style={[styles.body, { color: c.text }]} />
				</>
			) : null}
			{data.metadata ? <Metadata id={id} data={data.metadata} /> : null}
		</View>
	);
}

/** The metadata rows: closed at first, a tap opens them inside the card. */
function Metadata({ id, data }: { id: string; data: PracticeMetadata }) {
	const c = usePalette();
	const macFetch = useOptionalMacFetch();
	const [open, setOpen] = useState(false);
	const [names, setNames] = useState<Record<string, string> | null>(null);
	useEffect(() => {
		if (!open || data.targets.length === 0 || names || !macFetch) return;
		let current = true;
		void nodeNames(macFetch).then((m) => current && setNames(m));
		return () => {
			current = false;
		};
	}, [open, data.targets.length, names, macFetch]);
	const rows: [string, string][] = [
		["Mode", data.mode || "—"],
		[
			"Targets",
			data.targets.length === 0 ? "untagged" : data.targets.map((t) => names?.[t] ?? t).join(", "),
		],
		["Outcome", data.outcome || "—"],
		["Hint rung", data.rung || "none"],
		["Miss class", data.missClass || "none"],
		["Retest", data.retest === undefined ? "—" : data.retest ? "yes" : "no"],
	];
	return (
		<View style={styles.meta}>
			<Pressable
				onPress={() => setOpen((o) => !o)}
				accessibilityRole="button"
				accessibilityLabel="Metadata"
				accessibilityState={{ expanded: open }}
				hitSlop={SPACE.sm}
				style={styles.metaToggle}
				testID={`metadata-${id}`}
			>
				<Text style={[LABEL, { color: c.muted }]}>METADATA</Text>
				<Icon name={open ? "chevron.up" : "chevron.down"} size={10} color={c.muted} />
			</Pressable>
			{open ? (
				<View style={styles.metaRows} testID={`metadata-rows-${id}`}>
					{rows.map(([label, value]) => (
						<View key={label} style={styles.metaRow}>
							<Text style={[styles.metaLabel, { color: c.muted }]}>{label}</Text>
							<Text style={[styles.metaValue, { color: c.text }]}>{value}</Text>
						</View>
					))}
				</View>
			) : null}
		</View>
	);
}

export function NextProblemLine({ id }: { id: string }) {
	const c = usePalette();
	return (
		<View style={styles.next} testID={`practice-next-${id}`}>
			<Icon name="arrow.right" size={10} color={c.muted} />
			<Text style={[LABEL, { color: c.muted }]}>NEXT PROBLEM</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	/** The transcript card (transcript.tsx): rounded-xl, the card padding. */
	card: { borderWidth: 1, borderRadius: 16, padding: SPACE.lg, gap: SPACE.sm },
	body: { ...TYPE.prose, fontFamily: FONT.prose },
	small: { ...TYPE.base, fontFamily: FONT.prose },
	note: { ...TYPE.sm, fontFamily: FONT.ui },
	thought: { fontSize: 15, lineHeight: 22, fontFamily: FONT.prose, fontStyle: "italic" },
	rail: { borderLeftWidth: 6, paddingLeft: SPACE.md, gap: SPACE.xs },
	head: { flexDirection: "row", gap: SPACE.sm, alignItems: "center" },
	badge: { borderRadius: 8, paddingHorizontal: SPACE.xs, overflow: "hidden" },
	rule: { borderTopWidth: 1, marginVertical: SPACE.xs },
	meta: { marginTop: SPACE.xs, gap: SPACE.sm },
	metaToggle: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		alignSelf: "flex-start",
	},
	metaRows: { gap: SPACE.xs },
	metaRow: { flexDirection: "row", gap: SPACE.lg },
	/** The label column has one width, so the values line up. */
	metaLabel: { ...TYPE.xs, fontFamily: FONT.ui, width: 80 },
	metaValue: { ...TYPE.xs, fontFamily: FONT.ui, flex: 1 },
	next: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: SPACE.xs,
		marginVertical: SPACE.sm,
	},
});
