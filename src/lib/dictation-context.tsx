/**
 * The app's one dictation controller (src/lib/dictation.ts), for every
 * input on every screen.
 *
 * - The engine: the choice in Settings (dictation-settings.ts): on the
 *   device (modules/dictation, iOS 26) or Deepgram (dictation-deepgram.ts).
 * - The language: the Mac setting, or the last known one (dictation-language.ts).
 *   "multi" goes to Deepgram as is; the on-device engine uses the phone's language.
 * - The app goes to the background during a run: the run stops and keeps
 *   the text (an error state of issue 07).
 *
 * E2E (dev builds only):
 * - EXPO_PUBLIC_LH_E2E_DICTATION_TEXT: the scripted engine
 *   (dictation-scripted.ts). The Simulator flow uses it, because the
 *   Simulator's SpeechAnalyzer gives no text.
 * - EXPO_PUBLIC_LH_E2E_DICTATION_FILE: the real engine reads that audio file
 *   instead of the microphone (for a device). The native side refuses a
 *   file in a Release build.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { createOnDeviceEngine } from "../../modules/dictation/src";
import { nativeDictation } from "./native-dictation";
import { createDictation, type Dictation, type DictationEngine } from "./dictation";
import { createLanguageSource, onDeviceLanguage } from "./dictation-language";
import { createScriptedEngine } from "./dictation-scripted";
import { createDeepgramEngine } from "./dictation-deepgram";
import { createEngineChoiceStore, type EngineChoiceStore } from "./dictation-settings";
import { useOptionalMacFetch } from "./connection-context";

const DictationContext = createContext<Dictation | null>(null);

/** What the Settings section needs: the choice, the Mac's language, the on-device model. */
export interface DictationSettings {
	choice: EngineChoiceStore;
	/** The Mac's language, or the last known one. */
	macLanguage: () => Promise<string>;
	/** The on-device engine, for the model state and the download. */
	onDevice: DictationEngine;
	/** The language that the on-device engine uses for a Mac language. */
	onDeviceLanguage: (macLanguage: string) => string;
}

const DictationSettingsContext = createContext<DictationSettings | null>(null);

const CHOICE_KEY = "lh.dictation.engine";
const CHOICE_OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The newest Mac fetch, for the language source (the app has one DictationProvider). */
let currentMacFetch: typeof globalThis.fetch | null = null;

/** An engine for a phone with no native module (Jest, Android): never supported. */
const NO_ENGINE: DictationEngine = {
	kind: "on-device",
	supported: () => false,
	microphone: () => "denied",
	requestMicrophone: async () => false,
	model: async () => "unsupported",
	install: async () => {},
	start: async () => {
		throw new Error("ios-too-old");
	},
	stop: async () => {},
	cancel: async () => {},
};

function phoneLocale(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale;
	} catch {
		return "";
	}
}

function onDeviceEngine(): DictationEngine {
	const scripted = __DEV__ ? process.env.EXPO_PUBLIC_LH_E2E_DICTATION_TEXT : undefined;
	if (scripted) return createScriptedEngine(scripted);
	const native = nativeDictation();
	if (!native) return NO_ENGINE;
	const file = __DEV__ ? process.env.EXPO_PUBLIC_LH_E2E_DICTATION_FILE : undefined;
	return createOnDeviceEngine(native, file || undefined);
}

function deepgramEngine(): DictationEngine {
	const native = nativeDictation();
	return native ? createDeepgramEngine(native, () => currentMacFetch) : NO_ENGINE;
}

export function DictationProvider({ children }: { children: ReactNode }) {
	const macFetch = useOptionalMacFetch();
	useEffect(() => {
		currentMacFetch = macFetch;
	}, [macFetch]);
	const [{ dictation, settings }] = useState(() => {
		const languages = createLanguageSource(() => currentMacFetch);
		const onDevice = onDeviceEngine();
		const deepgram = deepgramEngine();
		const choice = createEngineChoiceStore({
			read: () => SecureStore.getItemAsync(CHOICE_KEY, CHOICE_OPTIONS),
			write: (value) => SecureStore.setItemAsync(CHOICE_KEY, value, CHOICE_OPTIONS),
		});
		void choice.load();
		const toOnDevice = (language: string) => onDeviceLanguage(language, phoneLocale());
		const dictation = createDictation({
			engine: () => (choice.current() === "deepgram" ? deepgram : onDevice),
			language: async (engine) => {
				const language = await languages.get();
				return engine.kind === "deepgram" ? language : toOnDevice(language);
			},
		});
		const settings: DictationSettings = {
			choice,
			macLanguage: () => languages.get(),
			onDevice,
			onDeviceLanguage: toOnDevice,
		};
		return { dictation, settings };
	});

	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			// Not "inactive": the permission prompt and Control Center make the app inactive.
			if (state === "background") void dictation.stop();
		});
		return () => sub.remove();
	}, [dictation]);

	return (
		<DictationSettingsContext.Provider value={settings}>
			<DictationContext.Provider value={dictation}>{children}</DictationContext.Provider>
		</DictationSettingsContext.Provider>
	);
}

export function useDictationSettings(): DictationSettings | null {
	return useContext(DictationSettingsContext);
}

export function useDictationController(): Dictation {
	const d = useContext(DictationContext);
	if (!d) throw new Error("useDictationController outside DictationProvider");
	return d;
}

export function useOptionalDictationController(): Dictation | null {
	return useContext(DictationContext);
}
