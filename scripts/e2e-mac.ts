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
 * LH_E2E_GOLDEN=1 copies the fork's golden data (tests/fixtures/golden-data:
 * chats and graph) into the data folder: a long recorded teach session, a
 * practice session and a real graph. For the session open position and
 * the issue 08 screens.
 *
 * LH_E2E_MATH=1 (with LH_E2E_GOLDEN=1) adds a display formula to each
 * teacher reply of the golden teach session. Each formula draws in a
 * WebView, so the top-to-bottom reveal of the session is slow: the case
 * of the session open position bug (a long session opened at the top).
 *
 * LH_E2E_SHELF=1 (with LH_E2E_GOLDEN=1) adds teach sessions and desktop
 * folders for the Teach tab (issue 20): "Algebra" (2 sessions),
 * "Databases" (1), "Databases/Postgres" (the golden teach session), the
 * empty "Reading list", and one session with no folder.
 *
 * LH_E2E_PRACTICE_SHELF=1 (with LH_E2E_GOLDEN=1) adds 2 practice sessions
 * for the Practice tab (issue 20 slice C), copies of the golden practice
 * session: "Linear recurrences" (today, the first problem waits: 1
 * problem) and "Bayes rule practice" (3 days ago, 2 problems). The golden
 * session itself (2 problems) is in Earlier.
 *
 * LH_E2E_LINK=1 (with LH_E2E_GOLDEN=1) links the node "Relational model
 * (Information Principle)" to a teacher message in the middle of the golden
 * teach session (issue 08 slice C2). The golden graph has no message links.
 *
 * LH_E2E_CHAIN_BIRTH=1 (with LH_E2E_LINK=1) puts that link first, so the
 * teach session is the birth of the node, and its chains show "Open
 * <session>" in the Chains screen (issue 08 slice D). The golden graph has
 * no chain that was born in a session that still exists.
 *
 * LH_E2E_RUN=1 starts one notes import ("notes/pipeline run.md") and holds
 * it in the "extracting" phase: the scripted extractor streams its text
 * slowly (about 15 minutes). The Graph tab then shows one run pill (issue
 * 08 slice F). The run ends when the test Mac stops.
 *
 * LH_E2E_GATEWAY_HOST=<IPv4> makes the gateway listen on that address and
 * puts only that address in the pairing text (default 127.0.0.1). Use the
 * Mac's Tailscale address (100.x) to check the phone's App Transport
 * Security rules for that range in the Simulator (issue 15).
 *
 * LH_E2E_ARTIFACTS=1 adds the session "Artifacts check" (issue 19,
 * e2e/artifacts.yaml): a figure, the slider demo, a figure on a learner
 * photo, a demo that loads a script from jsDelivr, a demo with a blocked
 * host, a failed demo and the canary demo. The canary demo tries each
 * escape of the security review (docs/reviews/2026-11-23-artifact-sandbox.md,
 * section 8) against a TCP and a UDP server on 127.0.0.1 that count each
 * hit. GET /canary on the control server gives the counts.
 *
 * Control server (for Maestro, on 127.0.0.1, port in e2e/.control.txt):
 * POST /models/clear removes the model settings (the Mac then refuses a
 * turn with models_not_configured), POST /models/set sets them again.
 */
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import net from "node:net";
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

/** The golden teach session (95 messages, one compaction). */
const GOLDEN_TEACH = "chat_mv27rrra_feff23b6.json";

const GOLDEN_PRACTICE = "chat_mv293wv5_10656952.json";

