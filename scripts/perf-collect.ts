/**
 * Collect the session open timings (issue 21 slice A) into perf/results.
 *
 *   npm run perf:collect                      # the booted Simulator
 *   npm run perf:collect -- --device <udid>   # another Simulator
 *   npm run perf:collect -- --file <path>     # a file from "Share results" (iPhone, AirDrop)
 *
 * The app keeps the last 50 opens in Documents/perf-opens.json. This script
 * splits them by build (type, commit, device) and merges each group into
 * perf/results/<commit>-<type>-<device>.json, without duplicates. Then it
 * prints the median and the p95 of each build and phase.
 *
 * A "-dirty" commit is a build with changed files: keep its numbers out of
 * a decision (docs/DECISIONS.md, measurement rules).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	PHASES,
	RESULT_VERSION,
	formatMs,
	parseOpens,
	phaseTimes,
	quantile,
	summarize,
	type OpenRecord,
	type PerfExport,
} from "../src/lib/perf-marks";

const BUNDLE_ID = "dev.local.learnharnessmobile";
const FILE_NAME = "perf-opens.json"; // src/lib/perf.ts PERF_FILE
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "perf", "results");

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

function sourceText(): { text: string; from: string } {
	const file = arg("--file");
	if (file) return { text: readFileSync(file, "utf8"), from: file };
	const device = arg("--device") ?? "booted";
	const data = execFileSync("xcrun", ["simctl", "get_app_container", device, BUNDLE_ID, "data"])
		.toString()
		.trim();
	const p = path.join(data, "Documents", FILE_NAME);
	if (!existsSync(p))
		throw new Error(`No timings on the Simulator yet (${p}). Open a session first.`);
	return { text: readFileSync(p, "utf8"), from: p };
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-|-$/g, "");
const key = (o: OpenRecord) => `${o.at}|${o.chatId}`;

function resultName(o: OpenRecord): string {
	return `${slug(o.build.commit)}-${o.build.type}-${slug(o.build.device)}.json`;
}

function main() {
	const { text, from } = sourceText();
	const opens = parseOpens(text);
	if (opens.length === 0) throw new Error(`No opens in ${from}.`);
	mkdirSync(OUT, { recursive: true });
	const groups = new Map<string, OpenRecord[]>();
	for (const o of opens) groups.set(resultName(o), [...(groups.get(resultName(o)) ?? []), o]);
	for (const [name, group] of groups) {
		const file = path.join(OUT, name);
		const old = existsSync(file) ? parseOpens(readFileSync(file, "utf8")) : [];
		const seen = new Set(old.map(key));
		const merged = [...old, ...group.filter((o) => !seen.has(key(o)))].sort((a, b) =>
			a.at.localeCompare(b.at),
		);
		const body: PerfExport = {
			v: RESULT_VERSION,
			exportedAt: new Date().toISOString(),
			opens: merged,
		};
		writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
		const s = summarize(merged);
		const complete = merged.filter((o) => o.outcome === "end");
		console.log(
			`\n${path.relative(ROOT, file)}: ${merged.length} opens (${s.complete} reached the end)`,
		);
		console.log(`  total     median ${formatMs(s.medianMs)}  p95 ${formatMs(s.p95Ms)}`);
		for (const p of PHASES) {
			const values = complete.flatMap((o) => {
				const t = phaseTimes(o)[p.id];
				return t === null ? [] : [t];
			});
			console.log(
				`  ${p.id.padEnd(9)} median ${formatMs(quantile(values, 0.5))}  p95 ${formatMs(quantile(values, 0.95))}`,
			);
		}
		const frozen = complete.map((o) => o.longestFrameMs);
		console.log(
			`  frozen    median ${formatMs(quantile(frozen, 0.5))}  p95 ${formatMs(quantile(frozen, 0.95))}`,
		);
	}
}

try {
	main();
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
}
