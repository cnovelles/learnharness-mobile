/**
 * A scripted dictation engine for the Simulator E2E flow (dev builds only,
 * EXPO_PUBLIC_LH_E2E_DICTATION_TEXT). The iOS Simulator runs SpeechAnalyzer
 * but gives no text (issue 07 slice F, 2026-11-16: 0 finals for a file that
 * macOS transcribes). So the flow tests the UI and the JS path with this
 * engine; tests/run-engine-test.sh tests the native engine on macOS.
 *
 * It "listens" with a moving level until Stop, then sends the text.
 */
import type { DictationEngine, DictationRunHandlers } from "./dictation";

export function createScriptedEngine(
	text: string,
	setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setInterval(fn, ms),
	clearTimer: (t: unknown) => void = (t) => clearInterval(t as ReturnType<typeof setInterval>),
): DictationEngine {
	let run: { handlers: DictationRunHandlers; timer: unknown } | null = null;
	let tick = 0;
	function end(withText: boolean) {
		if (!run) return;
		const { handlers, timer } = run;
		run = null;
		clearTimer(timer);
		if (withText) handlers.onText(text);
		handlers.onEnd(withText ? {} : { reason: "canceled" });
	}
	return {
		kind: "on-device",
		supported: () => true,
		microphone: () => "granted",
		requestMicrophone: async () => true,
		model: async () => "installed",
		install: async () => {},
		async start(_id, _language, handlers) {
			if (run) throw new Error("already-running");
			const timer = setTimer(() => {
				tick++;
				handlers.onLevel(0.02 + 0.08 * Math.abs(Math.sin(tick / 3)));
			}, 60);
			run = { handlers, timer };
		},
		async stop() {
			end(true);
		},
		async cancel() {
			end(false);
		},
	};
}
