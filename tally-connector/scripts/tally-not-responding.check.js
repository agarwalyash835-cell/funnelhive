// Run: node scripts/tally-not-responding.check.js
// A TallyPrime that is waiting on a screen (Backup Schedule, a confirmation, an error box) accepts the connection and
// never answers. That used to surface as "This operation was aborted" - or, from the heartbeat, as a PORT_CLOSED
// message telling people to reconfigure a port that was fine. It must say what is actually going on.
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { TallyClient, classifyTallyError } = require("../src/agent/tally-client");

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

(async () => {
  // a TallyPrime stand-in that accepts requests and never answers
  const hung = http.createServer(() => {});
  await new Promise((r) => hung.listen(0, "127.0.0.1", r));
  const hungPort = hung.address().port;

  const client = new TallyClient(() => ({ tallyHost: "127.0.0.1", tallyPort: hungPort }));
  client.probeTimeoutMs = 300;

  await assert.rejects(client.postXml("<x/>", { timeoutMs: 200 }), (e) => {
    assert.equal(e.code, "TALLY_NOT_RESPONDING");
    assert.match(e.message, /did not answer within/);
    assert.match(e.message, /Backup Schedule/);
    assert.match(e.message, /aborted/); // runtime.js halts a sync when it sees "aborted"
    return true;
  });

  // the heartbeat probe: a distinct ERROR status with the explanation, not PORT_CLOSED
  const status = await client.detect();
  assert.equal(status.tally_status, "ERROR");
  assert.match(status.error, /waiting on a screen/);

  // a closed port is still reported as unreachable
  const closed = new TallyClient(() => ({ tallyHost: "127.0.0.1", tallyPort: 1 }));
  await assert.rejects(closed.postXml("<x/>", { timeoutMs: 2000 }), (e) => e.code === "TALLY_UNREACHABLE" && /not reachable/.test(e.message));

  // errors that are not connection problems pass through untouched
  const other = new Error("Tally HTTP 500: boom");
  assert.equal(classifyTallyError(other, "http://x", 1000), other);

  hung.closeAllConnections?.();
  hung.close();
  console.log("tally not-responding check passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
