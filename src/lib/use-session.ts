/**
 * React access to one session on the Mac (mode 1). The shared SessionModel
 * (fork components/session-core.ts) does all the work: send, stream,
 * reattach, settle. These hooks only load the record, re-render on each
 * model change and connect the model to the screen's life, as the desktop
 * hook does (fork components/session.ts):
 * - A turn that runs on the Mac: reattach to its stream.
 * - A new session: send the opening text once (OpeningPrompts).
 * - A text or an answer that the Mac refuses before it saves it (for
 *   example, no model is set) is not a failed turn. A refused text goes
 *   back to the composer; a refused answer keeps its form (the question
 *   draft). Try again sends the same input again. A `retry` is only for a
 *   saved turn that failed.
 * - Otherwise: continue a turn that the record still owes (for example,
 *   a background job result that came in while no screen was open).
 * - When a reattached turn settles: read the record again.
 * - Leave the screen, or the app goes to the background: stop reading the
 *   stream. The turn runs on. Back in the foreground, the events channel
 *   connects again and the sync attaches again (session-events.ts).
 *
 * Issue 04 slices C and D:
 * - While a turn runs, a text is a steer. Queued steers show until the
 *   teacher takes them. A 409 makes SessionModel send the text as an
 *   ordinary message.
 * - Stop: stop reading, then POST /api/activity/abort. A 409 (no turn runs
 *   anymore) is not an error. Another failure says that the turn still
 *   runs on the Mac, and the phone attaches again.
 * - No Skip (user decision 2026-11-14): "I don't know" is the honest answer.
 * - Compaction: `compacting` from the record and from compaction-changed.
 *   Sends, answers and retry wait. Reading and Stop still work. While it
 *   runs, the phone reads the record every 30 s, so a missed end event
 *   does not lock the screen.
 * - One banner for every error of the session, with Try again when an
 *   action applies.
 *
 * Issue 06 (practice):
 * - `problem`: the active practice problem (the shared activeProblemOf,
 *   the gate that the Mac's tools read), when no turn runs.
 * - A thinking submission starts a turn. A refused one keeps its text
 *   (Try again sends it again), as a refused text does.
 * - Dismiss (only when no turn runs: during a turn the composer shows
 *   Stop, and the dock comes back after it): SessionModel adds the
 *   dismissal marker and calls the dismiss route. A failed dismissal reads
 *   the record again, so the dock comes back.
 * - A refusal that says the problem is not active (or still active) offers
 *   a sync, not a resend.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { useEventHub } from "./server-events-context";
import { attachSessionEvents, syncSession, type SessionEventHooks } from "./session-events";
import { openingPrompts, readSession, type OpeningPrompts, type SessionRecord } from "./sessions";
import {
	SessionModel,
	activeProblemOf,
	endsInFailedTurn,
	malformedQuestionsOf,
	pendingQuestionOf,
	visibleQueuedSteers,
	type SteerQueueItem,
	type QuestionAnswerData,
	type QuestionDraft,
	type SessionState,
} from "./shared";

import {
	PROBLEM_NOT_ACTIVE,
	PROBLEM_STILL_ACTIVE,
	SYNC_FAILED,
	describeError,
	userMessage,
	type UserMessage,
} from "./user-error";

export const ABORT_FAILED = userMessage(
	"The phone could not stop the turn. It still runs on the Mac. Try again in a moment.",
);
export const COMPACTING = userMessage("The Mac is making the history shorter…");

/** How often the phone reads the record while the Mac compacts. */
export const COMPACTION_RECHECK_MS = 30_000;

/** The session's one error banner. */
export interface SessionBanner {
	text: UserMessage;
	/** What Try again does, or null when no action applies (Close only). */
	retry: "resend" | "retry-turn" | "sync" | null;
}

/** An input that the Mac did not accept. Try again sends it again. */
type Unsent =
	| { kind: "text"; text: string }
	| { kind: "thinking"; problemCallId: string; text: string }
	| { kind: "answer"; toolCallId: string; answer: QuestionAnswerData; key: string };

