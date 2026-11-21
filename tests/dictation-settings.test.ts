import {
	createEngineChoiceStore,
	DEFAULT_ENGINE,
	parseChoice,
	SAVE_FAILED,
} from "../src/lib/dictation-settings";

test("the stored value parses; anything else is the default", () => {
	expect(parseChoice("deepgram")).toBe("deepgram");
	expect(parseChoice("on-device")).toBe("on-device");
	expect(parseChoice(null)).toBe(DEFAULT_ENGINE);
	expect(parseChoice("cloud")).toBe(DEFAULT_ENGINE);
	expect(DEFAULT_ENGINE).toBe("on-device");
});

test("load, set and keep the choice", async () => {
	let stored: string | null = "deepgram";
	const store = createEngineChoiceStore({
		read: async () => stored,
		write: async (v) => {
			stored = v;
		},
	});
	expect(store.current()).toBe("on-device");
	await store.load();
	expect(store.getSnapshot()).toMatchObject({ choice: "deepgram", loaded: true, error: null });
	expect(await store.set("on-device")).toBe(true);
	expect(stored).toBe("on-device");
	expect(store.current()).toBe("on-device");
});

test("an unreadable Keychain value gives the default", async () => {
	const store = createEngineChoiceStore({
		read: async () => {
			throw new Error("keychain");
		},
		write: async () => {},
	});
	await store.load();
	expect(store.getSnapshot()).toMatchObject({ choice: "on-device", loaded: true });
});

test("a failed save keeps the old choice and shows a message; the next good save clears it", async () => {
	let fail = true;
	const store = createEngineChoiceStore({
		read: async () => null,
		write: async () => {
			if (fail) throw new Error("keychain");
		},
	});
	await store.load();
	expect(await store.set("deepgram")).toBe(false);
	expect(store.getSnapshot()).toMatchObject({ choice: "on-device", error: SAVE_FAILED });
	fail = false;
	expect(await store.set("deepgram")).toBe(true);
	expect(store.getSnapshot()).toMatchObject({ choice: "deepgram", error: null });
});
