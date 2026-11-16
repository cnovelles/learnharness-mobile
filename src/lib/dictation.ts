/**
 * Dictation (issue 07): speak, tap Stop, and the text goes into one field.
 *
 * The behavior follows the desktop (fork components/dictation.tsx):
 * - One run at a time for the whole app. A generation counter makes the
 *   events of an old run do nothing.
 * - The text is deferred: the final pieces collect while you speak and go
 *   into the field once, when the run ends. No live text.
 * - Cancel drops the text.
 *
 * The phone adds: the input that starts a run is its "owner". If the owner
 * goes away during the run (the dock closed), the text waits as "orphan
 * text", and the composer takes it when it shows. No text is lost.
 *
 * The engine (on the device, or Deepgram) is behind DictationEngine, so this
 * file has no native code and Jest tests all of it.
 */
import { userMessage, type UserMessage } from "./user-error";

export type ModelStatus = "installed" | "supported" | "downloading" | "unsupported";

export interface DictationRunHandlers {
	/** The loudness of the newest audio, RMS 0…1. */
	onLevel(level: number): void;
	/** One final piece of text. */
	onText(text: string): void;
	/** The run ended. `error` is an engine code; `reason` is "interrupted" or "canceled". */
	onEnd(end: { error?: string; reason?: string }): void;
}

export interface DictationEngine {
	kind: "on-device" | "deepgram";
	/** False when the engine cannot run on this phone (on-device before iOS 26). */
	supported(): boolean;
	microphone(): "granted" | "denied" | "undetermined";
	requestMicrophone(): Promise<boolean>;
	model(language: string): Promise<ModelStatus>;
	install(language: string, onProgress: (progress: number) => void): Promise<void>;
	/** Resolves when the engine listens. A rejection carries an engine code in `message`. */
	start(id: string, language: string, handlers: DictationRunHandlers): Promise<void>;
	/** Stops the audio. The engine then sends its last texts and onEnd. */
	stop(): Promise<void>;
	/** Stops at once. The engine may still send onEnd with reason "canceled". */
	cancel(): Promise<void>;
}

export type DictationPhase = "idle" | "preparing" | "installing" | "listening" | "stopping";

export interface DictationProblem {
	text: UserMessage;
	/** "settings": the message has an Open Settings action (a refused permission). */
	action?: "settings";
}

export interface DictationSnapshot {
	phase: DictationPhase;
	/** The model download, 0…1, while phase is "installing". */
	progress: number;
	/** The input that owns the run, or null. */
	owner: symbol | null;
	problem: DictationProblem | null;
	/** Text from a run whose input went away. The composer takes it. */
	orphan: string | null;
}

export const DICTATION_MESSAGES = {
	microphoneOff: userMessage("Microphone access is off for LearnHarness."),
	iosTooOld: userMessage(
		"Dictation on the iPhone needs iOS 26. Use Deepgram in Settings, or the keyboard mic.",
	),
	noLanguage: userMessage("The iPhone has no speech model for this language."),
	downloadFailed: userMessage(
		"Could not get the speech model. Connect to the internet and try again.",
	),
	noSpeech: userMessage("No speech heard."),
	microphoneFailed: userMessage("The microphone did not start. Try again."),
	failed: userMessage("Dictation stopped. Try again."),
	deepgramNoKey: userMessage(
		"Dictation with Deepgram needs a Deepgram key on the Mac. Add it in the Mac's Settings, under Keys.",
	),
	deepgramMacUnreachable: userMessage(
		"Dictation with Deepgram needs the Mac, and the Mac is not reachable. Use the iPhone engine in Settings.",
	),
	deepgramNoAnswer: userMessage("Deepgram did not answer. Try again."),
	deepgramLost: userMessage("Dictation stopped: the connection to Deepgram was lost."),
	deepgramLanguage: userMessage("Deepgram does not know the dictation language set on the Mac."),
} as const;

/** The engine codes that have their own message. Other codes get `failed`. */
export function dictationProblem(code: string): DictationProblem | null {
	if (code === "already-running" || code === "canceled") return null;
	if (code === "ios-too-old") return { text: DICTATION_MESSAGES.iosTooOld };
	if (code === "no-engine" || code === "model-not-installed")
		return { text: DICTATION_MESSAGES.noLanguage };
	if (code.startsWith("microphone")) return { text: DICTATION_MESSAGES.microphoneFailed };
	if (code === "deepgram-no-key") return { text: DICTATION_MESSAGES.deepgramNoKey };
	if (code === "mac-unreachable") return { text: DICTATION_MESSAGES.deepgramMacUnreachable };
	if (code === "deepgram-grant" || code === "deepgram-refused")
		return { text: DICTATION_MESSAGES.deepgramNoAnswer };
	if (code === "deepgram-lost") return { text: DICTATION_MESSAGES.deepgramLost };
	if (code === "deepgram-language") return { text: DICTATION_MESSAGES.deepgramLanguage };
	return { text: DICTATION_MESSAGES.failed };
}

/** The pieces of one run as one text: trimmed and joined with spaces. */
export function joinPieces(pieces: readonly string[]): string {
	return pieces
		.map((p) => p.trim())
		.filter(Boolean)
		.join(" ");
}

/** Adds dictated text to the end of a field, with one space between. */
export function appendDictation(current: string, text: string): string {
	if (!text) return current;
	if (!current) return text;
	return /\s$/.test(current) ? current + text : `${current} ${text}`;
}

/** How long Stop waits for the engine's last texts before it ends the run itself. */
export const STOP_TIMEOUT_MS = 5000;

