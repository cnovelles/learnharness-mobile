/**
 * Hermes bug (found 2026-11-14, Hermes 260318099.0.5 in Expo SDK 58): the
 * matches from `String.prototype.matchAll` have no `groups`.
 * `RegExp.prototype.exec` is correct. Shiki's JavaScript regex engine
 * (through `regex-utilities`) reads `groups` from `matchAll` and throws, so
 * most code blocks lose their colors (issue 05 slice B).
 *
 * `fixMatchAll` replaces `matchAll` with a version on top of `exec`, only
 * when the bug is there. On a correct engine (Node, a fixed Hermes) it does
 * nothing.
 */

/** True when `matchAll` gives the named groups of each match. */
export function matchAllKeepsGroups(): boolean {
	try {
		// A RegExp from a string: Babel can rewrite a literal with named groups.
		const first = "a".matchAll(new RegExp("(?<g>a)", "g")).next().value;
		return first?.groups?.g === "a";
	} catch {
		return false;
	}
}

/** The index after `index`, one code point on for a unicode RegExp. */
function advance(text: string, index: number, unicode: boolean): number {
	if (!unicode || index + 1 >= text.length) return index + 1;
	const high = text.charCodeAt(index);
	const low = text.charCodeAt(index + 1);
	const pair = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
	return index + (pair ? 2 : 1);
}

function matchAll(this: unknown, pattern: RegExp | string): RegExpStringIterator<RegExpExecArray> {
	if (this == null) throw new TypeError("String.prototype.matchAll called on null or undefined");
	const text = String(this);
	let re: RegExp;
	if (pattern instanceof RegExp) {
		if (!pattern.flags.includes("g")) {
			throw new TypeError("String.prototype.matchAll needs a global RegExp");
		}
		// A copy, so the caller's lastIndex does not change (as in the spec).
		re = new RegExp(pattern, pattern.flags);
		re.lastIndex = pattern.lastIndex;
	} else {
		re = new RegExp(pattern, "g");
	}
	const unicode = re.flags.includes("u") || re.flags.includes("v");
	let done = false;
	const iterator = {
		next(): IteratorResult<RegExpExecArray, undefined> {
			if (done) return { value: undefined, done: true };
			const match = re.exec(text);
			if (match === null) {
				done = true;
				return { value: undefined, done: true };
			}
			// An empty match must move on, or the loop never ends.
			if (match[0] === "") re.lastIndex = advance(text, re.lastIndex, unicode);
			return { value: match, done: false };
		},
		[Symbol.iterator]() {
			return iterator;
		},
	};
	return iterator as unknown as RegExpStringIterator<RegExpExecArray>;
}

/** Replaces `matchAll` when it drops the groups. True when it replaced it. */
export function fixMatchAll(): boolean {
	if (matchAllKeepsGroups()) return false;
	// eslint-disable-next-line no-extend-native -- the fix for the Hermes bug above
	Object.defineProperty(String.prototype, "matchAll", {
		configurable: true,
		writable: true,
		value: matchAll,
	});
	return true;
}
