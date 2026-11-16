/**
 * The top-to-bottom reveal (user decision 2026-11-15): a block shows only
 * when it and every block above it are ready, with a time limit for each
 * block at the front of the queue.
 */
import { REVEAL_LIMIT_MS, compareKeys, createRevealGate } from "@/lib/reveal-gate";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("compareKeys", () => {
	it("orders by each part, and a shorter prefix first", () => {
		expect(compareKeys([1], [2])).toBeLessThan(0);
		expect(compareKeys([2, 0], [1, 5])).toBeGreaterThan(0);
		expect(compareKeys([3], [3, 0])).toBeLessThan(0);
		expect(compareKeys([3, 1], [3, 1])).toBe(0);
	});
});

describe("createRevealGate", () => {
	it("shows ready blocks in order and stops at the first block that is not ready", () => {
		const gate = createRevealGate();
		gate.set("a", [0], true);
		gate.set("b", [1], false);
		gate.set("c", [2], true);
		expect(gate.view("a")).toBe("shown");
		expect(gate.view("b")).toBe("front");
		expect(gate.view("c")).toBe("hidden");
		gate.set("b", [1], true);
		expect(gate.view("b")).toBe("shown");
		expect(gate.view("c")).toBe("shown");
	});

	it("orders by key, not by the order of registration", () => {
		const gate = createRevealGate();
		gate.set("late", [5], true);
		gate.set("early", [1], false);
		expect(gate.view("early")).toBe("front");
		expect(gate.view("late")).toBe("hidden");
	});

	it("a block at the front shows after the time limit, and the blocks under it go on", () => {
		const gate = createRevealGate();
		gate.set("slow", [0], false);
		gate.set("next", [1], true);
		jest.advanceTimersByTime(REVEAL_LIMIT_MS - 1);
		expect(gate.view("slow")).toBe("front");
		jest.advanceTimersByTime(1);
		expect(gate.view("slow")).toBe("shown");
		expect(gate.view("next")).toBe("shown");
	});

	it("the time limit starts when the block comes to the front", () => {
		const gate = createRevealGate();
		gate.set("first", [0], false);
		gate.set("second", [1], false);
		jest.advanceTimersByTime(1000);
		gate.set("first", [0], true);
		expect(gate.view("second")).toBe("front");
		jest.advanceTimersByTime(1000);
		expect(gate.view("second")).toBe("front");
		jest.advanceTimersByTime(REVEAL_LIMIT_MS - 1000);
		expect(gate.view("second")).toBe("shown");
	});

	it("a shown block stays shown when it is not ready again (a streaming change)", () => {
		const gate = createRevealGate();
		gate.set("a", [0], true);
		gate.set("b", [1], true);
		gate.set("a", [0], false);
		expect(gate.view("a")).toBe("shown");
		expect(gate.view("b")).toBe("shown");
	});

	it("a removed block lets the blocks under it go on", () => {
		const gate = createRevealGate();
		gate.set("a", [0], false);
		gate.set("b", [1], true);
		gate.remove("a");
		expect(gate.view("b")).toBe("shown");
		expect(gate.view("a")).toBe("hidden");
	});

	it("tells subscribers about each change, and stops the timers on dispose", () => {
		const gate = createRevealGate();
		const seen = jest.fn();
		const off = gate.subscribe(seen);
		gate.set("a", [0], false);
		expect(seen).toHaveBeenCalled();
		off();
		gate.dispose();
		seen.mockClear();
		jest.advanceTimersByTime(REVEAL_LIMIT_MS * 2);
		expect(seen).not.toHaveBeenCalled();
		expect(gate.view("a")).toBe("front");
	});
});