const IDLE: DictationSnapshot = {
	phase: "idle",
	progress: 0,
	owner: null,
	problem: null,
	orphan: null,
};

export interface DictationOptions {
	engine: () => DictationEngine;
	/** The language code for the next run ("en", "es", "multi", …) for this engine. */
	language: (engine: DictationEngine) => Promise<string>;
	newId?: () => string;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}

export type Dictation = ReturnType<typeof createDictation>;

export function createDictation(options: DictationOptions) {
	const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer =
		options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
	let counter = 0;
	const newId = options.newId ?? (() => `run-${Date.now()}-${++counter}`);

	let snapshot = IDLE;
	const listeners = new Set<() => void>();
	let generation = 0;
	let level = 0;
	let pieces: string[] = [];
	let deliver: ((text: string) => void) | null = null;
	let engine: DictationEngine | null = null;
	let stopTimer: unknown = null;

	function publish(patch: Partial<DictationSnapshot>) {
		snapshot = { ...snapshot, ...patch };
		for (const l of listeners) l();
	}

	function fail(problem: DictationProblem | null) {
		deliver = null;
		pieces = [];
		level = 0;
		publish({ phase: "idle", progress: 0, owner: null, problem });
	}

	/** Ends a run: one delivery of the text, then idle. */
	function finish(gen: number, end: { error?: string; reason?: string }) {
		if (gen !== generation) return;
		generation++;
		if (stopTimer !== null) {
			clearTimer(stopTimer);
			stopTimer = null;
		}
		const text = joinPieces(pieces);
		const target = deliver;
		pieces = [];
		deliver = null;
		level = 0;
		let problem: DictationProblem | null = null;
		let orphan = snapshot.orphan;
		if (end.reason === "canceled") {
			// Cancel drops the text.
		} else if (text) {
			if (target) target(text);
			else orphan = appendDictation(orphan ?? "", text);
			// A lost connection keeps the text so far, and says why the run ended early.
			if (end.error === "deepgram-lost") problem = dictationProblem(end.error);
		} else if (end.error) {
			problem = dictationProblem(end.error);
		} else if (end.reason !== "interrupted") {
			problem = { text: DICTATION_MESSAGES.noSpeech };
		}
		publish({ phase: "idle", progress: 0, owner: null, problem, orphan });
	}

	async function start(owner: symbol, target: (text: string) => void): Promise<void> {
		if (snapshot.phase !== "idle") return;
		const gen = ++generation;
		const current = options.engine();
		engine = current;
		deliver = target;
		pieces = [];
		level = 0;
		publish({ phase: "preparing", progress: 0, owner, problem: null });
		const stale = () => gen !== generation;

		if (!current.supported()) return fail({ text: DICTATION_MESSAGES.iosTooOld });

		let mic = current.microphone();
		if (mic === "undetermined") mic = (await current.requestMicrophone()) ? "granted" : "denied";
		if (stale()) return;
		if (mic !== "granted")
			return fail({ text: DICTATION_MESSAGES.microphoneOff, action: "settings" });

		let language: string;
		let model: ModelStatus;
		try {
			language = await options.language(current);
			model = await current.model(language);
		} catch (error) {
			if (stale()) return;
			return fail(dictationProblem(codeOf(error)) ?? { text: DICTATION_MESSAGES.failed });
		}
		if (stale()) return;
		if (model === "unsupported") return fail({ text: DICTATION_MESSAGES.noLanguage });
		if (model !== "installed") {
			publish({ phase: "installing", progress: 0 });
			try {
				await current.install(language, (progress) => {
					if (!stale()) publish({ progress });
				});
			} catch {
				if (stale()) return;
				return fail({ text: DICTATION_MESSAGES.downloadFailed });
			}
			if (stale()) return;
		}

		try {
			await current.start(newId(), language, {
				onLevel: (l) => {
					if (!stale()) level = l;
				},
				onText: (t) => {
					if (!stale()) pieces.push(t);
				},
				onEnd: (end) => finish(gen, end),
			});
		} catch (error) {
			if (stale()) return;
			generation++;
			return fail(dictationProblem(codeOf(error)));
		}
		if (stale()) return;
		publish({ phase: "listening" });
	}

	/** Stop and keep the text. */
	async function stop(): Promise<void> {
		if (snapshot.phase !== "listening") return;
		const gen = generation;
		publish({ phase: "stopping" });
		stopTimer = setTimer(() => {
			stopTimer = null;
			finish(gen, {});
		}, STOP_TIMEOUT_MS);
		try {
			await engine?.stop();
		} catch {
			finish(gen, {});
		}
	}

	/** Stop and drop the text (also during the model download). */
	async function cancel(): Promise<void> {
		if (snapshot.phase === "idle") return;
		const wasRunning = snapshot.phase === "listening" || snapshot.phase === "stopping";
		finish(generation, { reason: "canceled" });
		if (wasRunning) await engine?.cancel().catch(() => {});
	}

	/** The owner input goes away. Its run goes on, and the text becomes orphan text. */
	function release(owner: symbol) {
		if (snapshot.owner === owner) deliver = null;
	}

	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** The newest level, for the meter's own timer (not React state). */
		level: () => level,
		start,
		stop,
		cancel,
		release,
		/** The composer takes the orphan text once. */
		takeOrphan(): string | null {
			const text = snapshot.orphan;
			if (text !== null) publish({ orphan: null });
			return text;
		},
		clearProblem() {
			if (snapshot.problem) publish({ problem: null });
		},
	};
}

function codeOf(error: unknown): string {
	return error instanceof Error ? error.message : "engine";
}
