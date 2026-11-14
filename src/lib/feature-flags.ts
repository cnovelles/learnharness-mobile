/**
 * Feature flags for the phone app. Each build has defaults; the learner can
 * change them on this phone in the hidden developer section of Settings.
 * There are no remote flags: the free path has no server.
 *
 * Rules:
 * - At least one mode is always on. If all modes are off, Mac remote comes back on.
 * - A mode that is turned off moves the learner to the first mode that is on
 *   (resolveMode). The caller syncs first when it can (issue 11).
 * - A flag change never deletes learner data.
 *
 * Build defaults come from EXPO_PUBLIC_LH_FLAGS, for example
 * "onPhone=1,cloudHost=0". Expo puts the value into the bundle at build time.
 */

export type ModeId = "macRemote" | "onPhone" | "cloudHost";
export type FlagName = ModeId;
export type Flags = Record<FlagName, boolean>;
export type FlagOverrides = Partial<Flags>;

/** The modes in the order that Settings shows them and resolveMode tries them. */
export const MODES: readonly { id: ModeId; title: string; detail: string }[] = [
	{
		id: "macRemote",
		title: "Mac remote",
		detail: "Lessons run on your Mac. The desktop app must be open.",
	},
	{
		id: "onPhone",
		title: "On phone",
		detail: "Lessons run on this phone. Changes sync to the Mac later.",
	},
	{ id: "cloudHost", title: "Cloud host", detail: "Lessons run on your own server." },
];

const FLAG_NAMES: readonly FlagName[] = MODES.map((m) => m.id);

/** Only finished modes are on by default. */
export const BASE_DEFAULTS: Flags = Object.freeze({
	macRemote: true,
	cloudHost: false,
	onPhone: false,
});

function isFlagName(name: string): name is FlagName {
	return (FLAG_NAMES as readonly string[]).includes(name);
}

export function parseBuildFlags(raw: string | undefined): { flags: Flags; errors: string[] } {
	const flags: Flags = { ...BASE_DEFAULTS };
	const errors: string[] = [];
	for (const part of (raw ?? "").split(",")) {
		const item = part.trim();
		if (!item) continue;
		const eq = item.indexOf("=");
		if (eq < 0) {
			errors.push(`${item}: use name=1 or name=0, not "${item}"`);
			continue;
		}
		const name = item.slice(0, eq).trim();
		const value = item.slice(eq + 1).trim();
		if (!isFlagName(name)) {
			errors.push(`${name}: unknown flag`);
			continue;
		}
		if (value !== "1" && value !== "0") {
			errors.push(`${name}: use 1 or 0, not "${value}"`);
			continue;
		}
		flags[name] = value === "1";
	}
	return { flags, errors };
}

/** Keeps only known names with boolean values (stored data can be old or damaged). */
function cleanOverrides(value: unknown): FlagOverrides {
	const out: FlagOverrides = {};
	if (!value || typeof value !== "object") return out;
	for (const [name, v] of Object.entries(value)) {
		if (isFlagName(name) && typeof v === "boolean") out[name] = v;
	}
	return out;
}

export function enabledModes(flags: Flags): ModeId[] {
	return MODES.map((m) => m.id).filter((id) => flags[id]);
}

export function effectiveFlags(defaults: Flags, overrides: FlagOverrides): Flags {
	const flags: Flags = { ...defaults, ...cleanOverrides(overrides) };
	if (enabledModes(flags).length === 0) flags.macRemote = true;
	return flags;
}

export function resolveMode(preferred: ModeId, flags: Flags): { mode: ModeId; changed: boolean } {
	if (flags[preferred]) return { mode: preferred, changed: false };
	// effectiveFlags guarantees one mode is on; macRemote is the last resort.
	return { mode: enabledModes(flags)[0] ?? "macRemote", changed: true };
}

export interface FlagStorage {
	read(): Promise<string | null>;
	write(value: string): Promise<void>;
	clear(): Promise<void>;
}

export interface FlagState {
	flags: Flags;
	overrides: FlagOverrides;
	/** The hidden developer section in Settings is open on this phone. */
	developer: boolean;
}

export interface FlagStore {
	state(): FlagState;
	subscribe(listener: () => void): () => void;
	load(): Promise<void>;
	set(name: FlagName, value: boolean): Promise<void>;
	reset(): Promise<void>;
	unlockDeveloper(): Promise<void>;
}

const RECORD_VERSION = 1;

export function createFlagStore({
	defaults,
	storage,
}: {
	defaults: Flags;
	storage: FlagStorage;
}): FlagStore {
	let state: FlagState = { flags: { ...defaults }, overrides: {}, developer: false };
	const listeners = new Set<() => void>();

	function make(overrides: FlagOverrides, developer: boolean): FlagState {
		return { flags: effectiveFlags(defaults, overrides), overrides, developer };
	}

	function publish(next: FlagState) {
		state = next;
		for (const l of listeners) l();
	}

	/** Saves first; the state changes only after the save succeeds. */
	async function commit(next: FlagState) {
		await storage.write(
			JSON.stringify({ v: RECORD_VERSION, overrides: next.overrides, developer: next.developer }),
		);
		publish(next);
	}

	return {
		state: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async load() {
			const raw = await storage.read();
			if (raw === null) return;
			try {
				const parsed = JSON.parse(raw) as { v?: unknown; overrides?: unknown; developer?: unknown };
				if (parsed.v === RECORD_VERSION) {
					publish(make(cleanOverrides(parsed.overrides), parsed.developer === true));
					return;
				}
			} catch {
				/* damaged record: use the build defaults */
			}
			publish(make({}, false));
		},
		async set(name, value) {
			const overrides: FlagOverrides = { ...state.overrides };
			if (value === defaults[name]) delete overrides[name];
			else overrides[name] = value;
			// Check the raw values: effectiveFlags would turn Mac remote back on silently.
			if (enabledModes({ ...defaults, ...overrides }).length === 0)
				throw new Error("At least one mode must stay on.");
			await commit(make(overrides, state.developer));
		},
		async reset() {
			await commit(make({}, state.developer));
		},
		async unlockDeveloper() {
			if (!state.developer) await commit(make(state.overrides, true));
		},
	};
}