/** LH_E2E_PRACTICE_SHELF=1: 2 practice sessions, copies of the golden one, with new times. */
function addPracticeShelf(chats: string) {
	const golden = JSON.parse(fs.readFileSync(path.join(chats, GOLDEN_PRACTICE), "utf8")) as {
		messages: { role: string; toolName?: string }[];
	};
	// The messages up to the first clean pose: one problem that waits.
	const firstPose = golden.messages.findIndex(
		(m) => m.role === "toolResult" && m.toolName === "problem",
	);
	const day = 24 * 3_600_000;
	const copies = [
		{
			id: "chat_e2e_practice_today",
			title: "Linear recurrences",
			ago: 60_000,
			messages: golden.messages.slice(0, firstPose + 1),
		},
		{
			id: "chat_e2e_practice_week",
			title: "Bayes rule practice",
			ago: 3 * day,
			messages: golden.messages,
		},
	];
	for (const c of copies) {
		const time = new Date(Date.now() - c.ago).toISOString();
		const record = {
			...golden,
			id: c.id,
			title: c.title,
			createdAt: time,
			updatedAt: time,
			messages: c.messages,
		};
		fs.writeFileSync(path.join(chats, `${c.id}.json`), JSON.stringify(record));
	}
}

/** LH_E2E_LINK=1: the node and the message of the open at a message (issue 08 slice C2). */
export const LINK_NODE = "n_465398b5356a";
export const LINK_MESSAGE = "msg_mv28341k_00f1355e";

function addMessageLink(graph: string) {
	const file = path.join(graph, "nodes.jsonl");
	const chatId = GOLDEN_TEACH.replace(/\.json$/, "");
	const lines = fs.readFileSync(file, "utf8").split("\n");
	let found = false;
	const out = lines.map((line) => {
		if (!line.trim()) return line;
		const node = JSON.parse(line) as { id: string; provenance: unknown[] };
		if (node.id !== LINK_NODE) return line;
		found = true;
		const link = { chatId, messageId: LINK_MESSAGE };
		if (process.env.LH_E2E_CHAIN_BIRTH === "1") node.provenance.unshift(link);
		else node.provenance.push(link);
		return JSON.stringify(node);
	});
	if (!found) throw new Error(`LH_E2E_LINK: no node ${LINK_NODE} in the golden graph`);
	fs.writeFileSync(file, out.join("\n"));
}