export type SessionLoad =
	| { status: "loading" }
	| { status: "error"; userText: UserMessage }
	| { status: "ready"; record: SessionRecord };

export function useSessionRecord(
	chatId: string,
	macFetch: typeof fetch,
): { load: SessionLoad; reload: () => void } {
	const [load, setLoad] = useState<SessionLoad>({ status: "loading" });
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let current = true;
		readSession(macFetch, chatId).then(
			(record) => current && setLoad({ status: "ready", record }),
			(e: unknown) => current && setLoad({ status: "error", userText: describeError(e) }),
		);
		return () => {
			current = false;
		};
	}, [chatId, macFetch, attempt]);
	const reload = useCallback(() => {
		setLoad({ status: "loading" });
		setAttempt((n) => n + 1);
	}, []);
	return { load, reload };
}

/** The active practice problem (shared activeProblemOf). */
export type ActiveProblem = NonNullable<ReturnType<typeof activeProblemOf>>;

export interface SessionControls {
	state: SessionState;
	/** The active practice problem, when no turn runs. */
	problem: ActiveProblem | null;
	/** Send the learner's thinking for the active problem. Resolves when the Mac accepts it. */
	submitThinking(problemCallId: string, text: string): Promise<boolean>;
	/** The last thinking that the Mac did not accept. The dock shows it again. */
	unsentThinking: string | null;
	/** Dismiss the active problem (no turn runs while the dock shows). */
	dismissProblem(): Promise<void>;
	/** The question that waits for the learner, when no turn runs. */
	pending: ReturnType<typeof pendingQuestionOf>;
	/** A question call with bad input, when no turn runs and no question waits. */
	malformed: ReturnType<typeof malformedQuestionsOf>[number] | null;
	sendText(text: string): Promise<boolean>;
	/** The last text that the Mac did not accept. The composer shows it again. */
	unsentText: string | null;
	/** Send an answer. `key` is the pending question's key (its draft). */
	answer(toolCallId: string, answer: QuestionAnswerData, key: string): Promise<boolean>;
	/** The question's draft (form and reading thinking), kept while the screen is open. */
	draft(key: string): QuestionDraft | undefined;
	saveDraft(key: string, draft: Partial<QuestionDraft>): void;
	/** Send the unsent text again, or retry the failed saved turn. */
	retry(): Promise<boolean>;
	/** Ask the teacher again for a malformed question (the desktop's "retry-question"). */
	retryQuestion(): Promise<boolean>;
	clearError(): void;
	/** A turn runs (the phone streams it). */
	running: boolean;
	/** Steers that the teacher did not take yet. */
	queuedSteers: SteerQueueItem[];
	/** Stop the running turn on the Mac. */
	stopTurn(): Promise<void>;
	/** The Mac makes the history shorter. Sends and answers wait. */
	compacting: boolean;
	/** The one error banner, or null. */
	banner: SessionBanner | null;
	/** Do the banner's Try again. */
	retryBanner(): Promise<void>;
	/** Close the banner. */
	closeBanner(): void;
}

/**
 * The model's state as an external store for useSyncExternalStore: one
 * snapshot per model change (getState() makes a new object at each call).
 */
