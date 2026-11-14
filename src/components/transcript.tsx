/**
 * The session transcript: learner text, teacher text, reasoning (closed by
 * default, tap to open), questions with their answers, and a short line for
 * other tools. Plain text for now; Markdown and math come in issue 05.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranscriptRow } from "@/lib/transcript";
import { usePalette } from "./ui";

function Reasoning({ row }: { row: Extract<TranscriptRow, { kind: "reasoning" }> }) {
	const c = usePalette();
	const [open, setOpen] = useState(false);
	return (
		<Pressable
			onPress={() => setOpen((o) => !o)}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			testID={`reasoning-${row.id}`}
		>
			<Text style={[styles.small, { color: c.muted }]}>
				{row.streaming ? "Thinking…" : open ? "Thinking (tap to close)" : "Thinking (tap to open)"}
			</Text>
			{open ? <Text style={[styles.small, { color: c.muted }]}>{row.text}</Text> : null}
		</Pressable>
	);
}

function Row({ row }: { row: TranscriptRow }) {
	const c = usePalette();
	switch (row.kind) {
		case "user":
			return (
				<View style={[styles.user, { backgroundColor: c.accent }]} testID={`user-${row.id}`}>
					<Text style={[styles.body, { color: c.onAccent }]}>{row.text}</Text>
				</View>
			);
		case "text":
			return (
				<Text style={[styles.body, { color: c.text }]} testID={`text-${row.id}`}>
					{row.text}
				</Text>
			);
		case "reasoning":
			return <Reasoning row={row} />;
		case "question":
			return (
				<View
					style={[styles.card, { borderColor: c.line, backgroundColor: c.panel }]}
					testID={`question-${row.id}`}
				>
					<Text style={[styles.body, { color: c.text, fontWeight: "600" }]}>{row.question}</Text>
					{row.malformed ? (
						<Text style={[styles.small, { color: c.danger }]}>
							This question is not complete, so the phone cannot show it.
						</Text>
					) : row.answer === null ? (
						<Text style={[styles.small, { color: c.muted }]}>Waiting for your answer.</Text>
					) : (
						<Text style={[styles.small, { color: c.muted }]}>
							Your answer: {row.answer}
							{row.confidence !== undefined ? ` (${row.confidence}% sure)` : ""}
							{row.grade === "correct"
								? ". Correct."
								: row.grade === "wrong"
									? ". Not correct."
									: ""}
						</Text>
					)}
				</View>
			);
		case "tool":
			return (
				<Text style={[styles.small, { color: row.failed ? c.danger : c.muted }]}>
					{row.failed ? `Tool failed: ${row.name}` : `Tool: ${row.name}`}
				</Text>
			);
	}
}

export function Transcript({ rows }: { rows: TranscriptRow[] }) {
	return (
		<View style={styles.list} testID="transcript">
			{rows.map((row) => (
				<Row key={`${row.kind}-${row.id}`} row={row} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	list: { gap: 12 },
	body: { fontSize: 16, lineHeight: 23 },
	small: { fontSize: 14, lineHeight: 20 },
	user: { alignSelf: "flex-end", maxWidth: "85%", borderRadius: 14, padding: 12 },
	card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 6 },
});
