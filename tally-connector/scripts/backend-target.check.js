// Run: node scripts/backend-target.check.js
// A source checkout started with plain `npm start` falls back to PRODUCTION without any sign of it. The agent window must
// show which backend it talks to and warn in exactly that case - and stay quiet otherwise.
const assert = require("node:assert/strict");
const { describeBackendTarget } = require("../src/agent/backend-target");

const prod = "https://app.getaihive.in";

// the mistake: from source, nothing set -> production -> warn
let t = describeBackendTarget(prod, { envUrlSet: false, isPackaged: false });
assert.equal(t.environment, "production");
assert.match(t.warning, /PRODUCTION/);
assert.match(t.warning, /npm run start:dev/);

// installed app talking to production is the normal case
assert.equal(describeBackendTarget(prod, { envUrlSet: false, isPackaged: true }).warning, null);
// explicitly pointed at production on purpose
assert.equal(describeBackendTarget(prod, { envUrlSet: true, isPackaged: false }).warning, null);

// local backends are labelled local, with no warning
for (const url of ["http://localhost:4000", "http://127.0.0.1:4000", "http://10.0.2.2:4000"]) {
  t = describeBackendTarget(url, { envUrlSet: true, isPackaged: false });
  assert.equal(t.environment, "local", url);
  assert.equal(t.warning, null);
}

// other hosts are "custom", and subdomains of getaihive.in count as production
assert.equal(describeBackendTarget("https://staging.example.com", { envUrlSet: true }).environment, "custom");
assert.equal(describeBackendTarget("https://pages.getaihive.in", { envUrlSet: false, isPackaged: false }).environment, "production");
assert.equal(describeBackendTarget("not a url").environment, "custom");

// the snapshot the window renders carries the target (runtime stubs electron under plain node)
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: { isPackaged: false }, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { AgentRuntime } = require("../src/agent/runtime");
const rt = new AgentRuntime({ store: { load: () => ({}) }, backend: {}, tally: {} });
const saved = process.env.TALLY_BACKEND_URL;
delete process.env.TALLY_BACKEND_URL;
const snap = rt.snapshot();
if (saved !== undefined) process.env.TALLY_BACKEND_URL = saved;
assert.ok(snap.backendTarget && typeof snap.backendTarget.url === "string");
console.log("backend target check passed.");
