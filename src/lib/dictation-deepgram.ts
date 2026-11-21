/**
 * The Deepgram engine (issue 07 slice E). The Mac keeps the Deepgram key and
 * makes a short-lived token (`GET /api/stt/token`, through the pinned
 * gateway). The native side (modules/dictation/ios/DeepgramRun.swift) opens
 * the socket to api.deepgram.com only and streams the microphone. See
 * docs/TRANSPORT-SECURITY.md, "Deepgram".
 */
import type { DictationEngine, DictationRunHandlers } from "./dictation";
import type { NativeDictation } from "../../modules/dictation/src";
import { nativeCode } from "../../modules/dictation/src";

/** The token from the Mac, or an engine code as the error message. */
export async function deepgramToken(fetchMac: typeof globalThis.fetch | null): Promise<string> {
	if (!fetchMac) throw new Error("mac-unreachable");
	let res: Response;
	try {
		res = await fetchMac("/api/stt/token");
	} catch {
		throw new Error("mac-unreachable");
	}
	if (res.status === 503) throw new Error("deepgram-no-key");
	if (!res.ok) throw new Error("deepgram-grant");
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new Error("deepgram-grant");
	}
	const token = (body as { token?: unknown } | null)?.token;
	if (typeof token !== "string" || !token) throw new Error("deepgram-grant");
	return token;
}

export function createDeepgramEngine(
	native: NativeDictation,
	fetchMac: () => typeof globalThis.fetch | null,
): DictationEngine {
	return {
		kind: "deepgram",
		supported: () => true,
		microphone: () => native.microphonePermission(),
		requestMicrophone: () => native.requestMicrophone(),
		// Deepgram has no model on the phone.
		model: async () => "installed",
		install: async () => {},
		async start(id: string, language: string, handlers: DictationRunHandlers) {
			const token = await deepgramToken(fetchMac());
			const subs = [
				native.addListener("speechLevel", (e) => {
					if (e.id === id) handlers.onLevel(e.level);
				}),
				native.addListener("speechText", (e) => {
					if (e.id === id) handlers.onText(e.text);
				}),
				native.addListener("speechEnd", (e) => {
					if (e.id !== id) return;
					for (const s of subs) s.remove();
					handlers.onEnd({ error: e.error, reason: e.reason });
				}),
			];
			try {
				await native.startDeepgram(id, language, token);
			} catch (error) {
				for (const s of subs) s.remove();
				throw new Error(nativeCode(error));
			}
		},
		stop: () => native.stop(),
		cancel: () => native.cancel(),
	};
}
