/**
 * The session stats of the open session (issue 08 slice E). The record
 * parts (the usage log, the prices, the model setting) come from
 * `useSessionModel`; this hook adds the catalog limits (`GET /api/models`)
 * and the strong slot (`GET /api/settings`, for a session with no model
 * setting), once for each screen. A failed read gives state 9 (no limit).
 */
import { useEffect, useMemo, useState } from "react";

import type { SessionUsage } from "./sessions";
import {
	readModelLimits,
	readStrongModel,
	sessionModelId,
	sessionStats,
	type SessionStats,
} from "./session-stats";
import { cliContextWindowOf, type ChatSettings, type LhMessage } from "./shared";

export function useSessionStats(
	macFetch: typeof fetch,
	usage: SessionUsage,
	contextTokens: number | null,
	nativeMessages: readonly LhMessage[],
): SessionStats {
	const [limits, setLimits] = useState<ReadonlyMap<string, number>>();
	const [strong, setStrong] = useState<ChatSettings>();
	useEffect(() => {
		let live = true;
		void readModelLimits(macFetch).then((l) => live && setLimits(l));
		void readStrongModel(macFetch).then((s) => live && setStrong(s));
		return () => {
			live = false;
		};
	}, [macFetch]);
	const cliWindow = useMemo(() => cliContextWindowOf(nativeMessages), [nativeMessages]);
	return useMemo(
		() =>
			sessionStats({
				turns: usage.turns,
				pricing: usage.pricing,
				contextTokens,
				model: sessionModelId(usage.settings, strong),
				limits,
				cliWindow,
			}),
		[usage, contextTokens, strong, limits, cliWindow],
	);
}
