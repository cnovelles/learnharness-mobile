/**
 * A test Mac for the Simulator (end-to-end tests and manual checks): the fork
 * server in a temporary data folder, the fake model provider with a scripted
 * lesson, and the phone gateway on https://127.0.0.1 (the Simulator reaches
 * the host's loopback). It never touches the real LearnHarness data folder.
 *
 * Run: npm run e2e:mac
 * It writes the pairing text to e2e/.pairing.txt (Maestro reads it) and
 * prints it. Stop it with Ctrl+C. Stop `npm run desktop:dev` first: both use
 * the fork's `.next/dev` lock.
 *
 * The scripted lesson (one probe, then the teacher):
 * 1. Prober: a short welcome and one probe about the tides.
 * 2. After the answer: probe_done, then a handoff sentence.
 * 3. Teacher: one paragraph about the two tidal bulges and plan_init (two
 *    steps), then a question about the plan.
 * 4. After the learner's reply: the teaching text and a check for the
 *    first step (it waits behind "Check your understanding").
 * 5. After the answer: a short reply.
 * e2e/first-turn.yaml uses steps 1 to 3; e2e/teach-cycle.yaml uses all.
 *
 * The scripted practice (issue 06, e2e/practice.yaml), for a session from
 * "New practice":
 * 1. Practitioner: a short text and the first problem (the turn ends).
 * 2. After the thinking: conclude (solved), then the closing words.
 * 3. After Next problem: the second problem. The flow dismisses it (no
 *    model call).
 * 4. After the next Next problem: the third problem. The Mac adds the
 *    dismissed conclusion of the second one with that input.
 *
 * LH_E2E_RICH=1 adds `RICH` to the teaching text of step 4: Markdown, code
 * fences in 3 languages, a table, math (also a formula that KaTeX cannot
 * draw) and 2 Mermaid charts (one with a parse error). Issue 05, manual checks.
 * It also makes the prober send a probe_done that the Mac refuses, then a
 * rich assessment with 3 strands (slice D).
 *
 * Control server (for Maestro, on 127.0.0.1, port in e2e/.control.txt):
 * POST /models/clear removes the model settings (the Mac then refuses a
 * turn with models_not_configured), POST /models/set sets them again.
 */
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";

const FORK = process.env.LH_FORK_DIR
	? path.resolve(process.env.LH_FORK_DIR)
	: path.resolve(import.meta.dirname, "../../learnharness");
const PAIRING_FILE = path.resolve(import.meta.dirname, "../e2e/.pairing.txt");
const CONTROL_FILE = path.resolve(import.meta.dirname, "../e2e/.control.txt");

export const LESSON = {
	probeText: "Welcome. First, one short question to see what you already know.",
	probe: {
		question: "What mainly causes the ocean tides on Earth?",
		options: [
			{ label: "The gravity of the Moon", value: "moon" },
			{ label: "The wind over the oceans", value: "wind" },
			{ label: "The rotation of the Earth alone", value: "rotation" },
		],
		explanation: "The Moon's gravity pulls the near side of the oceans more than the far side.",
		correctAnswer: "moon",
	},
	handoff: "Good. The teacher takes over now.",
	teach:
		"The Moon pulls harder on the near side of the Earth than on the far side. " +
		"This difference stretches the oceans into two bulges.",
	plan: "graph TD\n  pull[Uneven pull] --> bulges[Two bulges]",
	planQuestion: "This is the plan: two steps. Tell me when you are ready.",
	lesson: "The near side is closer to the Moon, so the pull there is stronger.",
	check: {
		type: "check",
		nodeId: "pull",
		question: "Why is the pull on the near side stronger?",
		options: [
			{ label: "It is closer to the Moon", value: "closer" },
			{ label: "The water there is warmer", value: "warmer" },
		],
		explanation: "Gravity gets weaker with distance, and the near side is closer.",
		correctAnswer: "closer",
	},
	afterCheck: "Right. Next we look at the two bulges.",
};

export const PRACTICE = {
	intro: "Here is your first problem.",
	first: {
		statement: "The tide rises $2$ m in $6$ hours. What is the mean rate in cm per hour?",
		mode: "recall",
		modelSolution: "$200$ cm in $6$ hours is about $33$ cm per hour.",
	},
	conclude: {
		outcome: "solved",
		verdict: "Correct conversion to centimeters and correct division.",
		rung: null,
		missClass: null,
		retest: false,
	},
	closing: "Well done. Ask about it, or take the next problem.",
	next: "A second one.",
	second: {
		statement: "Why are there two high tides each day, not one?",
		mode: "composition",
		modelSolution: "The Moon's uneven pull makes two bulges, and the Earth turns through both.",
	},
	third: {
		statement: "Which body causes most of the tides: the Sun or the Moon?",
		mode: "discrimination",
		modelSolution: "The Moon: it is much closer, so its uneven pull is about twice the Sun's.",
	},
};

