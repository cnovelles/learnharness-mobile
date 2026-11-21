/**
 * The matchAll shim for the Hermes bug (src/shims/match-all.ts). Node's
 * matchAll is correct, so each test puts a copy of the Hermes bug in place
 * first: matches with no `groups`. The tests make each RegExp from a string,
 * because Jest's Babel rewrites literals with named groups or the `u` flag.
 */
import { fixMatchAll, matchAllKeepsGroups } from "@/shims/match-all";

const original = Object.getOwnPropertyDescriptor(String.prototype, "matchAll")!;

function breakMatchAll() {
	const real = original.value as typeof String.prototype.matchAll;
	Object.defineProperty(String.prototype, "matchAll", {
		configurable: true,
		writable: true,
		value: function* (this: string, re: RegExp) {
			for (const m of real.call(this, re)) {
				const copy = [...m] as unknown as RegExpExecArray;
				copy.index = m.index;
				copy.input = m.input;
				yield copy;
			}
		},
	});
}

afterEach(() => {
	Object.defineProperty(String.prototype, "matchAll", original);
});

describe("fixMatchAll", () => {
	it("does nothing on an engine with a correct matchAll", () => {
		expect(matchAllKeepsGroups()).toBe(true);
		expect(fixMatchAll()).toBe(false);
		expect(String.prototype.matchAll).toBe(original.value);
	});

	it("finds the Hermes bug and gives the groups back", () => {
		breakMatchAll();
		expect(matchAllKeepsGroups()).toBe(false);
		expect(fixMatchAll()).toBe(true);
		expect(matchAllKeepsGroups()).toBe(true);
		const found = [..."a1 b2".matchAll(new RegExp("(?<letter>[a-z])(?<digit>\\d)", "g"))];
		expect(found.map((m) => [m[0], m.index, m.groups?.letter, m.groups?.digit])).toEqual([
			["a1", 0, "a", "1"],
			["b2", 3, "b", "2"],
		]);
	});

	it("reads the regex-utilities pattern that failed on Hermes", () => {
		breakMatchAll();
		fixMatchAll();
		const re = new RegExp(String.raw`\\(\d+)|(?<$skip>\[\^?|\\?.)`, "gsu");
		const skips = [..."a[^b]\\1".matchAll(re)].map((m) => m.groups?.$skip ?? null);
		expect(skips).toEqual(["a", "[^", "b", "]", null]);
	});

	it("matches the spec: empty matches move on, the caller's lastIndex stays", () => {
		breakMatchAll();
		fixMatchAll();
		const re = new RegExp("x*", "gu");
		re.lastIndex = 1;
		expect([..."a😀".matchAll(re)].map((m) => m.index)).toEqual([1, 3]);
		expect(re.lastIndex).toBe(1);
		expect([..."aXa".matchAll("a" as unknown as RegExp)].map((m) => m.index)).toEqual([0, 2]);
		expect(() => "a".matchAll(/a/)).toThrow(TypeError);
	});
});
