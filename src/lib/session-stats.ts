/**
 * The session stats (issue 08 slice E, user choice 3A): one line under the
 * composer ("38k / 200k · $0.0123") and the "Session stats" sheet. The model
 * follows the desktop stats bar (fork `components/stats-bar.tsx`) and uses
 * the desktop format helpers, so the phone shows the same strings.
 *
 * The phone never computes dollars: the Mac prices each turn with its model
 * catalog and sends `pricing` in `GET /api/chats/:id`. The context is the
 * shared `measuredContextTokens` (in `SessionModel`). The limit comes from
 * `GET /api/models` for the session's model, or from the Claude Code report.
 *
 * Error states (issue 08):
 * - 8: no turn has a price. The cost is "—", never "$0.0000".
 * - 9: the limit is not known. The line shows only the tokens ("38k").
 * - 10: no measured context (no reply yet, or a compaction last): "?".
 */
import {
	catalogLimits,
	sessionStatsSummary,
	type ChatSettings,
	type SessionPricing,
	type SessionStatsInput,
	type TurnUsage,
} from "./shared";
import { userMessage, type UserMessage } from "./user-error";

/** The fork's input: the usage log, the pricing, the context, the model and the limits. */
export type StatsInput = SessionStatsInput;
export interface StatsTurnRow {
	key: string;
	/** "#3 · deepseek-v4.1-flash · openrouter" */
	label: string;
	steps: number;
	/** "$0.0011", "—" (no price), "CLI", or a plan name ("ChatGPT"). */
	cost: string;
}

export interface SessionStats {
	/** "36.9k / 128k", "36.9k" (state 9), "?" or "? / 128k" (state 10). */
	context: string;
	/** "$0.0123", "—" (state 8), or with plan names ("$0.0123 + ChatGPT"). */
	cost: string;
	/** "Usage" when a plan pays for a turn, else "Total cost" (as the desktop). */
	costTitle: "Total cost" | "Usage";
	/** "81.9%", or null when no turn read the cache. */
	cacheHitRate: string | null;
	unpriced: number;
	/** The Claude Code note: its window can be lower for auto-compaction. */
	cliNote: boolean;
	/** A ChatGPT plan pays for a turn: the sheet links to its usage page. */
	chatGptUsage: boolean;
	/** The error notes for the sheet, in the order 8, 9, 10. */
	notes: UserMessage[];
	turns: StatsTurnRow[];
}

export const NO_PRICE = userMessage("The Mac has no price for these turns.");
export const NO_LIMIT = userMessage("The Mac does not know the context limit of this model.");
export const NO_CONTEXT = userMessage(
	"No measured context yet. It shows again after the next reply.",
);
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * The fork's summary (`sessionStatsSummary`, the same strings as the desktop
 * stats bar) with the phone parts: the error notes, the row keys, the rate
 * as a percent string, and the ChatGPT usage link.
 */
export function sessionStats(input: StatsInput): SessionStats {
	const summary = sessionStatsSummary(input);
	const notes: UserMessage[] = [];
	if (summary.cost === "—" && input.turns.length > 0) notes.push(NO_PRICE);
	if (summary.limit === null) notes.push(NO_LIMIT);
	if (input.contextTokens === null) notes.push(NO_CONTEXT);
	return {
		context: summary.context,
		cost: summary.cost,
		costTitle: summary.costTitle,
		cacheHitRate:
			summary.cacheHitRate === null ? null : `${(summary.cacheHitRate * 100).toFixed(1)}%`,
		unpriced: summary.unpriced,
		cliNote: summary.cliModel,
		chatGptUsage: summary.providers.includes("ChatGPT"),
		notes,
		turns: summary.turns.map((row, i) => ({ ...row, key: `${input.turns[i]!.messageId}-${i}` })),
	};
}

/** "3 steps", "1 step". */
export function stepsLabel(steps: number): string {
	return steps === 1 ? "1 step" : `${steps} steps`;
}

/** The session's model as the desktop resolves it: its own setting, else the strong slot. */
export function sessionModelId(
	settings: ChatSettings | undefined,
	strong: ChatSettings | undefined,
): string | undefined {
	const m = settings?.model ?? strong?.model;
	return m && m.provider && m.id ? `${m.provider}:${m.id}` : undefined;
}

const isModelRef = (v: unknown): v is { provider: string; id: string } =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as { provider?: unknown }).provider === "string" &&
	typeof (v as { id?: unknown }).id === "string";

/** The `settings` of a record body, checked. Unknown shapes are undefined. */
export function chatSettingsOf(value: unknown): ChatSettings | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const model = (value as { model?: unknown }).model;
	return isModelRef(model) ? { model: { provider: model.provider, id: model.id } } : {};
}

/** The usage log of a record body. A malformed entry drops the whole log. */
export function turnsOf(value: unknown): TurnUsage[] {
	if (!Array.isArray(value)) return [];
	const ok = value.every(
		(t) =>
			typeof t === "object" &&
			t !== null &&
			typeof (t as TurnUsage).id === "string" &&
			typeof (t as TurnUsage).messageId === "string" &&
			typeof (t as TurnUsage).model === "string" &&
			Array.isArray((t as TurnUsage).steps),
	);
	return ok ? (value as TurnUsage[]) : [];
}

/** The `pricing` of a record body, checked. Unknown shapes are undefined (all unpriced). */
export function pricingOf(value: unknown): SessionPricing | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const p = value as Partial<SessionPricing>;
	const count = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
	if (!count(p.cost) || !count(p.unpriced)) return undefined;
	if (typeof p.turnCosts !== "object" || p.turnCosts === null) return undefined;
	if (p.subscription !== undefined && !count(p.subscription)) return undefined;
	return value as SessionPricing;
}

/** The catalog limits from `GET /api/models`, or undefined (state 9). */
export async function readModelLimits(
	fetchImpl: typeof fetch,
): Promise<ReadonlyMap<string, number> | undefined> {
	try {
		const res = await fetchImpl("/api/models");
		if (!res.ok) return undefined;
		const body = (await res.json()) as { models?: unknown };
		if (!Array.isArray(body.models)) return undefined;
		type CatalogEntry = { provider: string; id: string; contextWindow: number | null };
		const isEntry = (m: unknown): m is CatalogEntry => {
			if (!isModelRef(m)) return false;
			const w = (m as { contextWindow?: unknown }).contextWindow;
			return w === null || (typeof w === "number" && Number.isSafeInteger(w) && w > 0);
		};
		const models = body.models.filter(isEntry);
		// catalogLimits reads only provider, id and contextWindow.
		return catalogLimits({ models: models as Parameters<typeof catalogLimits>[0]["models"] });
	} catch {
		return undefined;
	}
}

/** The strong slot from `GET /api/settings`, or undefined. */
export async function readStrongModel(fetchImpl: typeof fetch): Promise<ChatSettings | undefined> {
	try {
		const res = await fetchImpl("/api/settings");
		if (!res.ok) return undefined;
		const body = (await res.json()) as { settings?: { models?: { strong?: unknown } } | null };
		return chatSettingsOf(body.settings?.models?.strong);
	} catch {
		return undefined;
	}
}
