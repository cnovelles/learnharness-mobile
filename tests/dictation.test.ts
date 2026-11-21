/**
 * The dictation core (src/lib/dictation.ts), with a fake engine. Each error
 * state of issue 07 has a test here.
 */
import {
	appendDictation,
	createDictation,
	DICTATION_MESSAGES,
	dictationProblem,
	joinPieces,
	STOP_TIMEOUT_MS,
	type DictationEngine,
	type DictationRunHandlers,
	type ModelStatus,
} from "../src/lib/dictation";

function fakeEngine(overrides: Partial<DictationEngine> = {}) {
	const runs: { id: string; language: string; handlers: DictationRunHandlers }[] = [];
	const calls: string[] = [];
	let model: ModelStatus = "installed";
	const engine: DictationEngine = {
		kind: "on-device",
		supported: () => true,
		microphone: () => "granted",
		requestMicrophone: async () => true,
		model: async () => model,
		install: async (_l, onProgress) => {
			calls.push("install");
			onProgress(0.5);
			model = "installed";
		},
		start: async (id, language, handlers) => {
			calls.push("start");
			runs.push({ id, language, handlers });
		},
		stop: async () => {
			calls.push("stop");
		},
		cancel: async () => {
			calls.push("cancel");
		},
		...overrides,
	};
	return {
		engine,
		runs,
		calls,
		setModel: (m: ModelStatus) => {
			model = m;
		},
	};
}

function setup(overrides: Partial<DictationEngine> = {}, language = "en") {
	const fake = fakeEngine(overrides);
	const timers: (() => void)[] = [];
	const d = createDictation({
		engine: () => fake.engine,
		language: async () => language,
		setTimer: (fn) => {
			timers.push(fn);
			return timers.length - 1;
		},
		clearTimer: (t) => {
			timers[t as number] = () => {};
		},
	});
	const owner = Symbol("field");
	const got: string[] = [];
	return { d, fake, owner, got, deliver: (t: string) => got.push(t), timers };
}

test("a run: listen, collect the finals, deliver them once on stop", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	expect(d.getSnapshot()).toMatchObject({ phase: "listening", owner });
	const run = fake.runs[0]!;
	expect(run.language).toBe("en");
	run.handlers.onLevel(0.3);
	expect(d.level()).toBe(0.3);
	run.handlers.onText(" The Moon pulls.");
	run.handlers.onText("Two bulges. ");
	expect(got).toEqual([]); // no live text
	await d.stop();
	expect(d.getSnapshot().phase).toBe("stopping");
	run.handlers.onEnd({});
	expect(got).toEqual(["The Moon pulls. Two bulges."]);
	expect(d.getSnapshot()).toMatchObject({ phase: "idle", owner: null, problem: null });
	expect(d.level()).toBe(0);
});

test("no speech heard: the field does not change, and the message shows", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	await d.stop();
	fake.runs[0]!.handlers.onEnd({});
	expect(got).toEqual([]);
	expect(d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.noSpeech);
	d.clearProblem();
	expect(d.getSnapshot().problem).toBeNull();
});

test("cancel drops the text", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	fake.runs[0]!.handlers.onText("drop me");
	await d.cancel();
	expect(fake.calls).toContain("cancel");
	fake.runs[0]!.handlers.onEnd({ reason: "canceled" });
	expect(got).toEqual([]);
	expect(d.getSnapshot()).toMatchObject({ phase: "idle", problem: null });
});

test("a second start during a run does nothing (double tap)", async () => {
	const { d, fake, owner, deliver } = setup();
	await d.start(owner, deliver);
	await d.start(Symbol("other"), deliver);
	expect(fake.runs).toHaveLength(1);
	expect(d.getSnapshot().owner).toBe(owner);
});