/** Rich Markdown for the manual checks of issue 05 (LH_E2E_RICH=1). */
export const RICH = [
	"## Step 1: the pull",
	"The pull is **stronger** on the *near* side. In code, `force` falls with distance:",
	"```ts",
	"// Newton: the force falls with the square of the distance",
	"const force = (m1: number, m2: number, r: number): number => (G * m1 * m2) / r ** 2;",
	"export const near = force(earth, moon, 384_400 - 6_371); // a long line that scrolls sideways in the block",
	"```",
	"```python startLine=10",
	"def bulges(n: int) -> list[str]:",
	'    return ["near", "far"][:n]  # two bulges',
	"```",
	"```klingon",
	"qapla' batlh",
	"```",
	"| Side | Distance | Pull |",
	"| :--- | ---: | :---: |",
	"| Near | 378,029 km | **strong** |",
	"| Far | 390,771 km | weak ![moon](https://example.test/moon.png) |",
	"",
	"$$",
	"F = G \\frac{m_1 m_2}{r^2}",
	"$$",
	"",
	"The force is $F = ma$ and it falls as $\\frac{1}{r^2}$, see [Newton](https://example.test/newton).",
	"",
	"A broken formula: $\\frac{1}{$ stays as text.",
	"",
	"```mermaid",
	"graph LR",
	"  moon[Moon] -->|strong pull| near[Near side]",
	"  moon -->|weak pull| far[Far side]",
	"```",
	"```mermaid",
	"graph ???",
	"```",
	"",
	"- one",
	"- two, see [the source](https://example.test)",
].join("\n");
const RICH_ON = process.env.LH_E2E_RICH === "1";
/** A probe_done call that the Mac refuses: the schema needs one strand or more. */
const PROBE_BAD = { assessment: { strands: [], summary: "No strands." } };
/** A rich assessment for the probe card (LH_E2E_RICH=1, issue 05 slice D). */
const PROBE_RICH = {
	assessment: {
		strands: [
			{
				strand: "The Moon's **gravity**",
				assessment: "Picked the Moon at once. Knows `F = G m1 m2 / r^2` by name only.",
			},
			{
				strand: "Why there are *two* bulges",
				assessment:
					"Expects one bulge on the Moon's side.\n\nThe pull falls off as $1/r^2$, so the far side lags.",
			},
			{ strand: "Spring and neap tides", assessment: "Not seen yet." },
		],
		summary: "Start from the two tidal bulges, then the Sun's part.",
	},
};

const SECRET = "e".repeat(64);
const DESKTOP = { "x-learnharness-desktop": SECRET };

