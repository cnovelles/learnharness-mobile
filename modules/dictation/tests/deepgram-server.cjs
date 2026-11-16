// A fake Deepgram for tests/run-deepgram-test.sh. It checks the token in
// the WebSocket subprotocol, counts the audio bytes, and answers
// CloseStream with one final result and a normal close. Path /drop closes
// the socket in the middle of a run (the "connection lost" case).
// Usage: LH_FORK=<fork> node deepgram-server.cjs <swift test binary>
// The fork's `ws` (8.x): the phone's node_modules has an older one.
const { WebSocketServer } = require(`${process.env.LH_FORK}/node_modules/ws`);
const { spawn } = require("node:child_process");

const wss = new WebSocketServer({
	port: 0,
	host: "127.0.0.1",
	handleProtocols: (protocols) => (protocols.has("bearer") ? "bearer" : false),
});
wss.on("connection", (socket, req) => {
	const protocols = String(req.headers["sec-websocket-protocol"] ?? "");
	if (!protocols.includes("test-token")) return socket.close(4001, "bad token");
	let bytes = 0;
	socket.on("message", (data, binary) => {
		if (binary) {
			bytes += data.length;
			if (req.url.startsWith("/drop") && bytes >= 3200) socket.terminate();
			return;
		}
		if (JSON.parse(String(data)).type === "CloseStream") {
			const transcript = `heard ${bytes} bytes`;
			socket.send(
				JSON.stringify({
					type: "Results",
					is_final: false,
					channel: { alternatives: [{ transcript: "not final" }] },
				}),
			);
			socket.send(
				JSON.stringify({
					type: "Results",
					is_final: true,
					channel: { alternatives: [{ transcript }] },
				}),
			);
			socket.close(1000);
		}
	});
});
wss.on("listening", () => {
	const port = wss.address().port;
	const child = spawn(process.argv[2], [String(port)], { stdio: "inherit" });
	child.on("exit", (code) => {
		wss.close();
		process.exit(code ?? 1);
	});
});