export function sessionStore(model: SessionModel) {
	let snapshot = model.getState();
	const listeners = new Set<() => void>();
	model.onChange = () => {
		snapshot = model.getState();
		for (const l of listeners) l();
	};
	return {
		model,
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export function useSessionModel(
	record: SessionRecord,
	macFetch: typeof fetch,
	prompts: OpeningPrompts = openingPrompts,
): SessionControls {
	const [store] = useState(() =>
		sessionStore(
			new SessionModel({
				chatId: record.id,
				initialMessages: record.messages,
				initialError: record.turnError,
				fetch: macFetch,
			}),
		),
	);
	const { model } = store;
	const attached = useRef(false);
	const hub = useEventHub();
	const [unsent, setUnsent] = useState<Unsent | null>(null);
	const [compacting, setCompacting] = useState(record.compacting);
	/** Errors that are not SessionModel's: a failed abort, a failed sync. */
	const [notice, setNotice] = useState<SessionBanner | null>(null);

	const hooks = useMemo<SessionEventHooks>(
		() => ({
			onSnapshot: (snapshot) =>
				setCompacting((snapshot as { compacting?: unknown }).compacting === true),
			onSyncError: () => setNotice({ text: SYNC_FAILED, retry: "sync" }),
			onCompaction: setCompacting,
		}),
		[],
	);
	const sync = useCallback(async () => {
		if (await syncSession(model, hooks)) setNotice((n) => (n?.retry === "sync" ? null : n));
	}, [model, hooks]);

	const sendText = useCallback(
		(text: string) =>
			new Promise<boolean>((resolve) => {
				// Resolve when the Mac accepts the text, not when the turn ends,
				// so the composer is free for a steer while the turn runs.
				let accepted = false;
				const onAccepted = () => {
					accepted = true;
					setUnsent(null);
					resolve(true);
				};
				const s = model.getState().status;
				// While a turn runs, the text is a steer for that turn.
				// onAccepted also makes SessionModel remove the text's own bubble
				// when the Mac does not accept it, as the desktop does.
				const sent =
					s === "submitted" || s === "streaming"
						? model.steer(text, undefined, onAccepted)
						: model.send({ type: "text", text }, onAccepted);
				void sent.then((ok) => {
					if (accepted) return;
					setUnsent(ok ? null : { kind: "text", text });
					resolve(ok);
				});
			}),
		[model],
	);

	const answer = useCallback(
		async (toolCallId: string, answerData: QuestionAnswerData, key: string) => {
			const accepted = await model.send(
				{ type: "answer", toolCallId, answer: answerData },
				undefined,
				key,
			);
			setUnsent(accepted ? null : { kind: "answer", toolCallId, answer: answerData, key });
			return accepted;
		},
		[model],
	);

	const submitThinking = useCallback(
		(problemCallId: string, text: string) =>
			new Promise<boolean>((resolve) => {
				let accepted = false;
				const onAccepted = () => {
					accepted = true;
					setUnsent(null);
					resolve(true);
				};
				void model.send({ type: "thinking", problemCallId, text }, onAccepted).then((ok) => {
					if (accepted) return;
					setUnsent(ok ? null : { kind: "thinking", problemCallId, text });
					resolve(ok);
				});
			}),
		[model],
	);

	// Turns that the Mac starts by itself, and records that change without a turn.
	useEffect(() => attachSessionEvents(model, hub, hooks), [model, hub, hooks]);

	// While the Mac compacts, read the record from time to time: a missed
	// end event must not keep the screen waiting for good.
	useEffect(() => {
		if (!compacting) return;
		const timer = setInterval(
			() => void syncSession(model, { onSnapshot: hooks.onSnapshot }),
			COMPACTION_RECHECK_MS,
		);
		return () => clearInterval(timer);
	}, [compacting, model, hooks]);

	// iOS stops network work in the background: stop reading the stream
	// there. The turn runs on; the resync on return attaches again.
	useEffect(() => {
		const sub = AppState.addEventListener("change", (next) => {
			const s = model.getState().status;
			if (next === "background" && (s === "submitted" || s === "streaming")) model.stop();
		});
		return () => sub.remove();
	}, [model]);

	useEffect(() => {
		model.setReattachSettled(() => {
			void model
				.readRecord()
				.then((snapshot) => {
					if (!snapshot) return;
					hooks.onSnapshot?.(snapshot);
					return model.continueIfOwed(snapshot.messages);
				})
				.catch(() => {});
		});
		if (attached.current) {
			// A second mount of the same screen (React development mode): the
			// first mount already sent or attached. Attach again to the turn.
			void model.resumeStream();
		} else {
			attached.current = true;
			const opening = prompts.take(record.id);
			if (record.turnInFlight) void model.resumeStream(false);
			else if (opening)
				void model
					.send({ type: "text", text: opening }, () => {})
					.then((accepted) => !accepted && setUnsent({ kind: "text", text: opening }));
			else void model.continueIfOwed(record.messages);
		}
		return () => model.stop();
		// The model and the record belong to this mount; they do not change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const pending = useMemo(
		// After an error the question still waits (for example, a refused answer).
		() =>
			state.status === "ready" || state.status === "error"
				? pendingQuestionOf(state.nativeMessages)
				: null,
		[state],
	);
	const malformed = useMemo(
		() =>
			(state.status === "ready" || state.status === "error") && !pending
				? (malformedQuestionsOf(state.nativeMessages)[0] ?? null)
				: null,
		[state, pending],
	);

	const running = state.status === "submitted" || state.status === "streaming";
	const problem = useMemo(
		() =>
			state.status === "ready" || state.status === "error"
				? activeProblemOf(state.nativeMessages)
				: null,
		[state],
	);
	const queuedSteers = useMemo(
		() => visibleQueuedSteers(state.steerQueue, state.nativeMessages),
		[state.steerQueue, state.nativeMessages],
	);

	const stopTurn = useCallback(async () => {
		model.stop();
		let ok = false;
		try {
			const res = await macFetch("/api/activity/abort", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ kind: "turn", id: model.chatId }),
			});
			// 409: no turn runs anymore. That is what the learner wanted.
			ok = res.ok || res.status === 409;
			await res.text().catch(() => "");
		} catch {
			ok = false;
		}
		if (ok) {
			setNotice(null);
			await sync();
		} else {
			setNotice({ text: ABORT_FAILED, retry: null });
			// The turn still runs: show it again.
			await model.resumeStream();
		}
	}, [model, macFetch, sync]);

	const retryTurn = useCallback(
		() =>
			unsent?.kind === "text"
				? sendText(unsent.text)
				: unsent?.kind === "thinking"
					? submitThinking(unsent.problemCallId, unsent.text)
					: unsent?.kind === "answer"
						? answer(unsent.toolCallId, unsent.answer, unsent.key)
						: model.send({ type: "retry" }),
		[unsent, sendText, submitThinking, answer, model],
	);

	const banner = useMemo<SessionBanner | null>(() => {
		if (state.error) {
			const text = describeError(state.error);
			// The Mac's view of the problem is not the phone's: read it again.
			if (text === PROBLEM_NOT_ACTIVE || text === PROBLEM_STILL_ACTIVE)
				return { text, retry: "sync" };
			return {
				text,
				// No Try again for a failure that cannot be retried (as on the
				// desktop): the learner closes it and sends something new.
				retry: unsent ? "resend" : endsInFailedTurn(state.nativeMessages) ? "retry-turn" : null,
			};
		}
		return notice;
	}, [state.error, state.nativeMessages, unsent, notice]);

	const dismissProblem = useCallback(async () => {
		const active = activeProblemOf(model.getState().nativeMessages);
		if (!active) return;
		await model.dismissProblem(active.toolCallId);
		// A failed dismissal leaves its marker on the phone only: read the record again.
		if (model.getState().error) await syncSession(model, { onSnapshot: hooks.onSnapshot });
	}, [model, hooks]);

	return {
		state,
		problem: running ? null : problem,
		submitThinking,
		unsentThinking: unsent?.kind === "thinking" ? unsent.text : null,
		dismissProblem,
		pending,
		malformed,
		sendText,
		unsentText: unsent?.kind === "text" ? unsent.text : null,
		answer,
		draft: (key) => model.questionDraft(key),
		saveDraft: (key, draft) => model.saveQuestionDraft(key, draft),
		retry: retryTurn,
		running,
		queuedSteers,
		stopTurn,
		compacting,
		banner,
		async retryBanner() {
			if (!banner) return;
			if (banner.retry === "sync") {
				model.clearError();
				setNotice(null);
				await sync();
			} else if (banner.retry === "resend" || banner.retry === "retry-turn") {
				// Sends wait while the Mac compacts.
				if (compacting) return;
				await retryTurn();
			}
		},
		closeBanner() {
			model.clearError();
			setNotice(null);
		},
		retryQuestion: () =>
			malformed
				? model.send({
						type: "retry-question",
						messageId: malformed.messageId,
						contentIndex: malformed.contentIndex,
						toolCallId: malformed.toolCallId,
					})
				: Promise.resolve(false),
		clearError: () => model.clearError(),
	};
}
