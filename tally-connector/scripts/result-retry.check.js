// Run: node scripts/result-retry.check.js
// A command result must survive a backend that is briefly unreachable, and a failed report must never be turned into a
// FAILED result for a command that actually succeeded.
const assert = require("node:assert/strict");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { submitWithRetry, AgentRuntime } = require("../src/agent/runtime");

(async () => {
  const noWait = async () => {};
  const quiet = () => {};

  // network error twice, then success
  let calls = 0;
  const out = await submitWithRetry(async () => {
    calls++;
    if (calls < 3) throw new Error("fetch failed");
    return "ok";
  }, [10, 10, 10], noWait, quiet);
  assert.equal(out, "ok");
  assert.equal(calls, 3);

  // a 5xx and 429 are retried, a 4xx is not
  let n = 0;
  await submitWithRetry(async () => { n++; if (n === 1) { const e = new Error("bad gateway"); e.status = 502; throw e; } return 1; }, [1], noWait, quiet);
  assert.equal(n, 2);
  let m = 0;
  await assert.rejects(submitWithRetry(async () => { m++; const e = new Error("not found"); e.status = 404; throw e; }, [1, 1], noWait, quiet), /not found/);
  assert.equal(m, 1);

  // gives up after the last delay
  let k = 0;
  await assert.rejects(submitWithRetry(async () => { k++; throw new Error("down"); }, [1, 1], noWait, quiet), /down/);
  assert.equal(k, 3);

  // executeBackendCommand: applied command + backend down for good => never reported as FAILED
  const reports = [];
  const rt = new AgentRuntime({
    store: { load: () => ({}), save: () => ({}) },
    backend: { submitCommandResult: async (id, body) => { reports.push(body.status); throw new Error("fetch failed"); } },
    tally: { executeCommand: async () => ({ altered: 1 }) },
  });
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = quiet;
  console.warn = quiet;
  // shorten the real backoff for the test by stubbing timers
  const origSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => origSetTimeout(fn, 0);
  await rt.executeBackendCommand({ id: "c1", command_type: "ALTER_LEDGER", payload: {} });
  global.setTimeout = origSetTimeout;
  console.error = origErr;
  console.warn = origWarn;
  assert.ok(reports.length >= 2, "the success report was retried");
  assert.deepEqual([...new Set(reports)], ["SUCCESS"], "an applied command must not be reported FAILED");
  console.log("result retry check passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
