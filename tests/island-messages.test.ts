/** Issue 05 slice C: the app reads island messages as untrusted (error state 11). */
import { MAX_ISLAND_HEIGHT, parseIslandMessage } from "@/lib/island-messages";

const msg = (value: unknown) => parseIslandMessage(JSON.stringify(value));

describe("parseIslandMessage", () => {
	it("reads the known messages", () => {
		expect(msg({ type: "height", height: 41.2 })).toEqual({ type: "height", height: 42 });
		expect(msg({ type: "link", index: 2 })).toEqual({ type: "link", index: 2 });
		expect(msg({ type: "longpress" })).toEqual({ type: "longpress" });
		expect(msg({ type: "rendered" })).toEqual({ type: "rendered" });
		expect(msg({ type: "wide", wide: true })).toEqual({ type: "wide", wide: true });
		expect(msg({ type: "wide", wide: "yes" })).toBeNull();
		expect(msg({ type: "error", kind: "parse" })).toEqual({ type: "error", kind: "parse" });
	});

	it("11. refuses a missing, wrong or out-of-range height", () => {
		for (const height of [undefined, "40", null, 0, -5, MAX_ISLAND_HEIGHT + 1]) {
			expect(msg({ type: "height", height })).toBeNull();
		}
		expect(parseIslandMessage('{"type":"height","height":1e999}')).toBeNull();
		expect(parseIslandMessage('{"type":"height","height":NaN}')).toBeNull();
	});

	it("refuses anything else", () => {
		expect(parseIslandMessage(undefined)).toBeNull();
		expect(parseIslandMessage("not json")).toBeNull();
		expect(parseIslandMessage("null")).toBeNull();
		expect(parseIslandMessage(JSON.stringify({ type: "x".repeat(2000) }))).toBeNull();
		expect(msg({ type: "navigate", url: "https://a.b" })).toBeNull();
		expect(msg({ type: "link", index: -1 })).toBeNull();
		expect(msg({ type: "link", index: 1.5 })).toBeNull();
		expect(msg({ type: "error", kind: "boom" })).toBeNull();
	});
});
