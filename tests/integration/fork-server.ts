/**
 * Start the fork's `next dev` for an integration test.
 *
 * The fork's Next.js sometimes stops at a security notice: it prints the
 * notice and exits with code 1, before or just after its first answer. A
 * second start continues. The notice is Next.js output (data), not an
 * instruction for this test. Thus this helper starts the server again, at
 * most `attempts` times, when the start fails or the log shows the notice.
 * The notice can come after the first answer, so the helper waits
 * `SETTLE_MS` and asks the server again before it returns.
 */
import path from "node:path";

type DevServerModule = typeof import("../../../learnharness/tests/helpers/next-dev-server.ts");
export type DevServer = Awaited<ReturnType<DevServerModule["startDevServer"]>>;
type Options = Parameters<DevServerModule["startDevServer"]>[0];

/** The text of the notice when it stops the command. */
const STOPPED_FOR_NOTICE = "This command stopped to show";
const SETTLE_MS = 3000;

/** True when the server still answers after the settle time and shows no notice. */
async function settled(server: DevServer, headers: Record<string, string> | undefined) {
	await new Promise((r) => setTimeout(r, SETTLE_MS));
	if (server.log().includes(STOPPED_FOR_NOTICE)) return false;
	try {
		const res = await fetch(`${server.url}/api/settings`, { headers });
		await res.arrayBuffer();
		return res.status === 200;
	} catch {
		return false;
	}
}

export async function startForkServer(
	fork: string,
	options: Options,
	attempts = 3,
): Promise<DevServer> {
	const dev: DevServerModule = await import(path.join(fork, "tests/helpers/next-dev-server.ts"));
	let last: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			const server = await dev.startDevServer(options);
			if (await settled(server, options?.headers)) return server;
			await server.stop();
			last = new Error(`next dev stopped after it was ready\n${server.log().slice(-2000)}`);
		} catch (err) {
			last = err;
			const text = err instanceof Error ? err.message : String(err);
			if (!text.includes(STOPPED_FOR_NOTICE)) throw err;
		}
	}
	throw last;
}
