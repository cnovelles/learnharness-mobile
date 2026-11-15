// Maestro runScript: clear or set the test Mac's models through its control
// server (scripts/e2e-mac.ts). Env: CONTROL (the server URL), ACTION
// ("clear" or "set").
const res = http.post(`${CONTROL}/models/${ACTION}`, { body: "" });
if (res.status !== 200) throw new Error(`models ${ACTION} failed: ${res.status} ${res.body}`);
