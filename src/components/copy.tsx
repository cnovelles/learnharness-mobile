/**
 * Copy for a block (issue 05, decision 4 and error state 17): a long press
 * copies the block's source, and a short label shows "Copied" or "Could not
 * copy." Used by the Markdown blocks and by the math and Mermaid islands.
 */
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Palette } from "./ui";

/** How long the "Copied" or "Could not copy." label stays. */
export const COPY_LABEL_MS = 1500;

export type CopyState = "idle" | "copied" | "failed";

/** Writes the text to the clipboard. False when the write fails. */
async function copyToClipboard(text: string): Promise<boolean> {
	try {
		const ok = await Clipboard.setStringAsync(text);
		return ok !== false;
	} catch {
		return false;
	}
}

/** VoiceOver gets the long press of a block as a "Copy" action. */
export function copyActions(onCopy: () => void, what: string) {
	return {
		accessibilityHint: `Long press to copy the ${what}.`,
		accessibilityActions: [{ name: "longpress", label: "Copy" }],
		onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
			if (e.nativeEvent.actionName === "longpress") onCopy();
		},
	};
}

/**
 * The long press target of a block. It goes inside the block's sideways
 * scroll: a press target around a scroll view stops the scroll on iOS
 * (found on the Simulator, 2026-11-15).
 */
export function CopyTarget({
	onCopy,
	what,
	children,
}: {
	onCopy: () => void;
	what: string;
	children: ReactNode;
}) {
	return (
		<Pressable onLongPress={onCopy} {...copyActions(onCopy, what)} testID="md-copy">
			{children}
		</Pressable>
	);
}

/** The "Copied" or "Could not copy." label, on top of the block. */
export function CopyLabel({ state, c }: { state: CopyState; c: Palette }) {
	if (state === "idle") return null;
	return (
		<View
			pointerEvents="none"
			style={[styles.label, { backgroundColor: c.panel, borderColor: c.line }]}
		>
			<Text
				style={{ fontSize: 12, color: state === "copied" ? c.text : c.danger }}
				accessibilityLiveRegion="polite"
				testID="md-copy-label"
			>
				{state === "copied" ? "Copied" : "Could not copy."}
			</Text>
		</View>
	);
}

/** Copy for one block: `source` gives the text at the time of the press. */
export function useCopy(source: () => string): { copy: () => void; state: CopyState } {
	const [state, setState] = useState<CopyState>("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, []);
	const copy = () => {
		void copyToClipboard(source()).then((ok) => {
			if (!mounted.current) return;
			setState(ok ? "copied" : "failed");
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				if (mounted.current) setState("idle");
			}, COPY_LABEL_MS);
		});
	};
	return { copy, state };
}

const styles = StyleSheet.create({
	label: {
		position: "absolute",
		top: 6,
		right: 6,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 6,
		paddingHorizontal: 8,
		paddingVertical: 3,
	},
});
