/**
 * Integration (issue 03): the phone's own code against the REAL fork
 * server, through the HTTPS phone gateway, with the fake model provider.
 *
 *   fake provider ← next dev (temp LH_DATA_DIR) ← gateway (HTTPS, pin) ← phone code
 *
 * Phone code in use: pair() and remoteFetch (src/lib/pairing.ts), the Mac
 * fetch, the session API, the question form, and the shared SessionModel
 * (as the session screen uses it).
 *
 * Run: npm run test:integration (needs the fork at ../learnharness with its
 * packages installed). It boots `next dev` in the fork, so stop any
 * `npm run desktop:dev` first: both use the `.next/dev` lock.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { openEventsChannel } from "../../src/lib/events-channel";
import { createMacFetch } from "../../src/lib/mac-fetch";
import {
	pair,
	parsePairingPayload,
	type Connection,
	type PinnedFetch,
} from "../../src/lib/pairing";
import {
	answerFor,
	chooseOption,
	newQuestionForm,
	setConfidence,
} from "../../src/lib/question-form";
import { OpeningPrompts, listSessions, readSession, startSession } from "../../src/lib/sessions";
import {
	CONFIDENCE_STOPS,
	SessionModel,
	pendingQuestionOf,
	projectView,
	questionDataForCall,
	type LhMessage,
	type SessionState,
} from "../../src/lib/shared";
import { createEventHub } from "../../src/lib/server-events";
import { attachSessionEvents } from "../../src/lib/session-events";
import { transcriptRows } from "../../src/lib/transcript";

const FORK = process.env.LH_FORK_DIR
	? path.resolve(process.env.LH_FORK_DIR)
	: path.resolve(import.meta.dirname, "../../../learnharness");

const require = createRequire(import.meta.url);
const { createPhoneAccessStore, createPhoneGateway } = require(
	path.join(FORK, "electron/phone-access.cjs"),
);
type ForkHelpers = {
	fake: typeof import("../../../learnharness/tests/helpers/fake-openai-provider.ts");
	dev: typeof import("../../../learnharness/tests/helpers/next-dev-server.ts");
	pinned: typeof import("../../../learnharness/tests/helpers/pinned-fetch.ts");
};

const SECRET = "d".repeat(64);
const DESKTOP = { "x-learnharness-desktop": SECRET };

const OPENING = "Teach me how the tides work.";
const PROBE_TEXT =
	"Welcome. Before we plan anything, I want to see what you already know about the tides. " +
	"Answer with your best guess, and tell me how sure you are.";
const PROBE_INPUT = {
	question: "What mainly causes the ocean tides on Earth?",
	options: [
		{ label: "The gravity of the Moon", value: "moon" },
		{ label: "The wind over the oceans", value: "wind" },
		{ label: "The rotation of the Earth alone", value: "rotation" },
	],
	explanation: "The Moon's gravity pulls the near side of the oceans more than the far side.",
	correctAnswer: "moon",
};
const PROBE_DONE_INPUT = {
	assessment: {
		strands: [{ strand: "gravity and tides", assessment: "Knows the Moon causes tides." }],
		summary: "Start from the two tidal bulges.",
	},
};
const TEACH_TEXT =
	"The Moon pulls harder on the near side of the Earth than on the far side. " +
	"This difference stretches the oceans into two bulges.";

let helpers: ForkHelpers;
let fake: Awaited<ReturnType<ForkHelpers["fake"]["startFakeProvider"]>>;
let server: Awaited<ReturnType<ForkHelpers["dev"]["startDevServer"]>>;
let gateway: ReturnType<typeof createPhoneGateway>;
let gatewayURL = "";
let nodePinned: ReturnType<ForkHelpers["pinned"]["pinnedFetch"]> | null = null;
let connection: Connection;
let macFetch: typeof fetch;

/** The phone's PinnedFetch contract on top of the fork's Node pinned fetch. */
function phonePinnedFetch(expectedPin: string): PinnedFetch {
	nodePinned = helpers.pinned.pinnedFetch(expectedPin);
	const node = nodePinned;
	return async (url, init) => {
		assert.equal(init.pin, expectedPin, "every request carries the pin from the pairing");
		const { pin: _pin, ...rest } = init;
		return node(url, rest);
	};
}

async function waitFor<T>(
	what: string,
	probe: () => Promise<T | undefined> | T | undefined,
	timeoutMs = 60_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await probe();
		if (value !== undefined) return value;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`timed out waiting for ${what}\nserver: ${server.log().slice(-2000)}`);
}

const texts = (messages: readonly LhMessage[]) =>
	messages.flatMap((m) =>
		m.role === "assistant"
			? m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text)
			: [],
	);