/** LH_E2E_MATH=1: a display formula after the first text part of each teacher reply. */
function addFormulas(file: string) {
	const chat = JSON.parse(fs.readFileSync(file, "utf8")) as {
		messages: { role: string; content: unknown }[];
	};
	let n = 0;
	for (const message of chat.messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const part = (message.content as { type: string; text?: string }[]).find(
			(p) => p.type === "text",
		);
		if (!part || typeof part.text !== "string") continue;
		n += 1;
		part.text = `$$\\sum_{k=1}^{${n}} k = \\frac{${n}(${n}+1)}{2}$$\n\n${part.text}`;
	}
	fs.writeFileSync(file, JSON.stringify(chat));
}

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
	"| Side | Distance | Pull | Note |",
	"| :--- | ---: | :---: | :--- |",
	"| Near | 378,029 km | **strong** | Faces the Moon, so the pull here is the strongest |",
	"| Far | 390,771 km | weak ![moon](https://example.test/moon.png) | Pulled less than the center of the Earth |",
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
	"  near -->|water piles up| bulges[Two bulges]",
	"  far -->|water lags behind| bulges",
	"  bulges --> tides[Two tides a day]",
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
			// LH_E2E_RUN=1: an extraction that stays in "extracting" (slice F).
			...(process.env.LH_E2E_RUN === "1"
				? { extractor: [{ text: "x".repeat(900), chunkSize: 1, chunkDelayMs: 1000 }] }
				: {}),
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
	if (process.env.LH_E2E_GOLDEN === "1") {
		// The fork's recorded data: a long teach session (95 messages, one
		// compaction), a practice session and the graph ledgers.
		const golden = path.join(FORK, "tests/fixtures/golden-data");
		for (const dir of ["chats", "graph"])
			fs.cpSync(path.join(golden, dir), path.join(server.dataDir, dir), { recursive: true });
		if (process.env.LH_E2E_MATH === "1")
			addFormulas(path.join(server.dataDir, "chats", GOLDEN_TEACH));
		if (process.env.LH_E2E_PRACTICE_SHELF === "1")
			addPracticeShelf(path.join(server.dataDir, "chats"));
		if (process.env.LH_E2E_LINK === "1") addMessageLink(path.join(server.dataDir, "graph"));
	}

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
	if (process.env.LH_E2E_SHELF === "1") await addShelf(server.url, json);
	if (process.env.LH_E2E_ARTIFACTS === "1")
		await addArtifacts(server.url, json, path.join(server.dataDir, "chats"), await startCanary());
	if (process.env.LH_E2E_RUN === "1") startHeldRun(server.url);
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
		log: (line: string) => console.log(`[gateway] ${line}`),
	});
	const gatewayHost = process.env.LH_E2E_GATEWAY_HOST || "127.0.0.1";
	const address: AddressInfo = await gateway.start({ host: gatewayHost, port: 0 });
	const { code } = gateway.startPairing();
	const payload = JSON.parse(gateway.pairingPayload(code));
	const text = JSON.stringify({ ...payload, urls: [`https://${gatewayHost}:${address.port}`] });
	fs.mkdirSync(path.dirname(PAIRING_FILE), { recursive: true });
	fs.writeFileSync(PAIRING_FILE, text);

	const control = http.createServer((req, res) => {
		const done = (status: number, body: string) => {
			res.writeHead(status, { "content-type": "text/plain" });
			res.end(body);
		};
		if (req.method === "GET" && req.url === "/canary") return done(200, JSON.stringify(canaryHits));
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
		// The held import of LH_E2E_RUN=1 must not keep the server busy.
		heldRun.abort();
		console.log("Stopping the gateway…");
		await gateway.stop();
		console.log("Stopping the fork server…");
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

/**
 * LH_E2E_RUN=1: one notes import that the scripted extractor holds. The
 * import request ends only with the run, so the script does not wait for it.
 */
const heldRun = new AbortController();

function startHeldRun(url: string) {
	const form = new FormData();
	form.append("files", new Blob(["# Pipeline run\n\nA note for the run pill."]), "pipeline run.md");
	form.append("paths", "notes/pipeline run.md");
	fetch(`${url}/api/graph/import`, {
		method: "POST",
		headers: DESKTOP,
		body: form,
		signal: heldRun.signal,
	}).then(
		(res) => console.log(`[run] the held import ended: ${res.status}`),
		(e: unknown) => console.log(`[run] the held import stopped: ${String(e)}`),
	);
	// A log line for the run check: the phase of the held run.
	setTimeout(() => {
		fetch(`${url}/api/graph/status`, { headers: DESKTOP })
			.then((res) => res.json() as Promise<{ runs: { title: string; phase: string }[] }>)
			.then(({ runs }) =>
				console.log(
					`[run] runs in progress: ${runs.map((r) => `${r.phase} ${r.title}`).join(", ")}`,
				),
			)
			.catch((e: unknown) => console.log(`[run] no status: ${String(e)}`));
	}, 5000);
}

/** The Teach tab data of LH_E2E_SHELF=1, through the desktop API. */
async function addShelf(url: string, headers: Record<string, string>) {
	const post = async (route: string, body: unknown) => {
		const res = await fetch(`${url}${route}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`shelf ${route}: ${await res.text()}`);
		return res.json() as Promise<Record<string, unknown>>;
	};
	type Directory = { organization: { folders: { id: string; name: string }[] } };
	const folder = async (name: string, parentId: string | null) => {
		const dir = (await post("/api/graph/sources", {
			action: "create-folder",
			name,
			parentId,
		})) as Directory;
		return dir.organization.folders.find((f) => f.name === name)!.id;
	};
	const move = (id: string, parentId: string) =>
		post("/api/graph/sources", { action: "move", kind: "source", id, parentId });
	const session = async (title: string) => String((await post("/api/chats", { title })).id);
	const algebra = await folder("Algebra", null);
	const databases = await folder("Databases", null);
	const postgres = await folder("Postgres", databases);
	await folder("Reading list", null);
	await move(GOLDEN_TEACH.replace(/\.json$/, ""), postgres);
	await move(await session("Linear maps"), algebra);
	await move(await session("Eigenvalues"), algebra);
	await move(await session("Indexes"), databases);
	await session("Bayes rule");
}

/** LH_E2E_ARTIFACTS=1: the hits on the canary servers (GET /canary). */
const canaryHits = { tcp: 0, udp: 0, log: [] as string[] };

/** The canary tries that use a URL. Each has its own TCP port, so a hit names its try. */
const CANARY_TRIES = [
	"ws",
	"from-worker",
	"import.css",
	"bg.png",
	"fetch",
	"xhr",
	"sse",
	"beacon",
	"img.png",
	"script.js",
	"style.css",
	"prefetch",
	"module.js",
	"worker.js",
	"frame",
	"open",
	"blank",
	"form",
	"refresh",
	"link",
	"top",
	"self",
] as const;
type CanaryPorts = { tcp: Record<string, number>; udp: number };

/**
 * The canary servers on 127.0.0.1: one TCP server for each try (an https
 * or wss request opens a connection here before TLS) and a UDP socket (the
 * STUN server of a WebRTC test). Each hit adds to `canaryHits`.
 */
async function startCanary(): Promise<CanaryPorts> {
	const tcp: Record<string, number> = {};
	for (const name of CANARY_TRIES) {
		const server = net.createServer((socket) => {
			canaryHits.tcp += 1;
			canaryHits.log.push(`tcp ${name}`);
			console.log(`[canary] TCP hit: ${name}`);
			socket.on("error", () => {});
			setTimeout(() => socket.destroy(), 1000);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		tcp[name] = (server.address() as AddressInfo).port;
	}
	const udp = dgram.createSocket("udp4");
	udp.on("message", (data, from) => {
		canaryHits.udp += 1;
		canaryHits.log.push(`udp ${from.address}:${from.port} ${data.length} bytes`);
		console.log(`[canary] UDP hit from ${from.address}:${from.port}`);
	});
	await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
	console.log(`[canary] ${CANARY_TRIES.length} TCP ports, UDP port ${udp.address().port}`);
	return { tcp, udp: udp.address().port };
}

/**
 * The canary demo. Each try runs in its own try block and writes one line
 * to the page. The scripts make each tag at run time, so the phone's
 * blocked-host check does not find the URLs and the demo runs: the CSP,
 * the frame sandbox and the load rule are the only guards. Pass: no hit on
 * the canary servers, no native panel, the app stays on the lesson.
 */
function canaryDemo(ports: CanaryPorts): string {
	const script = `
var P = ${JSON.stringify(ports.tcp)};
function U(name) { return "https://127.0.0.1:" + P[name] + "/" + name; }
var out = document.getElementById("out");
function line(text) { var li = document.createElement("li"); li.textContent = text; out.appendChild(li); }
function attempt(name, fn) {
	try { var r = fn(); line(name + ": ran" + (r === undefined ? "" : " (" + String(r).slice(0, 30) + ")")); }
	catch (e) { line(name + ": threw"); }
}
function add(tag, attrs, parent) {
	var el = document.createElement(tag);
	for (var k in attrs) el.setAttribute(k, attrs[k]);
	(parent || document.body).appendChild(el);
	return el;
}
attempt("fetch", function () { fetch(U("fetch")).catch(function () {}); });
attempt("xhr", function () { var x = new XMLHttpRequest(); x.open("GET", U("xhr")); x.send(); });
attempt("websocket", function () { new WebSocket("wss://127.0.0.1:" + P.ws + "/ws"); });
attempt("eventsource", function () { new EventSource(U("sse")); });
attempt("beacon", function () { return navigator.sendBeacon(U("beacon"), "x"); });
attempt("img", function () { add("img", { src: U("img.png") }); });
attempt("script", function () { add("script", { src: U("script.js") }, document.head); });
attempt("stylesheet", function () { add("link", { rel: "stylesheet", href: U("style.css") }, document.head); });
attempt("prefetch", function () { add("link", { rel: "prefetch", href: U("prefetch") }, document.head); });
attempt("css import", function () { add("style", {}, document.head).textContent = "@import url(" + U("import.css") + ");"; });
attempt("css url", function () { add("style", {}, document.head).textContent = "body{background-image:url(" + U("bg.png") + ")}"; });
attempt("module import", function () { var u = U("module.js"); Function("u", "return import(u)")(u).catch(function () {}); });
attempt("worker", function () { new Worker(U("worker.js")); });
attempt("blob worker", function () {
	var b = new Blob(["fetch('" + U("from-worker") + "')"], { type: "text/javascript" });
	new Worker(URL.createObjectURL(b));
});
attempt("webrtc", function () {
	var pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${ports.udp}" }] });
	pc.createDataChannel("x");
	pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () {});
});
attempt("media", function () { return navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(function () {}); });
attempt("alert", function () { return alert("CANARY ALERT"); });
attempt("confirm", function () { return confirm("CANARY CONFIRM"); });
attempt("prompt", function () { return prompt("CANARY PROMPT"); });
attempt("iframe src", function () { add("iframe", { src: U("frame") }); });
attempt("blank frame", function () {
	var f = add("iframe", {});
	var w = f.contentWindow;
	try { w.prompt("CANARY FRAME PROMPT"); line("frame prompt: ran"); } catch (e) { line("frame prompt: threw"); }
	try {
		var pc = new w.RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${ports.udp}" }] });
		pc.createDataChannel("x");
		pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () {});
		line("frame webrtc: ran");
	} catch (e) { line("frame webrtc: threw"); }
});
attempt("window.open", function () { return window.open(U("open")); });
attempt("blank link", function () { add("a", { href: U("blank"), target: "_blank" }).click(); });
attempt("form", function () {
	var f = add("form", { action: U("form"), method: "post" });
	add("input", { name: "x", value: "1" }, f);
	f.submit();
});
// The navigations come last: a navigation that works ends the page.
setTimeout(function () {
	attempt("meta refresh", function () { add("meta", { "http-equiv": "refresh", content: "0;url=" + U("refresh") }, document.head); });
	attempt("link tap", function () { add("a", { href: U("link") }).click(); });
	attempt("top.location", function () { top.location.href = U("top"); });
	attempt("location", function () { location.href = U("self"); });
	line("Canary finished");
	document.getElementById("state").textContent = "Canary finished";
}, 1500);
`;
	// The demo's own doctype, <html> and <head>, and a CSP that allows
	// everything: the phone's CSP comes first, so this one only adds limits.
	return (
		"<!doctype html><html><head>" +
		"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src * 'unsafe-inline' 'unsafe-eval'; connect-src *; frame-src *\">" +
		"<style>body{font:14px -apple-system,sans-serif;padding:12px;color:#111}</style></head><body>" +
		'<h3 id="state">Canary running</h3><ul id="out"></ul>' +
		`<script>${script}</script></body></html>`
	);
}

/** An 8 by 8 teal PNG: the learner photo of the photo figure. */
const ARTIFACT_PHOTO =
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPQmtuPFTEMLQkAT3dVgRdrT9YAAAAASUVORK5CYII=";

const FIGURE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160">' +
	'<rect width="320" height="160" fill="#eef6ff"/>' +
	'<ellipse cx="110" cy="80" rx="70" ry="45" fill="#7fb3e6"/>' +
	'<circle cx="110" cy="80" r="36" fill="#3a7d44"/>' +
	'<circle cx="270" cy="80" r="14" fill="#999"/>' +
	'<text x="160" y="150" font-size="14" text-anchor="middle" fill="#123">Two tidal bulges</text></svg>';

const SLIDER_DEMO =
	"<style>body{font:15px -apple-system,sans-serif;padding:16px;color:#111}</style>" +
	'<label for="d">Distance to the Moon</label> <input id="d" type="range" min="1" max="10" value="5">' +
	'<p id="pull">Pull: 4.0</p>' +
	'<script>var d=document.getElementById("d");function show(){var r=Number(d.value);' +
	'document.getElementById("pull").textContent="Pull: "+(100/(r*r)).toFixed(1);}' +
	'd.addEventListener("input",show);show();</script>';

const CDN_DEMO =
	"<style>body{font:15px -apple-system,sans-serif;padding:16px;color:#111}</style>" +
	'<p id="cdn">Loading the library…</p>' +
	'<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>' +
	'<script>document.getElementById("cdn").textContent = typeof _ === "function" ? "Library loaded: " + _.chunk([1,2,3,4], 2).length + " chunks" : "No library";</script>';

const BLOCKED_DEMO =
	'<script src="https://example.com/plot.js"></script><p>This needs a blocked host.</p>';

/**
 * LH_E2E_ARTIFACTS=1: the session "Artifacts check", made through the
 * desktop API, then filled with one learner message, the steer messages
 * (fork buildSubagentSteer) and the photo snapshot.
 */
async function addArtifacts(
	url: string,
	headers: Record<string, string>,
	chats: string,
	ports: CanaryPorts,
) {
	const res = await fetch(`${url}/api/chats`, {
		method: "POST",
		headers,
		body: JSON.stringify({ title: "Artifacts check" }),
	});
	if (!res.ok) throw new Error(`artifacts: ${await res.text()}`);
	const id = String(((await res.json()) as { id: unknown }).id);
	const file = path.join(chats, `${id}.json`);
	const record = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
	const snapshotId = createHash("sha256")
		.update(Buffer.from(ARTIFACT_PHOTO, "base64"))
		.digest("hex");
	const start = Date.now() - 600_000;
	let n = 0;
	const steer = (name: string, kind: "visual" | "demo", result: unknown) => {
		n += 1;
		return {
			id: `steer_job_e2e_${name}`,
			role: "custom",
			customType: "subagent-steer",
			content: `The ${kind} sub-agent finished (${name}).`,
			display: true,
			details: { jobId: `job_e2e_${name}`, kind, toolCallId: `call_e2e_${name}`, result },
			timestamp: start + n * 1000,
		};
	};
	const demo = (title: string, html: string) => ({ title, html, tested: true });
	record.messages = [
		{
			id: "msg_e2e_artifacts_user",
			role: "user",
			content: "Show me the tides with figures and demos.",
			timestamp: start,
		},
		steer("figure", "visual", { svg: FIGURE_SVG, notes: "The near and the far bulge." }),
		steer("slider", "demo", demo("Pull and distance", SLIDER_DEMO)),
		steer("photo", "visual", {
			svg:
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">' +
				'<image href="learner-image" x="0" y="0" width="200" height="120" preserveAspectRatio="none"/>' +
				'<circle cx="100" cy="60" r="30" fill="none" stroke="#c00" stroke-width="4"/></svg>',
			image: { path: "/tmp/e2e-photo.png", snapshotId },
		}),
		steer("cdn", "demo", demo("Library from jsDelivr", CDN_DEMO)),
		steer("blocked", "demo", demo("Blocked host", BLOCKED_DEMO)),
		steer("failed", "demo", demo("Empty demo", "")),
		steer("canary", "demo", demo("Canary", canaryDemo(ports))),
	];
	record.imageSnapshots = {
		[snapshotId]: { mimeType: "image/png", data: ARTIFACT_PHOTO, width: 8, height: 8 },
	};
	record.updatedAt = new Date().toISOString();
	fs.writeFileSync(file, JSON.stringify(record));
	console.log(`[artifacts] session ${id} with ${n} artifacts`);
}
