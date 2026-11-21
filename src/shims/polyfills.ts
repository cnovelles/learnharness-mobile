/**
 * Web APIs that the shared LearnHarness code expects and that Hermes may not
 * provide. Import this file first (src/app/_layout.tsx).
 */
import * as ExpoCrypto from "expo-crypto";

import { fixMatchAll } from "./match-all";

// Hermes drops the groups of matchAll matches (Shiki needs them).
fixMatchAll();

const g = globalThis as unknown as {
	crypto?: { getRandomValues?: <T extends ArrayBufferView>(a: T) => T; randomUUID?: () => string };
	DOMException?: unknown;
};

g.crypto ??= {};
if (typeof g.crypto.getRandomValues !== "function") {
	g.crypto.getRandomValues = <T extends ArrayBufferView>(array: T): T =>
		ExpoCrypto.getRandomValues(array as never) as T;
}
if (typeof g.crypto.randomUUID !== "function") {
	g.crypto.randomUUID = () => ExpoCrypto.randomUUID();
}

// components/session-core.ts rejects aborted waits with a DOMException.
if (typeof g.DOMException !== "function") {
	class DOMExceptionShim extends Error {
		constructor(message = "", name = "Error") {
			super(message);
			this.name = name;
		}
	}
	g.DOMException = DOMExceptionShim;
}
