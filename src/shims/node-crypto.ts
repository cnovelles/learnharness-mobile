/**
 * Replacement for `node:crypto` in the shared LearnHarness code (Metro maps
 * the import here). It covers only what the shared code uses:
 *  - createHash("sha256").update(...).digest("hex")  (src/core/coverage.ts)
 *  - randomBytes(n).toString("hex")                  (src/core/graph.ts)
 *  - randomUUID()
 * Results are byte-identical to Node's, so fingerprints match the desktop.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

type Input = string | Uint8Array;

class Sha256Hash {
	private readonly state = sha256.create();
	update(data: Input): this {
		this.state.update(typeof data === "string" ? utf8ToBytes(data) : data);
		return this;
	}
	digest(encoding?: "hex"): string | Uint8Array {
		const out = this.state.digest();
		return encoding === "hex" ? bytesToHex(out) : out;
	}
}

export function createHash(algorithm: string): Sha256Hash {
	if (algorithm.toLowerCase() !== "sha256") throw new Error(`createHash: only sha256 is available on the phone, not ${algorithm}`);
	return new Sha256Hash();
}

class RandomBytes extends Uint8Array {
	toString(encoding?: string): string {
		if (encoding === "hex") return bytesToHex(this);
		throw new Error(`randomBytes().toString: only "hex" is available on the phone, not ${encoding}`);
	}
}

export function randomBytes(size: number): RandomBytes {
	const out = new RandomBytes(size);
	globalThis.crypto.getRandomValues(out);
	return out;
}

export function randomUUID(): string {
	return globalThis.crypto.randomUUID();
}

export default { createHash, randomBytes, randomUUID };
