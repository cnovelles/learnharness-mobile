// Maestro runScript: read the canary hits of the test Mac (scripts/e2e-mac.ts,
// LH_E2E_ARTIFACTS=1) through its control server. Env: CONTROL (the server
// URL). Pass: no TCP and no UDP hit. The log goes to the Maestro output.
const res = http.get(`${CONTROL}/canary`);
if (res.status !== 200) throw new Error(`canary read failed: ${res.status} ${res.body}`);
const hits = json(res.body);
console.log(`canary hits: tcp ${hits.tcp}, udp ${hits.udp} ${JSON.stringify(hits.log)}`);
if (hits.tcp !== 0 || hits.udp !== 0)
	throw new Error(`the canary demo reached the network: ${JSON.stringify(hits)}`);
