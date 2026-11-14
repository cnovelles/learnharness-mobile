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
 * 3. Teacher: one paragraph about the two tidal bulges.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";

const FORK = process.env.LH_FORK_DIR
	? path.resolve(process.env.LH_FORK_DIR)
	: path.resolve(import.meta.dirname, "../../learnharness");
const PAIRING_FILE = path.resolve(import.meta.dirname, "../e2e/.pairing.txt");

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
				{
					toolCalls: [
						{
							name: "probe_done",
							arguments: {
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
			teacher: [{ text: LESSON.teach, chunkSize: 8, chunkDelayMs: 30 }],
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
	const models = await fetch(`${server.url}/api/settings/models`, {
		method: "PUT",
		headers: json,
		body: JSON.stringify({
			strong: slot("fake-strong"),
			cheap: slot("fake-cheap"),
			vision: slot("fake-cheap"),
		}),
	});
	if (!models.ok) throw new Error(`models: ${await models.text()}`);
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
	console.log(`Test Mac ready. Data folder: ${server.dataDir}`);
	console.log(`Pairing text (also in ${PAIRING_FILE}):\n${text}`);

	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		fs.rmSync(PAIRING_FILE, { force: true });
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
