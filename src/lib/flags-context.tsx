/**
 * React access to the feature flags. One store for the app. The overrides
 * are saved on this phone only (expo-secure-store, this device only); they
 * are not secret, but the store is already in the app and survives restarts.
 */
import * as SecureStore from "expo-secure-store";
import {
	createContext,
	use,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import {
	createFlagStore,
	parseBuildFlags,
	type FlagState,
	type FlagStorage,
	type FlagStore,
} from "./feature-flags";

const KEY = "lh.flags.v1";
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureFlagStorage: FlagStorage = {
	read: () => SecureStore.getItemAsync(KEY, OPTIONS),
	write: (value) => SecureStore.setItemAsync(KEY, value, OPTIONS),
	clear: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
};

/** Build defaults. Expo replaces process.env.EXPO_PUBLIC_* at build time. */
export function buildDefaults() {
	const { flags, errors } = parseBuildFlags(process.env.EXPO_PUBLIC_LH_FLAGS);
	for (const e of errors) console.warn(`EXPO_PUBLIC_LH_FLAGS: ${e}`);
	return flags;
}

const FlagContext = createContext<FlagStore | null>(null);

export function FlagsProvider({
	children,
	store: injected,
}: {
	children: ReactNode;
	store?: FlagStore;
}) {
	const [store] = useState(
		() => injected ?? createFlagStore({ defaults: buildDefaults(), storage: secureFlagStorage }),
	);
	const loaded = useRef(false);
	useEffect(() => {
		if (loaded.current) return;
		loaded.current = true;
		// A failed read keeps the build defaults; flags are never a reason to stop the app.
		store.load().catch((e: unknown) => console.warn("feature flags: load failed", e));
	}, [store]);
	return <FlagContext value={store}>{children}</FlagContext>;
}

export function useFlags(): { state: FlagState; store: FlagStore } {
	const store = use(FlagContext);
	if (!store) throw new Error("useFlags must be used inside FlagsProvider");
	const state = useSyncExternalStore(store.subscribe, store.state, store.state);
	return { state, store };
}
