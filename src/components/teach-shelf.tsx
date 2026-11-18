/**
 * The Teach tab shelf (issue 20, slice B): the "Continue learning" card and
 * the sessions in the desktop folders, in the inset grouped style (user
 * decision 2026-11-17): a section label over a rounded card of rows, the
 * count and a chevron on the right. The order and the text come from
 * src/lib/teach-shelf.ts.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { readPropositions, readSourceDirectory } from "@/lib/graph-api";
import { useMacFetch } from "@/lib/connection-context";
import { latestPlanTree, planSteps, type PlanStep } from "@/lib/plan";
import { useServerEvent } from "@/lib/server-events-context";
import { readSession } from "@/lib/sessions";
import { projectView, type ChatListItem, type SourceDirectory } from "@/lib/shared";
import {
	EMPTY_FOLDER,
	conceptLabel,
	conceptsBySession,
	continueBadge,
	continueLine,
	rowNote,
	type ShelfSection,
} from "@/lib/teach-shelf";
import { SPACE } from "./spacing";
import { Button, FONT, Icon, LABEL, Spinner, TYPE, usePalette } from "./ui";

export interface TeachShelfData {
	/** The desktop folders; null before they load or when they fail. */
	directory: SourceDirectory | null;
	/** True when the last folder read failed (error state 1). */
	foldersFailed: boolean;
	/** Concepts by session; null before the graph loads or when it fails (error state 2). */
	concepts: Map<string, number> | null;
	refresh: () => void;
}

/**
 * The folders and the concepts. Read on focus, on pull to refresh, on
 * `sources-changed` (folders) and on `activity-changed` (the graph grows
 * after a run). A failed read keeps the last good value.
 */
export function useTeachShelf(enabled: boolean): TeachShelfData {
	const macFetch = useMacFetch();
	const [directory, setDirectory] = useState<SourceDirectory | null>(null);
	const [foldersFailed, setFoldersFailed] = useState(false);
	const [concepts, setConcepts] = useState<Map<string, number> | null>(null);
	const graphBusy = useRef(false);

	const readFolders = useCallback(() => {
		if (!enabled) return;
		readSourceDirectory(macFetch)
			.then((d) => {
				setDirectory(d);
				setFoldersFailed(false);
			})
			.catch(() => setFoldersFailed(true));
	}, [enabled, macFetch]);

	const readConcepts = useCallback(() => {
		// The graph can be large: one read at a time.
		if (!enabled || graphBusy.current) return;
		graphBusy.current = true;
		readPropositions(macFetch)
			.then((p) => setConcepts(conceptsBySession(p)))
			.catch(() => {
				/* error state 2: keep the last counts, or show none */
			})
			.finally(() => {
				graphBusy.current = false;
			});
	}, [enabled, macFetch]);

	const refresh = useCallback(() => {
		readFolders();
		readConcepts();
	}, [readFolders, readConcepts]);

	useFocusEffect(refresh);
	useServerEvent("sources-changed", readFolders);
	useServerEvent("activity-changed", readConcepts);
	return { directory, foldersFailed, concepts, refresh };
}

/** The plan steps of the continue card's session, read again when it changes. */
function useContinueSteps(chat: ChatListItem): PlanStep[] | null {
	const macFetch = useMacFetch();
	const [steps, setSteps] = useState<{ key: string; steps: PlanStep[] | null } | null>(null);
	const key = `${chat.id}@${chat.updatedAt}`;
	useEffect(() => {
		let live = true;
		readSession(macFetch, chat.id)
			.then((record) => {
				const tree = latestPlanTree(projectView(record.messages));
				if (live) setSteps({ key, steps: tree ? planSteps(tree, record.messages) : null });
			})
			.catch(() => {
				/* the card shows the phase without the step */
			});
		return () => {
			live = false;
		};
	}, [macFetch, chat.id, key]);
	// The last steps stay until the new ones come, so the line does not jump.
	return steps?.steps ?? null;
}

function openSession(id: string) {
	router.push({ pathname: "/session/[id]", params: { id } });
}

