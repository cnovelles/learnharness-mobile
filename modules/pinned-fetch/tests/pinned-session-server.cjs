// Starts two HTTPS servers with different certificates, runs the Swift
// PinnedSession test binary against them, and checks what each server got.
const { execFile } = require("node:child_process");
const https = require("node:https");

const [fork, binary] = process.argv.slice(2);
const tls = require(`${fork}/electron/phone-access-tls.cjs`);

function server() {
	const credentials = tls.createCertificate();
	const seen = [];
	const srv = https.createServer(credentials, (req, res) => {
		seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
		res.end("hello");
	});
	return new Promise((resolve) =>
		srv.listen(0, "127.0.0.1", () =>
			resolve({
				srv,
				seen,
				pin: tls.spkiPin(credentials.cert),
				url: `https://127.0.0.1:${srv.address().port}`,
			}),
		),
	);
}

function runBinary(url, pin, expect) {
	return new Promise((resolve) =>
		execFile(binary, [url, pin, expect], { encoding: "utf8" }, (err, stdout) =>
			resolve({ ok: !err, out: stdout.trim() }),
		),
	);
}

(async () => {
	const mac = await server();
	const impostor = await server();
	let failed = false;
	const check = (ok, text) => {
		console.log(`${ok ? "ok" : "FAIL"}: ${text}`);
		if (!ok) failed = true;
	};
	try {
		const good = await runBinary(`${mac.url}/phone/v1/ping`, mac.pin, "ok");
		check(good.ok, `right pin: ${good.out}`);
		check(
			mac.seen.length === 1 &&
				mac.seen[0] === "GET /phone/v1/ping Bearer secret-token-for-the-test",
			`the Mac got the request: ${JSON.stringify(mac.seen)}`,
		);
		const bad = await runBinary(`${impostor.url}/phone/v1/ping`, mac.pin, "mismatch");
		check(bad.ok, `wrong certificate: ${bad.out}`);
		check(impostor.seen.length === 0, `the impostor got nothing: ${JSON.stringify(impostor.seen)}`);
	} finally {
		mac.srv.close();
		impostor.srv.close();
	}
	process.exit(failed ? 1 : 0);
})();