test("events of an old run do nothing in a new run", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	await d.cancel();
	await d.start(owner, deliver);
	const [old, current] = fake.runs;
	old!.handlers.onText("old");
	old!.handlers.onEnd({});
	expect(d.getSnapshot().phase).toBe("listening");
	current!.handlers.onText("new");
	await d.stop();
	current!.handlers.onEnd({});
	expect(got).toEqual(["new"]);
});

test("an interruption keeps the text so far, with no message", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	fake.runs[0]!.handlers.onText("half a thought");
	fake.runs[0]!.handlers.onEnd({ reason: "interrupted" });
	expect(got).toEqual(["half a thought"]);
	expect(d.getSnapshot().problem).toBeNull();
});

test("an interruption with no text shows no message", async () => {
	const { d, fake, owner, deliver } = setup();
	await d.start(owner, deliver);
	fake.runs[0]!.handlers.onEnd({ reason: "interrupted" });
	expect(d.getSnapshot()).toMatchObject({ phase: "idle", problem: null });
});

test("the owner goes away: the text becomes orphan text, and the composer takes it once", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	fake.runs[0]!.handlers.onText("keep this");
	d.release(owner);
	await d.stop();
	fake.runs[0]!.handlers.onEnd({});
	expect(got).toEqual([]);
	expect(d.getSnapshot().orphan).toBe("keep this");
	expect(d.takeOrphan()).toBe("keep this");
	expect(d.takeOrphan()).toBeNull();
});

test("release by an input that does not own the run changes nothing", async () => {
	const { d, fake, owner, got, deliver } = setup();
	await d.start(owner, deliver);
	d.release(Symbol("other"));
	fake.runs[0]!.handlers.onText("mine");
	fake.runs[0]!.handlers.onEnd({});
	expect(got).toEqual(["mine"]);
});

test("stop ends the run itself when the engine never sends the end", async () => {
	const { d, fake, owner, got, deliver, timers } = setup();
	await d.start(owner, deliver);
	fake.runs[0]!.handlers.onText("late");
	await d.stop();
	expect(timers).toHaveLength(1);
	timers[0]!();
	expect(got).toEqual(["late"]);
	expect(d.getSnapshot().phase).toBe("idle");
	fake.runs[0]!.handlers.onEnd({}); // too late: nothing happens
	expect(got).toEqual(["late"]);
	expect(STOP_TIMEOUT_MS).toBeGreaterThan(0);
});

test("a failed engine stop ends the run with the text so far", async () => {
	const { d, fake, owner, got, deliver } = setup({
		stop: async () => {
			throw new Error("x");
		},
	});
	await d.start(owner, deliver);
	fake.runs[0]!.handlers.onText("saved");
	await d.stop();
	expect(got).toEqual(["saved"]);
});

test("iOS older than 26: the on-device engine is not supported", async () => {
	const { d, fake, owner, deliver } = setup({ supported: () => false });
	await d.start(owner, deliver);
	expect(fake.runs).toHaveLength(0);
	expect(d.getSnapshot()).toMatchObject({
		phase: "idle",
		problem: { text: DICTATION_MESSAGES.iosTooOld },
	});
});

test("microphone access refused before: the message has an Open Settings action", async () => {
	const { d, fake, owner, deliver } = setup({ microphone: () => "denied" });
	await d.start(owner, deliver);
	expect(fake.runs).toHaveLength(0);
	expect(d.getSnapshot().problem).toEqual({
		text: DICTATION_MESSAGES.microphoneOff,
		action: "settings",
	});
});

test("the first use asks for the microphone; a refusal gives the same message", async () => {
	const { d, fake, owner, deliver } = setup({
		microphone: () => "undetermined",
		requestMicrophone: async () => false,
	});
	await d.start(owner, deliver);
	expect(fake.runs).toHaveLength(0);
	expect(d.getSnapshot().problem?.action).toBe("settings");
});

test("the first use asks for the microphone; a yes starts the run", async () => {
	const { d, fake, owner, deliver } = setup({
		microphone: () => "undetermined",
		requestMicrophone: async () => true,
	});
	await d.start(owner, deliver);
	expect(fake.runs).toHaveLength(1);
});