before(async () => {
	helpers = {
		fake: await import(path.join(FORK, "tests/helpers/fake-openai-provider.ts")),
		dev: await import(path.join(FORK, "tests/helpers/next-dev-server.ts")),
		pinned: await import(path.join(FORK, "tests/helpers/pinned-fetch.ts")),
	};
	fake = await helpers.fake.startFakeProvider({ models: ["fake-strong", "fake-cheap"] });
	server = await helpers.dev.startDevServer({
		env: { LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: SECRET },
		headers: DESKTOP,
	});
	assert.ok(!server.dataDir.includes("Application Support"), "never the user's real data folder");

	const get = await fetch(`${server.url}/api/custom-provider`, { headers: DESKTOP });
	assert.equal(get.status, 200, await get.clone().text());
	const connect = await fetch(`${server.url}/api/custom-provider`, {
		method: "POST",
		headers: {
			...DESKTOP,
			"content-type": "application/json",
			"if-match": get.headers.get("etag")!,
		},
		body: JSON.stringify({ baseUrl: fake.baseUrl, authMode: "keyless" }),
	});
	assert.equal(connect.status, 200, await connect.clone().text());
	const slot = (id: string) => ({ model: { provider: "custom", id } });
	const models = await fetch(`${server.url}/api/settings/models`, {
		method: "PUT",
		headers: { ...DESKTOP, "content-type": "application/json" },
		body: JSON.stringify({
			strong: slot("fake-strong"),
			cheap: slot("fake-cheap"),
			vision: slot("fake-cheap"),
		}),
	});
	assert.equal(models.status, 200, await models.clone().text());
	// No extraction in this test: it checks the phone's teaching turn path.
	const graph = await fetch(`${server.url}/api/settings/graph`, {
		method: "PUT",
		headers: { ...DESKTOP, "content-type": "application/json" },
		body: JSON.stringify({ enabled: false }),
	});
	assert.equal(graph.status, 200, await graph.clone().text());

	gateway = createPhoneGateway({
		store: createPhoneAccessStore(path.join(server.home, "phone-access.json")),
		target: () => ({ url: server.url, secret: SECRET }),
		tlsDir: path.join(server.home, "phone-access-tls"),
		info: { name: "Test Mac", version: "test" },
	});
	const address: AddressInfo = await gateway.start({ host: "127.0.0.1", port: 0 });
	gatewayURL = `https://127.0.0.1:${address.port}`;
});

after(async () => {
	await nodePinned?.close();
	await gateway?.stop();
	await server?.stop();
	await fake?.close();
});

