import { createDictation } from "../src/lib/dictation";
import { createScriptedEngine } from "../src/lib/dictation-scripted";

test("the scripted engine moves the level until Stop, then sends its text once", async () => {
	const ticks: (() => void)[] = [];
	const engine = createScriptedEngine(
		"The Moon pulls the near side.",
		(fn) => ticks.push(fn) - 1,
		(t) => {
			ticks[t as number] = () => {};
		},
	);
	const d = createDictation({ engine: () => engine, language: async () => "en" });
	const got: string[] = [];
	await d.start(Symbol("f"), (t) => got.push(t));
	expect(d.getSnapshot().phase).toBe("listening");
	ticks[0]!();
	expect(d.level()).toBeGreaterThan(0);
	await d.stop();
	expect(got).toEqual(["The Moon pulls the near side."]);
	expect(d.getSnapshot().phase).toBe("idle");
});

test("cancel on the scripted engine sends no text", async () => {
	const engine = createScriptedEngine(
		"x",
		() => 0,
		() => {},
	);
	const d = createDictation({ engine: () => engine, language: async () => "en" });
	const got: string[] = [];
	await d.start(Symbol("f"), (t) => got.push(t));
	await d.cancel();
	expect(got).toEqual([]);
	expect(d.getSnapshot().problem).toBeNull();
});
