/**
 * The Mac's session list for the Teach and Practice tabs (issue 20). It
 * reads the list when the screen comes into view, on server events and on
 * pull to refresh. The tabs show it with the shelf parts of
 * src/components/shelf.tsx.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useMacFetch } from "@/lib/connection-context";
import { useServerEvent } from "@/lib/server-events-context";
import { listSessions, type SessionKind } from "@/lib/sessions";
import type { ChatListItem } from "@/lib/shared";
import { describeError, type UserMessage } from "@/lib/user-error";

export interface SessionListState {
	chats: ChatListItem[] | null;
	error: UserMessage | null;
	busy: boolean;
	refresh: () => void;
}

export function useSessionList(enabled: boolean): SessionListState {
	const macFetch = useMacFetch();
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const [error, setError] = useState<UserMessage | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(() => {
		if (!enabled) return;
		setBusy(true);
		listSessions(macFetch)
			.then((list) => {
				setChats(list);
				setError(null);
			})
			.catch((e: unknown) => setError(describeError(e)))
			.finally(() => setBusy(false));
	}, [enabled, macFetch]);

	useFocusEffect(refresh);
	// The list shows states and times: read it again when a session changes on the Mac.
	useServerEvent("chats-changed", refresh);
	useServerEvent("turn-started", refresh);
	useServerEvent("turn-settled", refresh);
	return { chats, error, busy, refresh };
}

/** A session's kind: the Mac leaves it out on older teach sessions. */
export function kindOf(chat: ChatListItem): SessionKind {
	return chat.kind === "practice" ? "practice" : "teach";
}