describe("issue 03: a teaching turn from the phone code (mode 1)", { concurrency: false }, () => {
	it("pairs with the phone's pair() over the pinned HTTPS gateway", async () => {
		const { code } = gateway.startPairing();
		const raw = JSON.parse(gateway.pairingPayload(code));
		// The gateway listens on loopback in this test; the QR code lists the Mac's network addresses.
		const payload = parsePairingPayload(JSON.stringify({ ...raw, urls: [gatewayURL] }));
		connection = await pair(payload, "Test iPhone", phonePinnedFetch(payload.pin));
		assert.equal(connection.name, "Test Mac");
		const state = {
			status: "connected" as const,
			connection,
			url: gatewayURL,
			checkedAt: new Date().toISOString(),
		};
		macFetch = createMacFetch({ state: () => state }, phonePinnedFetch(payload.pin));
	});

	let chatId = "";
	const prompts = new OpeningPrompts();

	it("starts a session and lists it", async () => {
		chatId = await startSession(macFetch, OPENING, prompts);
		const list = await listSessions(macFetch);
		const row = list.find((c) => c.id === chatId);
		assert.ok(row, "the new session is in the list");
		assert.equal(row.title.length > 0, true);
		assert.equal(row.phase, "probe");
		// next dev compiles each route on its first request. Warm up the routes
		// that the model uses, so a short fake turn does not end before the attach.
		const idle = await macFetch(`/api/chats/${chatId}/stream`);
		assert.equal(idle.status, 200);
		await idle.text();
		assert.equal((await macFetch(`/api/jobs?chatId=${chatId}`)).status, 200);
	});

	it("streams the prober turn into the SessionModel, answers the probe with the question form, and the teacher takes over", async () => {
		const record = await readSession(macFetch, chatId);
		assert.equal(record.turnInFlight, false);
		const seen: SessionState["status"][] = [];
		let partialSeen = false;
		const model = new SessionModel({ chatId, initialMessages: record.messages, fetch: macFetch });
		// The events channel and the session rules, as the session screen uses them.
		const hub = createEventHub();
		const stopEvents = attachSessionEvents(model, hub);
		let opened = 0;
		const channel = openEventsChannel({
			fetch: macFetch,
			onEvent: hub.dispatch,
			onOpen: () => (hub.resync(), opened++),
		});
		await waitFor("the events channel", () => (opened > 0 ? true : undefined));
		model.onChange = () => {
			const s = model.getState();
			if (seen.at(-1) !== s.status) seen.push(s.status);
			const t = texts(s.nativeMessages).join("");
			if (s.status === "streaming" && t.length > 0 && t.length < PROBE_TEXT.length)
				partialSeen = true;
		};

		fake.enqueue("prober", {
			text: PROBE_TEXT,
			chunkSize: 4,
			chunkDelayMs: 80,
			toolCalls: [{ name: "probe", arguments: PROBE_INPUT }],
		});
		const opening = prompts.take(chatId);
		assert.equal(opening, OPENING);
		await model.send({ type: "text", text: opening });

		const pending = await waitFor("the pending probe", () => {
			const s = model.getState();
			return s.status === "ready" ? (pendingQuestionOf(s.nativeMessages) ?? undefined) : undefined;
		});
		assert.ok(seen.includes("streaming"), `status path: ${seen.join(" → ")}`);
		assert.ok(partialSeen, "the phone saw the text while it streamed");
		assert.equal(pending.tool, "probe");

		const rows = transcriptRows(projectView(model.getState().nativeMessages));
		assert.deepEqual(
			rows.filter((r) => r.kind !== "reasoning").map((r) => r.kind),
			["user", "text", "question"],
		);
		assert.ok(rows.some((r) => r.kind === "user" && r.text === OPENING));
		assert.ok(rows.some((r) => r.kind === "text" && r.text === PROBE_TEXT));

		// The answer, as the question dock makes it.
		const qd = questionDataForCall(pending.tool, pending.toolCallId, pending.input);
		let form = chooseOption(
			qd,
			newQuestionForm(),
			qd.options.findIndex((o) => o.value === "moon"),
		);
		form = setConfidence(form, CONFIDENCE_STOPS.indexOf(90));
		form = { ...form, thinking: "The Moon is close to the Earth." };
		const answer = answerFor(qd, form, pending.tool);

		fake.enqueue(
			"prober",
			{ toolCalls: [{ name: "probe_done", arguments: PROBE_DONE_INPUT }] },
			{ text: "Good. The teacher takes over now." },
		);
		fake.enqueue("teacher", { text: TEACH_TEXT, chunkSize: 40 });
		await model.submitAnswer(pending.tool, pending.toolCallId, answer);

		// The answered probe is in the record with the grade and the confidence.
		const answered = await waitFor("the answer in the record", async () => {
			const r = await readSession(macFetch, chatId);
			const result = r.messages.find(
				(m) => m.role === "toolResult" && m.toolCallId === pending.toolCallId,
			);
			return result as (LhMessage & { details?: Record<string, unknown> }) | undefined;
		});
		assert.equal(answered.details?.correct, true);
		assert.equal(answered.details?.confidence, 90);
		assert.equal(answered.details?.thinking, "The Moon is close to the Earth.");
		const proberAnswerRequest = fake.requests.filter((r) => r.role === "prober")[1]!;
		assert.match(JSON.stringify(proberAnswerRequest.body.messages), /confidence\W+90/);

		// The handoff wakes the teacher in a new turn on the Mac. The phone
		// learns of it from /api/events and shows it in the same model.
		await waitFor("the teacher's text in the phone's model", () => {
			const s = model.getState();
			return texts(s.nativeMessages).includes(TEACH_TEXT) && s.status === "ready"
				? true
				: undefined;
		});
		const r = await readSession(macFetch, chatId);
		assert.ok(texts(r.messages).includes(TEACH_TEXT));
		stopEvents();
		channel.close();
		model.stop();

		// The probe is over. The phase is "plan" until the first teaching question.
		const list = await listSessions(macFetch);
		assert.equal(list.find((c) => c.id === chatId)?.phase, "plan");
		assert.deepEqual(
			fake.unscripted.map((r) => r.role),
			[],
			"no unscripted model request",
		);
	});

	it("a phone that reopens the session during a turn reattaches and sees the turn to its end", async () => {
		fake.enqueue("teacher", { text: TEACH_TEXT.repeat(3), chunkSize: 8, chunkDelayMs: 120 });
		const first = new SessionModel({
			chatId,
			initialMessages: (await readSession(macFetch, chatId)).messages,
			fetch: macFetch,
		});
		void first.send({ type: "text", text: "Tell me more." });
		await waitFor("the turn to run on the Mac", async () =>
			(await readSession(macFetch, chatId)).turnInFlight ? true : undefined,
		);
		first.stop(); // the learner leaves the screen; the turn runs on

		const record = await readSession(macFetch, chatId);
		assert.equal(record.turnInFlight, true);
		const second = new SessionModel({ chatId, initialMessages: record.messages, fetch: macFetch });
		let settled = false;
		second.setReattachSettled(() => (settled = true));
		await second.resumeStream(false);
		await waitFor("the reattached turn to settle", () =>
			settled && second.getState().status === "ready" ? true : undefined,
		);
		assert.ok(texts(second.getState().nativeMessages).includes(TEACH_TEXT.repeat(3)));
		second.stop();
	});
});
