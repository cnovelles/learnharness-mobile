/**
 * The app's Dictation native module (modules/dictation), or null where it
 * does not exist (Android, Jest). Tests mock this file.
 */
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { NativeDictation } from "../../modules/dictation/src";

export function nativeDictation(): NativeDictation | null {
	return Platform.OS === "ios" ? requireOptionalNativeModule<NativeDictation>("Dictation") : null;
}