async function main() {
	const require = createRequire(import.meta.url);
	const { createPhoneAccessStore, createPhoneGateway } = require(
		path.join(FORK, "electron/phone-access.cjs"),
	);
	const { startFakeProvider } = await import(
		path.join(FORK, "tests/helpers/fake-openai-provider.ts")
	);
	const { startDevServer } = await import(path.join(FORK, "tests/helpers/next-dev-server.ts"));

	const fake = await startFakeProvider({
		models: ["fake-strong", "fake-cheap"],
		script: {
			prober: [
				{
					text: LESSON.probeText,
					chunkSize: 4,
					chunkDelayMs: 40,
					toolCalls: [{ name: "probe", arguments: LESSON.probe }],
				},
				// LH_E2E_RICH=1: first a call that the Mac refuses (no strands), then
				// the rich assessment (issue 05 slice D).
				...(RICH_ON ? [{ toolCalls: [{ name: "probe_done", arguments: PROBE_BAD }] }] : []),
				{
					toolCalls: [
						{
							name: "probe_done",
							arguments: RICH_ON
								? PROBE_RICH
								: {
										assessment: {
											strands: [{ strand: "tides", assessment: "Knows the Moon causes tides." }],
											summary: "Start from the two tidal bulges.",
										},
									},
						},
					],
				},
				{ text: LESSON.handoff },
			],
			teacher: [
				{
					text: LESSON.teach,
					chunkSize: 8,
					chunkDelayMs: 30,
					toolCalls: [{ name: "plan_init", arguments: { mermaid: LESSON.plan } }],
				},
				{ text: LESSON.planQuestion },
				{
					text: RICH_ON ? `${LESSON.lesson}\n\n${RICH}` : LESSON.lesson,
					chunkSize: RICH_ON ? 12 : undefined,
					chunkDelayMs: RICH_ON ? 40 : undefined,
					toolCalls: [{ name: "quiz", arguments: LESSON.check }],
				},
				{ text: LESSON.afterCheck },
			],
			practitioner: [
				{
					text: PRACTICE.intro,
					chunkSize: 4,
					chunkDelayMs: 40,
					toolCalls: [{ name: "problem", arguments: PRACTICE.first }],
				},
				{ toolCalls: [{ name: "conclude", arguments: PRACTICE.conclude }] },
				{ text: PRACTICE.closing },
				{
					text: PRACTICE.next,
					toolCalls: [{ name: "problem", arguments: PRACTICE.second }],
				},
				{ toolCalls: [{ name: "problem", arguments: PRACTICE.third }] },
			],
		},
	});
	console.log("Starting the fork server (next dev). This can take a minute…");
	const server = await startDevServer({
		env: { LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: SECRET },
		headers: DESKTOP,
	});
	if (server.dataDir.includes("Application Support"))
		throw new Error("refusing the real data folder");

	const json = { ...DESKTOP, "content-type": "application/json" };
	const get = await fetch(`${server.url}/api/custom-provider`, { headers: DESKTOP });
	const connect = await fetch(`${server.url}/api/custom-provider`, {
		method: "POST",
		headers: { ...json, "if-match": get.headers.get("etag")! },
		body: JSON.stringify({ baseUrl: fake.baseUrl, authMode: "keyless" }),
	});
	if (!connect.ok) throw new Error(`custom provider: ${await connect.text()}`);
	const slot = (id: string) => ({ model: { provider: "custom", id } });
	// The models section is one whole write: {} removes every slot.
	const putModels = async (settings: Record<string, unknown>) => {
		const res = await fetch(`${server.url}/api/settings/models`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify(settings),
		});
		if (!res.ok) throw new Error(`models: ${await res.text()}`);
	};
	const MODELS = {
		strong: slot("fake-strong"),
		cheap: slot("fake-cheap"),
		vision: slot("fake-cheap"),
	};
	await putModels(MODELS);
	await fetch(`${server.url}/api/settings/graph`, {
		method: "PUT",
		headers: json,
		body: JSON.stringify({ enabled: false }),
	});

	const gateway = createPhoneGateway({
		store: createPhoneAccessStore(path.join(server.home, "phone-access.json")),
		target: () => ({ url: server.url, secret: SECRET }),
		tlsDir: path.join(server.home, "phone-access-tls"),
		info: { name: "Test Mac", version: "e2e" },
	});
	const address: AddressInfo = await gateway.start({ host: "127.0.0.1", port: 0 });
	const { code } = gateway.startPairing();
	const payload = JSON.parse(gateway.pairingPayload(code));
	const text = JSON.stringify({ ...payload, urls: [`https://127.0.0.1:${address.port}`] });
	fs.mkdirSync(path.dirname(PAIRING_FILE), { recursive: true });
	fs.writeFileSync(PAIRING_FILE, text);

	const control = http.createServer((req, res) => {
		const done = (status: number, body: string) => {
			res.writeHead(status, { "content-type": "text/plain" });
			res.end(body);
		};
		const action =
			req.method === "POST" && req.url === "/models/clear"
				? putModels({})
				: req.method === "POST" && req.url === "/models/set"
					? putModels(MODELS)
					: null;
		if (!action) return done(404, "unknown");
		action.then(
			() => done(200, "ok"),
			(e: unknown) => done(500, String(e)),
		);
	});
	await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
	const controlUrl = `http://127.0.0.1:${(control.address() as AddressInfo).port}`;
	fs.writeFileSync(CONTROL_FILE, controlUrl);
	console.log(`Control server: ${controlUrl}`);
	console.log(`Test Mac ready. Data folder: ${server.dataDir}`);
	console.log(`Pairing text (also in ${PAIRING_FILE}):\n${text}`);

	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		fs.rmSync(PAIRING_FILE, { force: true });
		fs.rmSync(CONTROL_FILE, { force: true });
		control.close();
		await gateway.stop();
		await server.stop();
		await fake.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void stop());
	process.on("SIGTERM", () => void stop());
}

main().catch((e: unknown) => {
	console.error(e);
	process.exit(1);
});
