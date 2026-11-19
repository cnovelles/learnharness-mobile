/**
 * The Graph tab data hook (issue 08 slice C): it loads the Mac's knowledge
 * when the tab gets focus and when the Mac reports a change, as the desktop
 * reads the graph again on `activity-changed`. A read that ends after a
 * newer read started is ignored, so an old graph never replaces a new one.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

import { useMacFetch } from "./connection-context";
import { describeKnowledgeError, loadKnowledge, type Knowledge } from "./knowledge";
import { useServerEvent } from "./server-events-context";
import type { UserMessage } from "./user-error";

export interface KnowledgeState {
	/** The last loaded knowledge; it stays when a later read fails (state 1). */
	knowledge: Knowledge | null;
	/** The message of the last failed read; null after a good read. */
	error: UserMessage | null;
	busy: boolean;
	refresh: () => void;
}

export function useKnowledge(enabled: boolean): KnowledgeState {
	const macFetch = useMacFetch();
	const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
	const [error, setError] = useState<UserMessage | null>(null);
	const [busy, setBusy] = useState(false);
	const latest = useRef(0);

	const refresh = useCallback(() => {
		if (!enabled) return;
		const read = ++latest.current;
		setBusy(true);
		loadKnowledge(macFetch)
			.then((next) => {
				if (read !== latest.current) return;
				setKnowledge(next);
				setError(null);
			})
			.catch((e: unknown) => {
				if (read === latest.current) setError(describeKnowledgeError(e));
			})
			.finally(() => {
				if (read === latest.current) setBusy(false);
			});
	}, [enabled, macFetch]);

	useFocusEffect(refresh);
	// The graph changes when a pipeline run ends; a rename changes the titles.
	useServerEvent("activity-changed", refresh);
	useServerEvent("chats-changed", refresh);
	return { knowledge, error, busy, refresh };
}
