/**
 * The dictation language: the Mac setting `dictation.language` (the desktop's
 * Settings, "en" by default), read through `GET /api/settings`.
 *
 * The on-device engine must work when the Mac is not reachable, so a failed
 * read uses the last language that the Mac sent, else "en". "multi" (the
 * desktop's Deepgram multilingual mode) means the phone's own language for
 * the on-device engine.
 */
export const DEFAULT_DICTATION_LANGUAGE = "en";

/** The language code in a `GET /api/settings` body, or null. */
export function languageFromSettings(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const settings = (body as { settings?: unknown }).settings;
	if (settings === null) return DEFAULT_DICTATION_LANGUAGE; // never saved: the factory value
	if (typeof settings !== "object" || settings === undefined) return null;
	const language = (settings as { dictation?: { language?: unknown } }).dictation?.language;
	if (language === undefined) return DEFAULT_DICTATION_LANGUAGE;
	return typeof language === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$|^multi$/.test(language)
		? language
		: null;
}

/** The language for the on-device engine: "multi" becomes the phone's language. */
export function onDeviceLanguage(language: string, phoneLocale: string): string {
	return language === "multi" ? phoneLocale || DEFAULT_DICTATION_LANGUAGE : language;
}

export function createLanguageSource(fetchMac: () => typeof globalThis.fetch | null) {
	let last: string | null = null;
	return {
		/** The Mac's language, or the last known one, or "en". Never throws. */
		async get(): Promise<string> {
			const request = fetchMac();
			if (request) {
				try {
					const res = await request("/api/settings");
					if (res.ok) {
						const language = languageFromSettings(await res.json());
						if (language) last = language;
					}
				} catch {
					// The Mac is not reachable: use the last known language.
				}
			}
			return last ?? DEFAULT_DICTATION_LANGUAGE;
		},
		last: () => last,
	};
}
