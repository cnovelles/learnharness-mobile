// Maestro runScript: read the canary hits of the test Mac (scripts/e2e-mac.ts,
// LH_E2E_ARTIFACTS=1) through its control server. Env: CONTROL (the server
// URL). Each try has its own TCP port, so each hit names its try.
// Pass: no UDP hit, and no TCP hit except the known ones below.
// KNOWN: "blank" (a script click on <a target="_blank">). WebKit opens a TCP
// connection and starts TLS to the link's host before the app refuses the
// new window; no request is sent. See the security review, section 8.
const KNOWN = ["blank"];
const res = http.get(`${CONTROL}/canary`);
if (res.status !== 200) throw new Error(`canary read failed: ${res.status} ${res.body}`);
const hits = json(res.body);
console.log(`canary hits: tcp ${hits.tcp}, udp ${hits.udp} ${JSON.stringify(hits.log)}`);
const unknown = hits.log.filter((line) => KNOWN.every((name) => line !== `tcp ${name}`));
output.canary = `tcp ${hits.tcp}, udp ${hits.udp}, known ${hits.log.length - unknown.length}`;
if (unknown.length > 0)
	throw new Error(`the canary demo reached the network: ${JSON.stringify(unknown)}`);
