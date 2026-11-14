/// <reference types="node" />
/**
 * src/shims/node-crypto.ts must give byte-identical results to Node's
 * crypto for what the shared code uses. The strongest check: the fork's real
 * coverage fingerprint (src/core/coverage.ts), run once with the shim and
 * by the fork with Node, over the golden fixture chats.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import nodeCrypto from "node:crypto";
import * as shim from "@/shims/node-crypto";

const FORK = path.resolve(__dirname, "../../learnharness");

const nodeHex = (...parts: (string | Uint8Array)[]) => {
	const h = nodeCrypto.createHash("sha256");
	for (const p of parts) h.update(p);
	return h.digest("hex");
};
const shimHex = (...parts: (string | Uint8Array)[]) => {
	const h = shim.createHash("sha256");
	for (const p of parts) h.update(p);
	return h.digest("hex");
};

describe('createHash("sha256")', () => {
	it.each([
		["empty", [""]],
		["ascii", ["hello world"]],
		["unicode and emoji", ["Ångström — 東京 🌊 $\\frac{1}{2}$"]],
		["several updates", ["a", "b", JSON.stringify(["assistant", ["line 1", "line 2"]])]],
		["bytes", [new Uint8Array([0, 1, 2, 255])]],
		["long input", ["x".repeat(100_000)]],
	])("matches Node for %s", (_name, parts) => {
		expect(shimHex(...(parts as (string | Uint8Array)[]))).toBe(
			nodeHex(...(parts as (string | Uint8Array)[])),
		);
	});

	it("returns raw bytes without an encoding", () => {
		const raw = shim.createHash("sha256").update("abc").digest() as Uint8Array;
		expect(Buffer.from(raw).toString("hex")).toBe(nodeHex("abc"));
	});

	it("refuses other algorithms with a clear message", () => {
		expect(() => shim.createHash("md5")).toThrow("only sha256");
	});
});

describe("randomBytes and randomUUID", () => {
	it("gives hex of the right length and differs between calls", () => {
		const a = shim.randomBytes(6).toString("hex");
		const b = shim.randomBytes(6).toString("hex");
		expect(a).toMatch(/^[0-9a-f]{12}$/);
		expect(a).not.toBe(b);
		expect(() => shim.randomBytes(2).toString("base64")).toThrow('only "hex"');
	});

	it("gives a v4 UUID", () => {
		expect(shim.randomUUID()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});
});

describe("the fork's coverage fingerprint", () => {
	// Jest cannot load the fork's ESM-only dependencies (typebox), so a tsx
	// script in the fork computes the real fingerprints with Node and the
	// exact strings they hash. The shim must give the same digest.
	it("is identical with the shim for every golden message", () => {
		const script = path.join(__dirname, "helpers/fork-fingerprints.mts");
		const stdout = execFileSync(path.join(FORK, "node_modules/.bin/tsx"), [script, FORK], {
			cwd: FORK,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		const pairs = JSON.parse(stdout) as { input: string; digest: string }[];
		expect(pairs.length).toBeGreaterThan(10);
		for (const { input, digest } of pairs) expect(shimHex(input)).toBe(digest);
	}, 60_000);
});
