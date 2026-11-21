/**
 * The app's PinnedFetch: the local Expo module modules/pinned-fetch. Every
 * request to the Mac goes through it (pairing, ping, API, streams).
 */
import { requireNativeModule } from "expo-modules-core";
import { createPinnedFetch, type NativePinnedFetch } from "../../modules/pinned-fetch/src";
import type { PinnedFetch } from "./pairing";

let instance: PinnedFetch | null = null;

export function nativePinnedFetch(): PinnedFetch {
	instance ??= createPinnedFetch(requireNativeModule<NativePinnedFetch>("PinnedFetch"));
	return instance;
}
