/**
 * The dictation engine choice (issue 07 slice D, user decision 2026-11-16:
 * a Dictation section in Settings, "On this iPhone" by default). The value
 * lives on the phone (the Keychain, like the feature flags).
 */
import { userMessage, type UserMessage } from "./user-error";

export type EngineChoice = "on-device" | "deepgram";
export const DEFAULT_ENGINE: EngineChoice = "on-device";

export const ENGINE_CHOICES: readonly { id: EngineChoice; title: string; detail: string }[] = [
	{
		id: "on-device",
		title: "On this iPhone",
		detail: "Speech becomes text on the iPhone. No network after the first model download. iOS 26.",
	},
	{
		id: "deepgram",
		title: "Deepgram",
		detail: "Speech goes to Deepgram through the internet. Needs the Mac and its Deepgram key.",
	},
];

export const SAVE_FAILED: UserMessage = userMessage(
	"Could not save the dictation setting. Try again.",
);

export interface ChoiceStorage {
	read(): Promise<string | null>;
	write(value: string): Promise<void>;
}

export function parseChoice(raw: string | null): EngineChoice {
	return raw === "deepgram" || raw === "on-device" ? raw : DEFAULT_ENGINE;
}

export function createEngineChoiceStore(storage: ChoiceStorage) {
	let choice: EngineChoice = DEFAULT_ENGINE;
	let loaded = false;
	let error: UserMessage | null = null;
	let snapshot: { choice: EngineChoice; loaded: boolean; error: UserMessage | null } = {
		choice,
		loaded,
		error,
	};
	const listeners = new Set<() => void>();
	function publish() {
		snapshot = { choice, loaded, error };
		for (const l of listeners) l();
	}
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** The choice now (the default until load ends). */
		current: () => choice,
		async load() {
			try {
				choice = parseChoice(await storage.read());
			} catch {
				// An unreadable value: the default. The next save writes a good one.
				choice = DEFAULT_ENGINE;
			}
			loaded = true;
			publish();
		},
		/** Saves first, then uses the new choice. False when the save failed. */
		async set(next: EngineChoice): Promise<boolean> {
			try {
				await storage.write(next);
			} catch {
				error = SAVE_FAILED;
				publish();
				return false;
			}
			choice = next;
			error = null;
			publish();
			return true;
		},
	};
}

export type EngineChoiceStore = ReturnType<typeof createEngineChoiceStore>;
