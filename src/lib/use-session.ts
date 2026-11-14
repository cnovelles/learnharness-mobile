/**
 * React access to one session on the Mac (mode 1). The shared SessionModel
 * (fork components/session-core.ts) does all the work: send, stream,
 * reattach, settle. These hooks only load the record, re-render on each
 * model change and connect the model to the screen's life, as the desktop
 * hook does (fork components/session.ts):
 * - A turn that runs on the Mac: reattach to its stream.
 * - A new session: send the opening text once (OpeningPrompts).
 * - A text that the Mac refuses before it saves it (for example, no model
 *   is set) is not a failed turn: SessionModel removes its bubble, the
 *   text goes back to the composer, and Try again sends the same text. A
 *   `retry` is only for a saved turn that failed.
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
	type SessionState,
} from "./shared";
import { describeError, type UserMessage } from "./user-error";

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
	answer(tool: string, toolCallId: string, answer: QuestionAnswerData): Promise<void>;
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
	const [unsentText, setUnsentText] = useState<string | null>(null);

	const sendText = useCallback(
		async (text: string) => {
			// onAccepted makes SessionModel remove the text's own bubble when the
			// Mac does not accept it, as the desktop does for its opening text.
			const accepted = await model.send({ type: "text", text }, () => {});
			setUnsentText(accepted ? null : text);
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
					.then((accepted) => !accepted && setUnsentText(opening));
			else void model.continueIfOwed(record.messages);
		}
		return () => model.stop();
		// The model and the record belong to this mount; they do not change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const pending = useMemo(
		() => (state.status === "ready" ? pendingQuestionOf(state.nativeMessages) : null),
		[state],
	);
	const malformed = useMemo(
		() =>
			state.status === "ready" && !pending
				? (malformedQuestionsOf(state.nativeMessages)[0] ?? null)
				: null,
		[state, pending],
	);

	return {
		state,
		pending,
		malformed,
		sendText,
		unsentText,
		answer: (tool, toolCallId, answer) => model.submitAnswer(tool, toolCallId, answer),
		retry: () => (unsentText !== null ? sendText(unsentText) : model.send({ type: "retry" })),
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
