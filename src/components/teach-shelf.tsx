/**
 * The Teach tab shelf (issue 20, slice B): the "Continue learning" card and
 * the sessions in the desktop folders, with the shared parts of
 * src/components/shelf.tsx. The order and the text come from
 * src/lib/teach-shelf.ts.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

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
	type ShelfSection,
} from "@/lib/teach-shelf";
import { ContinueCardFrame, ShelfSectionView } from "./shelf";

export interface TeachShelfData {
	/** The desktop folders; null before they load or when they fail. */
	directory: SourceDirectory | null;
	/** True when the last folder read failed (error state 1). */
	foldersFailed: boolean;
	/** Concepts by session; null before the graph loads or when it fails (error state 2). */
	concepts: Map<string, number> | null;
	refresh: () => void;
	/** Shows the folders that a folder change gave back, at once. */
	apply: (directory: SourceDirectory) => void;
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
	const apply = useCallback((d: SourceDirectory) => {
		setDirectory(d);
		setFoldersFailed(false);
	}, []);
	return { directory, foldersFailed, concepts, refresh, apply };
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

const TEACH_CARD_IDS = {
	card: "continue-card",
	badge: "continue-badge",
	line: "continue-line",
	button: "continue-session",
};

/** The "Continue learning" card: the newest teach session. */
export function ContinueCard({ chat }: { chat: ChatListItem }) {
	const steps = useContinueSteps(chat);
	return (
		<ContinueCardFrame
			heading="Continue learning"
			chat={chat}
			badge={continueBadge(chat)}
			line={continueLine(chat, steps)}
			ids={TEACH_CARD_IDS}
		/>
	);
}

/** One folder (or "Not in a folder"): the label and a rounded card of rows. */
export function ShelfGroup({
	section,
	concepts,
	onLongPressRow,
	onMenu,
}: {
	section: ShelfSection;
	concepts: Map<string, number> | null;
	onLongPressRow?: (chat: ChatListItem) => void;
	onMenu?: () => void;
}) {
	return (
		<ShelfSectionView
			label={section.label}
			testID={`folder-${section.folderId ?? "none"}`}
			sessions={section.sessions}
			empty={EMPTY_FOLDER}
			onLongPressRow={onLongPressRow}
			onMenu={onMenu}
			countOf={(chat) =>
				concepts
					? { text: conceptLabel(concepts.get(chat.id) ?? 0), testID: `concepts-${chat.id}` }
					: undefined
			}
		/>
	);
}
