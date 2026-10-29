// Run: node scripts/unit-delete.check.js
// A unit Delete without <NAME> makes TallyPrime stop answering (verified live: it froze twice). Every master Delete the
// agent builds must carry <NAME>, with the company, in the same request shape the other deletes use.
const assert = require("node:assert/strict");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { TallyClient } = require("../src/agent/tally-client");
const { tallyUnitEnvelope } = require("../src/agent/xml");
const squash = (x) => x.replace(/\s+/g, " ");

const client = new TallyClient(() => ({}));
for (const payload of [{ name: "ZZUnit", company_name: "Acme" }, { name: "ZZUnit" }]) {
  const xml = squash(client.deleteUnitXml(payload));
  assert.match(xml, /<UNIT NAME="ZZUnit" ACTION="Delete">/);
  assert.match(xml, /<NAME>ZZUnit<\/NAME>/, "a Delete without <NAME> freezes TallyPrime");
}
assert.match(squash(client.deleteUnitXml({ name: "ZZUnit", company_name: "Acme" })), /<SVCURRENTCOMPANY>Acme<\/SVCURRENTCOMPANY>/);

// the shared unit envelope must not produce the bare form either
assert.match(squash(tallyUnitEnvelope({ companyName: "Acme", name: "ZZUnit", action: "Delete" })), /<UNIT NAME="ZZUnit" ACTION="Delete"> <NAME>ZZUnit<\/NAME>/);

// the other master deletes already carry it
for (const [fn, kind] of [["deleteGodownXml", "GODOWN"]]) {
  assert.match(squash(client[fn]({ name: "ZZ", company_name: "Acme" })), new RegExp(`<${kind} NAME="ZZ" ACTION="Delete"> <NAME>ZZ</NAME>`));
}
assert.match(squash(client.masterXml("LEDGER", "ZZ", "Delete", "", undefined, "Acme")), /<LEDGER NAME="ZZ" ACTION="Delete"> <NAME>ZZ<\/NAME>/);
assert.match(squash(client.masterXml("STOCKITEM", "ZZ", "Delete", "", undefined, "Acme")), /<STOCKITEM NAME="ZZ" ACTION="Delete"> <NAME>ZZ<\/NAME>/);
// "Cannot be deleted!" is TallyPrime refusing a master that is still in use; the message must say so (bug #23: it was
// not an agent fault - a fresh unused ledger deletes fine).
(async () => {
  client.postXml = async () => "<RESPONSE><LINEERROR>Cannot be deleted!</LINEERROR><ERRORS>0</ERRORS></RESPONSE>";
  await assert.rejects(client.postImport(client.deleteGodownXml({ name: "X" }), "Delete", "DELETE_GODOWN"), /Cannot be deleted!.*still in use/);
  console.log("unit delete check passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
