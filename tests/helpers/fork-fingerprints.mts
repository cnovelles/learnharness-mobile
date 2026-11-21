/**
 * ESM (.mts) for top-level await. Run with tsx from the fork folder (see tests/node-crypto-shim.test.ts).
 * Prints, for each golden fixture message, the exact string that the fork's
 * messageFingerprint hashes and the digest that Node's crypto gives for it.
 * It fails if that string does not reproduce the real fingerprint, so the
 * phone test can trust the pairs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const fork = process.argv[2]!;
const { messageFingerprint, messageViewLines } = await import(
	path.join(fork, "src/core/coverage.ts")
);
const dir = path.join(fork, "tests/fixtures/golden-data/chats");
const out: { input: string; digest: string }[] = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
	for (const m of JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).messages ?? []) {
		const input = JSON.stringify([m.role, messageViewLines(m, m.id)]);
		const digest = messageFingerprint(m);
		if (createHash("sha256").update(input).digest("hex") !== digest)
			throw new Error(`hash input drifted from messageFingerprint for ${m.id}`);
		out.push({ input, digest });
	}
}
process.stdout.write(JSON.stringify(out));
