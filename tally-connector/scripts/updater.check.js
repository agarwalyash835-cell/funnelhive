// Run: node scripts/updater.check.js
// The connector updates itself: only to a newer version, only with a download whose size and SHA-256 match what the
// server published, never while a Tally change runs, and by running the installer silently, then quitting.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const spawned = [];
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "node:child_process") return { spawn: (file, args) => (spawned.push({ file, args }), { unref() {} }) };
  return realLoad.call(this, request, ...rest);
};
const { Updater, newer } = require("../src/agent/updater");

(async () => {
  assert.equal(newer("1.1.10", "1.1.9"), true);
  assert.equal(newer("1.1.3", "1.1.3"), false);
  assert.equal(newer("1.0.9", "1.1.0"), false);

  const exe = Buffer.from("fake installer bytes");
  const sha = crypto.createHash("sha256").update(exe).digest("hex");
  let release = { version: "1.1.4", url: "/downloads/funnelhive-tally-connector-setup.exe", sha256: sha, size: exe.length };
  global.fetch = async (url) => (String(url).includes("/update")
    ? { ok: true, json: async () => release }
    : { ok: true, arrayBuffer: async () => exe });

  let quit = 0, busy = false;
  const log = { log() {}, warn() {} };
  const mk = (current) => new Updater({ current, platform: "win32", apiBase: "https://app.test", isBusy: () => busy, quit: () => quit++, log });

  // already current: nothing happens
  const same = mk("1.1.4");
  await same.check();
  assert.equal(same.status.state, "current");
  assert.equal(spawned.length, 0);

  // a bad download is refused
  release = { ...release, sha256: "0".repeat(64) };
  const bad = mk("1.1.3");
  await bad.check();
  assert.equal(bad.status.state, "error");
  assert.match(bad.status.error, /checksum/);
  assert.equal(spawned.length + quit, 0, "nothing installed");

  // a good one installs silently and the app quits
  release = { ...release, sha256: sha };
  const good = mk("1.1.3");
  await good.check();
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, ["/S", "--force-run"]);
  assert.match(spawned[0].file, /funnelhive-tally-connector-1\.1\.4-setup\.exe$/);
  assert.equal(quit, 1);

  // nothing published, or not Windows: no update
  release = { version: null };
  assert.equal(await mk("1.1.3").latest(), null);
  const mac = new Updater({ current: "1.0.0", platform: "darwin", log });
  await mac.check();
  assert.equal(mac.status.state, "idle");

  console.log("updater check passed");
})().catch((e) => { console.error(e); process.exit(1); });
