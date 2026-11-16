/**
 * The app's one dictation controller (src/lib/dictation.ts), for every
 * input on every screen.
 *
 * - The engine: on the device (modules/dictation). Deepgram comes in slice E.
 * - The language: the Mac setting, or the last known one (dictation-language.ts).
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
import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { createOnDeviceEngine, type NativeDictation } from "../../modules/dictation/src";
import { createDictation, type Dictation, type DictationEngine } from "./dictation";
import { createLanguageSource, onDeviceLanguage } from "./dictation-language";
import { createScriptedEngine } from "./dictation-scripted";
import { useOptionalMacFetch } from "./connection-context";

const DictationContext = createContext<Dictation | null>(null);

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
	const native =
		Platform.OS === "ios" ? requireOptionalNativeModule<NativeDictation>("Dictation") : null;
	if (!native) return NO_ENGINE;
	const file = __DEV__ ? process.env.EXPO_PUBLIC_LH_E2E_DICTATION_FILE : undefined;
	return createOnDeviceEngine(native, file || undefined);
}

export function DictationProvider({ children }: { children: ReactNode }) {
	const macFetch = useOptionalMacFetch();
	useEffect(() => {
		currentMacFetch = macFetch;
	}, [macFetch]);
	const [dictation] = useState(() => {
		const languages = createLanguageSource(() => currentMacFetch);
		const engine = onDeviceEngine();
		return createDictation({
			engine: () => engine,
			language: async () => onDeviceLanguage(await languages.get(), phoneLocale()),
		});
	});

	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			// Not "inactive": the permission prompt and Control Center make the app inactive.
			if (state === "background") void dictation.stop();
		});
		return () => sub.remove();
	}, [dictation]);

	return <DictationContext.Provider value={dictation}>{children}</DictationContext.Provider>;
}

export function useDictationController(): Dictation {
	const d = useContext(DictationContext);
	if (!d) throw new Error("useDictationController outside DictationProvider");
	return d;
}

export function useOptionalDictationController(): Dictation | null {
	return useContext(DictationContext);
}
