/**
 * The answered card's confidence rail (issue 18), as the desktop's
 * (fork components/confidence-rail.tsx, answered-card.tsx): a thin rail
 * filled up to the value in the color of its stop, ticks at the stops on
 * the empty side, and the value as a number. No thumb on the answered card.
 */
import { StyleSheet, Text, View } from "react-native";

import { SPACE } from "./spacing";
import { FONT, TYPE, alpha, usePalette } from "./ui";

/** The desktop's stops and colors (fork src/core/question-core.ts). */
export const CONFIDENCE_STOPS = [0, 30, 50, 70, 90, 100] as const;
export const CONFIDENCE_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#84cc16",
	"#22c55e",
	"#10b981",
] as const;

/** The color of the highest stop at or under the value. */
export function confidenceColor(value: number): string {
	let i = 0;
	CONFIDENCE_STOPS.forEach((stop, k) => {
		if (value >= stop) i = k;
	});
	return CONFIDENCE_COLORS[i];
}

export function ConfidenceRail({ value, testID }: { value: number; testID?: string }) {
	const c = usePalette();
	const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
	return (
		<View
			style={styles.row}
			testID={testID}
			accessible
			accessibilityLabel={`${Math.round(v)}% sure`}
		>
			<View style={[styles.rail, { borderColor: c.line, backgroundColor: c.bg }]}>
				<View
					style={[styles.fill, { width: `${v}%`, backgroundColor: confidenceColor(v) }]}
					testID={testID ? `${testID}-fill` : undefined}
				/>
				{CONFIDENCE_STOPS.slice(1, -1)
					.filter((stop) => stop > v)
					.map((stop) => (
						<View
							key={stop}
							style={[styles.tick, { left: `${stop}%`, backgroundColor: alpha(c.text, 0.35) }]}
						/>
					))}
			</View>
			<Text style={[styles.value, { color: c.text }]}>{Math.round(v)}%</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	row: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
	rail: {
		flex: 1,
		height: 6,
		borderRadius: 3,
		borderWidth: 1,
		overflow: "hidden",
		justifyContent: "center",
	},
	fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
	tick: { position: "absolute", top: 0, bottom: 0, width: 1 },
	value: { ...TYPE.sm, fontFamily: FONT.ui, width: 40, textAlign: "right" },
});
