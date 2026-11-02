// Run: node scripts/no-period-exports.check.js
// The ledger and stock lists must not ask TallyPrime for a period: SVFROMDATE / SVTODATE on "List of Ledgers" froze it
// (no answer, every request after it queued — live, connector 1.1.4–1.1.7).
const assert = require("node:assert/strict");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { TallyClient } = require("../src/agent/tally-client");

(async () => {
  const client = new TallyClient(() => ({}));
  const sent = [];
  client.postXml = async (xml) => { sent.push(xml); return "<ENVELOPE></ENVELOPE>"; };
  await client.ledgers("g", "Aihive");
  await client.stockItems("g", "Aihive");
  assert.equal(sent.length, 2);
  for (const xml of sent) assert.doesNotMatch(xml, /SVFROMDATE|SVTODATE/, "no period on the master lists");
  console.log("no-period-exports check passed");
})().catch((e) => { console.error(e); process.exit(1); });
