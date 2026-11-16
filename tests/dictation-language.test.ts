import {
	createLanguageSource,
	DEFAULT_DICTATION_LANGUAGE,
	languageFromSettings,
	onDeviceLanguage,
} from "../src/lib/dictation-language";

test("the language comes from the Mac settings body", () => {
	expect(languageFromSettings({ settings: { dictation: { language: "es" } } })).toBe("es");
	expect(languageFromSettings({ settings: { dictation: { language: "multi" } } })).toBe("multi");
	expect(languageFromSettings({ settings: { dictation: { language: "pt-BR" } } })).toBe("pt-BR");
	// Never saved, or no dictation section: the desktop's factory value.
	expect(languageFromSettings({ settings: null })).toBe(DEFAULT_DICTATION_LANGUAGE);
	expect(languageFromSettings({ settings: {} })).toBe(DEFAULT_DICTATION_LANGUAGE);
	// A body that is not a settings body.
	expect(languageFromSettings({ error: "x" })).toBeNull();
	expect(languageFromSettings("x")).toBeNull();
	expect(languageFromSettings({ settings: { dictation: { language: "<script>" } } })).toBeNull();
});

test("multi means the phone's language for the on-device engine", () => {
	expect(onDeviceLanguage("multi", "de-DE")).toBe("de-DE");
	expect(onDeviceLanguage("multi", "")).toBe("en");
	expect(onDeviceLanguage("fr", "de-DE")).toBe("fr");
});

function response(status: number, body: unknown) {
	return { ok: status < 300, status, json: async () => body } as Response;
}

test("a Mac that is not reachable gives the last known language, else en", async () => {
	let mode: "ok" | "down" | "500" = "ok";
	const fetchMac = (async () => {
		if (mode === "down") throw new TypeError("Network request failed");
		if (mode === "500") return response(500, {});
		return response(200, { settings: { dictation: { language: "es" } } });
	}) as unknown as typeof fetch;

	const first = createLanguageSource(() => fetchMac);
	mode = "down";
	expect(await first.get()).toBe("en");

	const source = createLanguageSource(() => fetchMac);
	mode = "ok";
	expect(await source.get()).toBe("es");
	mode = "down";
	expect(await source.get()).toBe("es");
	mode = "500";
	expect(await source.get()).toBe("es");
	// Not paired (no fetch): the last known language.
	expect(await createLanguageSource(() => null).get()).toBe("en");
});
