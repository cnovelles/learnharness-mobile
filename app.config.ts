/**
 * The app config: app.json, plus the git commit of the build in
 * `extra.commit` (issue 21 slice A). Each timing result keeps the commit,
 * so the results of two builds never mix. "-dirty" marks a build with
 * changed files.
 */
import { execFileSync } from "node:child_process";
import type { ConfigContext, ExpoConfig } from "expo/config";

function commit(): string {
	try {
		const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: __dirname })
			.toString()
			.trim();
		const dirty =
			execFileSync("git", ["status", "--porcelain"], { cwd: __dirname }).toString().trim() !== "";
		return dirty ? `${sha}-dirty` : sha;
	} catch {
		return "unknown";
	}
}

export default ({ config }: ConfigContext): ExpoConfig =>
	({
		...config,
		extra: { ...config.extra, commit: commit() },
	}) as ExpoConfig;
