/**
 * The app's one perf store (issue 21 slice A): src/lib/perf-marks.ts with
 * the real clock, frames, build and file. The opens are saved in
 * `Documents/perf-opens.json`: "Share results" sends that file, and
 * `npm run perf:collect` reads it from a Simulator.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { createPerfStore, type BuildInfo, type PerfStore } from "./perf-marks";

/** The file name in the Documents folder. perf:collect reads the same name. */
export const PERF_FILE = "perf-opens.json";

export function perfFile(): File {
	return new File(Paths.document, PERF_FILE);
}

function build(): BuildInfo {
	const extra = Constants.expoConfig?.extra as { commit?: unknown } | undefined;
	return {
		type: __DEV__ ? "dev" : "release",
		commit: typeof extra?.commit === "string" ? extra.commit : "unknown",
		// On a Simulator, modelName is "Simulator iOS"; the device name is the model.
		device: Device.isDevice
			? (Device.modelName ?? "unknown")
			: `${Device.deviceName ?? "unknown"} (Simulator)`,
		os: `${Platform.OS} ${String(Platform.Version)}`,
	};
}

export const perf: PerfStore = createPerfStore({
	now: () => performance.now(),
	date: () => new Date(),
	build,
	frames(frame) {
		let id = requestAnimationFrame(function loop() {
			frame(performance.now());
			id = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(id);
	},
	load() {
		const file = perfFile();
		return file.exists ? file.textSync() : null;
	},
	save(text) {
		const file = perfFile();
		if (!file.exists) file.create();
		file.write(text);
	},
});
