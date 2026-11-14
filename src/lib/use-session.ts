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
 * - Leave the screen: stop reading the stream. The turn runs on.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useEventHub } from "./server-events-context";
import { attachSessionEvents } from "./session-events";
import { openingPrompts, readSession, type OpeningPrompts, type SessionRecord } from "./sessions";
import {
	SessionModel,
	malformedQuestionsOf,
	pendingQuestionOf,
	type QuestionAnswerData,
	type QuestionDraft,
	type SessionState,
} from "./shared";

import { describeError, type UserMessage } from "./user-error";

/** An input that the Mac did not accept. Try again sends it again. */
type Unsent =
	| { kind: "text"; text: string }
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

export interface SessionControls {
	state: SessionState;
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

	const sendText = useCallback(
		async (text: string) => {
			// onAccepted makes SessionModel remove the text's own bubble when the
			// Mac does not accept it, as the desktop does for its opening text.
			const accepted = await model.send({ type: "text", text }, () => {});
			setUnsent(accepted ? null : { kind: "text", text });
			return accepted;
		},
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

	// Turns that the Mac starts by itself, and records that change without a turn.
	useEffect(() => attachSessionEvents(model, hub), [model, hub]);

	useEffect(() => {
		model.setReattachSettled(() => {
			void model
				.readRecord()
				.then((snapshot) => snapshot && model.continueIfOwed(snapshot.messages))
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

	return {
		state,
		pending,
		malformed,
		sendText,
		unsentText: unsent?.kind === "text" ? unsent.text : null,
		answer,
		draft: (key) => model.questionDraft(key),
		saveDraft: (key, draft) => model.saveQuestionDraft(key, draft),
		retry: () =>
			unsent?.kind === "text"
				? sendText(unsent.text)
				: unsent?.kind === "answer"
					? answer(unsent.toolCallId, unsent.answer, unsent.key)
					: model.send({ type: "retry" }),
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