/** The "Continue learning" card: the newest teach session. */
export function ContinueCard({ chat }: { chat: ChatListItem }) {
	const c = usePalette();
	const steps = useContinueSteps(chat);
	return (
		<View style={styles.group}>
			<Text style={[LABEL, styles.label, { color: c.muted }]} accessibilityRole="header">
				Continue learning
			</Text>
			<View
				testID="continue-card"
				style={[styles.card, styles.continue, { backgroundColor: c.panel, borderColor: c.line }]}
			>
				<View style={styles.continueTop}>
					<Text style={[styles.continueTitle, { color: c.text }]} numberOfLines={2}>
						{chat.title}
					</Text>
					<View style={[styles.badge, { borderColor: c.line }]}>
						{chat.busy ? <Spinner size={10} /> : null}
						<Text style={[styles.badgeText, { color: c.text }]} testID="continue-badge">
							{continueBadge(chat)}
						</Text>
					</View>
				</View>
				<Text style={[LABEL, { color: c.muted }]} testID="continue-line">
					{continueLine(chat, steps)}
				</Text>
				<Button title="Continue" testID="continue-session" onPress={() => openSession(chat.id)} />
			</View>
		</View>
	);
}

function Row({ chat, count, first }: { chat: ChatListItem; count?: number; first: boolean }) {
	const c = usePalette();
	const note = rowNote(chat);
	return (
		// Not `Link asChild`: it drops a style function, and the pressed fill needs one.
		<Pressable
			testID={`session-${chat.id}`}
			accessibilityRole="button"
			onPress={() => openSession(chat.id)}
			style={({ pressed }) => [
				styles.row,
				first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
				pressed ? { backgroundColor: c.hover } : null,
			]}
		>
			<View style={styles.rowText}>
				<Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
					{chat.title}
				</Text>
				{note ? (
					<View style={styles.note}>
						{chat.busy ? <Spinner size={10} /> : null}
						<Text style={[styles.noteText, { color: c.accent }]}>{note}</Text>
					</View>
				) : null}
			</View>
			{count === undefined ? null : (
				<Text style={[styles.count, { color: c.muted }]} testID={`concepts-${chat.id}`}>
					{conceptLabel(count)}
				</Text>
			)}
			<Icon name="chevron.right" size={12} color={c.muted} />
		</Pressable>
	);
}

/** One folder (or "Not in a folder"): the label and a rounded card of rows. */
export function ShelfGroup({
	section,
	concepts,
}: {
	section: ShelfSection;
	concepts: Map<string, number> | null;
}) {
	const c = usePalette();
	return (
		<View style={styles.group} testID={`folder-${section.folderId ?? "none"}`}>
			<Text style={[LABEL, styles.label, { color: c.muted }]} accessibilityRole="header">
				{section.label}
			</Text>
			<View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
				{section.sessions.length === 0 ? (
					<Text style={[styles.empty, { color: c.muted }]}>{EMPTY_FOLDER}</Text>
				) : (
					section.sessions.map((chat, i) => (
						<Row
							key={chat.id}
							chat={chat}
							first={i === 0}
							count={concepts ? (concepts.get(chat.id) ?? 0) : undefined}
						/>
					))
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	group: { gap: SPACE.xs },
	label: { paddingHorizontal: SPACE.xs },
	/** The inset grouped card: `panel`, a `line` border, radius 14. */
	card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
	continue: { padding: SPACE.md, gap: SPACE.sm },
	continueTop: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm },
	continueTitle: { ...TYPE.lg, fontFamily: FONT.title, fontWeight: "700", flex: 1 },
	badge: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 10,
		paddingHorizontal: SPACE.sm,
		minHeight: 20,
	},
	badgeText: { ...TYPE.xs, fontFamily: FONT.ui },
	row: {
		minHeight: 44,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		paddingHorizontal: SPACE.md,
		paddingVertical: SPACE.sm,
	},
	rowText: { flex: 1, gap: SPACE.xs },
	title: { fontFamily: FONT.prose, fontSize: 15, lineHeight: 20 },
	note: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
	noteText: { ...TYPE.xs, fontFamily: FONT.ui },
	count: { ...TYPE.sm, fontFamily: FONT.prose },
	empty: { ...TYPE.sm, fontFamily: FONT.prose, padding: SPACE.md },
});
