// Run: node scripts/command-timeout.check.js
// A Tally command that never finishes must turn into a reported failure instead of staying "SENT" until the backend expires it.
const assert = require("node:assert/strict");
const Module = require("node:module");

// runtime.js pulls in electron; stub it so the helper can be exercised under plain node.
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {}, BrowserWindow: class {}, Notification: class {} };
  return realLoad.call(this, request, ...rest);
};
const { withCommandTimeout, COMMAND_TIMEOUT_MS } = require("../src/agent/runtime");

(async () => {
  assert.ok(COMMAND_TIMEOUT_MS >= 120_000, "must be longer than one Tally HTTP call (120s)");
  assert.equal(await withCommandTimeout(Promise.resolve("ok"), "CREATE_RECEIPT", 50), "ok");
  await assert.rejects(
    withCommandTimeout(new Promise(() => {}), "CREATE_RECEIPT", 30),
    (err) => err.code === "COMMAND_TIMEOUT" && /CREATE_RECEIPT/.test(err.message) && /duplicate/.test(err.message)
  );
  await assert.rejects(withCommandTimeout(Promise.reject(new Error("boom")), "X", 50), /boom/);
  console.log("command timeout check passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
