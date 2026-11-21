/**
 * Feature flags: build defaults, local overrides, and the mode rules
 * (at least one mode is always on; a turned-off mode moves the learner to
 * the next mode that is on). No flag change ever deletes learner data.
 */
import {
	BASE_DEFAULTS,
	MODES,
	createFlagStore,
	effectiveFlags,
	enabledModes,
	parseBuildFlags,
	resolveMode,
	type FlagOverrides,
	type FlagStorage,
} from "@/lib/feature-flags";

function memoryStorage(initial: string | null = null): FlagStorage & { value: string | null } {
	const s = {
		value: initial,
		async read() {
			return s.value;
		},
		async write(v: string) {
			s.value = v;
		},
		async clear() {
			s.value = null;
		},
	};
	return s;
}

describe("build defaults", () => {
	it("turn on only Mac remote when the build sets nothing", () => {
		expect(parseBuildFlags(undefined)).toEqual({ flags: BASE_DEFAULTS, errors: [] });
		expect(BASE_DEFAULTS).toEqual({ macRemote: true, cloudHost: false, onPhone: false });
	});

	it("read EXPO_PUBLIC_LH_FLAGS as name=1 or name=0 pairs", () => {
		expect(parseBuildFlags("onPhone=1, macRemote=0").flags).toEqual({
			macRemote: false,
			cloudHost: false,
			onPhone: true,
		});
	});

	it("report unknown names and bad values, and keep the base value for them", () => {
		const r = parseBuildFlags("onPhone=yes,teleport=1,cloudHost");
		expect(r.flags).toEqual(BASE_DEFAULTS);
		expect(r.errors).toEqual([
			'onPhone: use 1 or 0, not "yes"',
			"teleport: unknown flag",
			'cloudHost: use name=1 or name=0, not "cloudHost"',
		]);
	});
});

describe("effective flags", () => {
	it("a local override wins over the build default", () => {
		expect(effectiveFlags(BASE_DEFAULTS, { onPhone: true }).onPhone).toBe(true);
		expect(effectiveFlags({ ...BASE_DEFAULTS, onPhone: true }, { onPhone: false }).onPhone).toBe(
			false,
		);
	});

	it("never leave all modes off: Mac remote comes back on", () => {
		const all: FlagOverrides = { macRemote: false, cloudHost: false, onPhone: false };
		expect(enabledModes(effectiveFlags(BASE_DEFAULTS, all))).toEqual(["macRemote"]);
	});

	it("ignore stored overrides with unknown names or values that are not true or false", () => {
		const junk = { teleport: true, onPhone: "yes" } as unknown as FlagOverrides;
		expect(effectiveFlags(BASE_DEFAULTS, junk)).toEqual(BASE_DEFAULTS);
	});
});

describe("mode resolution", () => {
	it("keep the preferred mode while it is on", () => {
		const flags = { macRemote: true, cloudHost: false, onPhone: true };
		expect(resolveMode("onPhone", flags)).toEqual({ mode: "onPhone", changed: false });
	});

	it("move a learner off a turned-off mode to the first mode that is on", () => {
		expect(resolveMode("onPhone", BASE_DEFAULTS)).toEqual({ mode: "macRemote", changed: true });
		const phoneOnly = { macRemote: false, cloudHost: false, onPhone: true };
		expect(resolveMode("macRemote", phoneOnly)).toEqual({ mode: "onPhone", changed: true });
	});

	it("list the modes in a fixed order", () => {
		expect(MODES.map((m) => m.id)).toEqual(["macRemote", "onPhone", "cloudHost"]);
	});
});

describe("flag store", () => {
	it("starts from the build defaults and loads saved overrides", async () => {
		const storage = memoryStorage(JSON.stringify({ v: 1, overrides: { onPhone: true } }));
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage });
		expect(store.state().flags).toEqual(BASE_DEFAULTS);
		await store.load();
		expect(store.state().flags.onPhone).toBe(true);
		expect(store.state().overrides).toEqual({ onPhone: true });
	});

	it("saves a change and tells subscribers", async () => {
		const storage = memoryStorage();
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage });
		await store.load();
		const seen: boolean[] = [];
		store.subscribe(() => seen.push(store.state().flags.cloudHost));
		await store.set("cloudHost", true);
		expect(seen).toEqual([true]);
		expect(JSON.parse(storage.value!)).toEqual({
			v: 1,
			overrides: { cloudHost: true },
			developer: false,
		});
	});

	it("refuses to turn off the last mode that is on", async () => {
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage: memoryStorage() });
		await store.load();
		await expect(store.set("macRemote", false)).rejects.toThrow("At least one mode must stay on.");
		expect(store.state().flags.macRemote).toBe(true);
	});

	it("stores no override when the value equals the build default", async () => {
		const storage = memoryStorage();
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage });
		await store.load();
		await store.set("onPhone", true);
		await store.set("onPhone", false);
		expect(store.state().overrides).toEqual({});
	});

	it("reset removes all overrides and keeps the developer section open", async () => {
		const storage = memoryStorage();
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage });
		await store.load();
		await store.unlockDeveloper();
		await store.set("onPhone", true);
		await store.reset();
		expect(store.state()).toMatchObject({ flags: BASE_DEFAULTS, overrides: {}, developer: true });
	});

	it("a damaged saved record falls back to the build defaults", async () => {
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage: memoryStorage("{oops") });
		await store.load();
		expect(store.state()).toMatchObject({ flags: BASE_DEFAULTS, overrides: {}, developer: false });
	});

	it("a failed save keeps the old state, so the screen never shows an unsaved value", async () => {
		const storage = memoryStorage();
		storage.write = async () => {
			throw new Error("disk full");
		};
		const store = createFlagStore({ defaults: BASE_DEFAULTS, storage });
		await store.load();
		await expect(store.set("onPhone", true)).rejects.toThrow("disk full");
		expect(store.state().flags.onPhone).toBe(false);
	});
});