test("no on-device model for the language", async () => {
	const { d, fake, owner, deliver } = setup();
	fake.setModel("unsupported");
	await d.start(owner, deliver);
	expect(fake.runs).toHaveLength(0);
	expect(d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.noLanguage);
});

test("a missing model downloads first, with progress, then the run starts", async () => {
	const { d, fake, owner, deliver } = setup();
	fake.setModel("supported");
	const phases: string[] = [];
	d.subscribe(() => phases.push(`${d.getSnapshot().phase}:${d.getSnapshot().progress}`));
	await d.start(owner, deliver);
	expect(fake.calls).toEqual(["install", "start"]);
	expect(phases).toContain("installing:0.5");
	expect(d.getSnapshot().phase).toBe("listening");
});

test("the model download fails (no network)", async () => {
	const { d, fake, owner, deliver } = setup({
		install: async () => {
			throw new Error("engine: network");
		},
	});
	fake.setModel("supported");
	await d.start(owner, deliver);
	expect(fake.runs).toHaveLength(0);
	expect(d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.downloadFailed);
});

test("cancel during the download: back to idle, no message, no run", async () => {
	let finishInstall: () => void = () => {};
	const { d, fake, owner, deliver } = setup({
		install: () => new Promise<void>((r) => (finishInstall = r)),
	});
	fake.setModel("supported");
	const started = d.start(owner, deliver);
	await new Promise((r) => setTimeout(r, 0));
	expect(d.getSnapshot().phase).toBe("installing");
	await d.cancel();
	finishInstall();
	await started;
	expect(fake.runs).toHaveLength(0);
	expect(d.getSnapshot()).toMatchObject({ phase: "idle", problem: null });
});

test("the engine refuses the start: the code becomes a message for the user", async () => {
	const { d, owner, deliver } = setup({
		start: async () => {
			throw new Error("microphone: no input");
		},
	});
	await d.start(owner, deliver);
	expect(d.getSnapshot()).toMatchObject({
		phase: "idle",
		problem: { text: DICTATION_MESSAGES.microphoneFailed },
	});
});

test("an engine error at the end with no text shows a message; with text, the text wins", async () => {
	const a = setup();
	await a.d.start(a.owner, a.deliver);
	a.fake.runs[0]!.handlers.onEnd({ error: "engine: SFSpeechErrorDomain 1" });
	expect(a.d.getSnapshot().problem?.text).toBe(DICTATION_MESSAGES.failed);

	const b = setup();
	await b.d.start(b.owner, b.deliver);
	b.fake.runs[0]!.handlers.onText("partial");
	b.fake.runs[0]!.handlers.onEnd({ error: "engine: x" });
	expect(b.got).toEqual(["partial"]);
	expect(b.d.getSnapshot().problem).toBeNull();
});

test("engine codes map to messages; raw codes never show", () => {
	expect(dictationProblem("ios-too-old")?.text).toBe(DICTATION_MESSAGES.iosTooOld);
	expect(dictationProblem("no-engine")?.text).toBe(DICTATION_MESSAGES.noLanguage);
	expect(dictationProblem("microphone: busy")?.text).toBe(DICTATION_MESSAGES.microphoneFailed);
	expect(dictationProblem("already-running")).toBeNull();
	expect(dictationProblem("engine: kAFAssistantErrorDomain 1101")?.text).toBe(
		DICTATION_MESSAGES.failed,
	);
});

test("pieces join with single spaces; dictated text appends with one space", () => {
	expect(joinPieces([" a ", "", "b."])).toBe("a b.");
	expect(appendDictation("", "x")).toBe("x");
	expect(appendDictation("I think", "the Moon.")).toBe("I think the Moon.");
	expect(appendDictation("Line\n", "next")).toBe("Line\nnext");
	expect(appendDictation("keep", "")).toBe("keep");
});
