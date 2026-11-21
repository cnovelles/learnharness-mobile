/**
 * JS side of the local Expo module "Dictation" (ios/DictationModule.swift):
 * on-device speech to text with Apple SpeechAnalyzer (iOS 26).
 * `createOnDeviceEngine(native)` turns the native calls and events into the
 * DictationEngine that src/lib/dictation.ts uses.
 */
import type {
	DictationEngine,
	DictationRunHandlers,
	ModelStatus,
} from "../../../src/lib/dictation";

export interface NativeDictation {
	isSupported(): boolean;
	microphonePermission(): "granted" | "denied" | "undetermined";
	requestMicrophone(): Promise<boolean>;
	status(language: string): Promise<{ engine: string; locale: string; model: string }>;
	install(language: string): Promise<void>;
	start(id: string, language: string): Promise<void>;
	startFile(id: string, language: string, path: string): Promise<void>;
	startDeepgram(id: string, language: string, token: string): Promise<void>;
	stop(): Promise<void>;
	cancel(): Promise<void>;
	addListener(
		event: "speechLevel",
		fn: (e: { id: string; level: number }) => void,
	): { remove(): void };
	addListener(
		event: "speechText",
		fn: (e: { id: string; text: string }) => void,
	): { remove(): void };
	addListener(
		event: "speechEnd",
		fn: (e: { id: string; error?: string; reason?: string }) => void,
	): { remove(): void };
	addListener(
		event: "speechInstallProgress",
		fn: (e: { language: string; progress: number }) => void,
	): { remove(): void };
}

const MODELS = new Set(["installed", "supported", "downloading", "unsupported"]);

/** The native error code from a rejected native call ("no-engine", "microphone: …"). */
export function nativeCode(error: unknown): string {
	if (typeof error === "object" && error !== null) {
		const e = error as { code?: unknown; message?: unknown };
		// Expo puts the exception's `reason` in `message`.
		if (typeof e.message === "string") return e.message;
	}
	return "engine";
}

/**
 * The on-device engine. `audioFile` (a path) makes every run read that file
 * instead of the microphone: the E2E flow uses it, and only a debug build
 * accepts it (the native side refuses it in Release).
 */
export function createOnDeviceEngine(native: NativeDictation, audioFile?: string): DictationEngine {
	return {
		kind: "on-device",
		supported: () => native.isSupported(),
		microphone: () => (audioFile ? "granted" : native.microphonePermission()),
		requestMicrophone: () => native.requestMicrophone(),
		async model(language): Promise<ModelStatus> {
			try {
				const s = await native.status(language);
				if (s.engine === "none") return "unsupported";
				return MODELS.has(s.model) ? (s.model as ModelStatus) : "unsupported";
			} catch (error) {
				throw new Error(nativeCode(error));
			}
		},
		async install(language, onProgress) {
			const sub = native.addListener("speechInstallProgress", (e) => {
				if (e.language === language) onProgress(e.progress);
			});
			try {
				await native.install(language);
			} catch (error) {
				throw new Error(nativeCode(error));
			} finally {
				sub.remove();
			}
		},
		async start(id: string, language: string, handlers: DictationRunHandlers) {
			const subs = [
				native.addListener("speechLevel", (e) => {
					if (e.id === id) handlers.onLevel(e.level);
				}),
				native.addListener("speechText", (e) => {
					if (e.id === id) handlers.onText(e.text);
				}),
				native.addListener("speechEnd", (e) => {
					if (e.id !== id) return;
					for (const s of subs) s.remove();
					handlers.onEnd({ error: e.error, reason: e.reason });
				}),
			];
			try {
				if (audioFile) await native.startFile(id, language, audioFile);
				else await native.start(id, language);
			} catch (error) {
				for (const s of subs) s.remove();
				throw new Error(nativeCode(error));
			}
		},
		stop: () => native.stop(),
		cancel: () => native.cancel(),
	};
}
