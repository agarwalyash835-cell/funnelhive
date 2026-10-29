// Run: node scripts/godown-commands.check.js
// ALTER_GODOWN / DELETE_GODOWN (tally_propose_alter_godown / tally_propose_delete_godown) reach TallyPrime as the same
// master Alter / Delete imports the other masters use, carrying the company and an optional rename.
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
  const squash = (x) => x.replace(/\s+/g, " ");

  const alter = squash(client.alterGodownXml({ name: "ZZ Godown", parent: "Primary", address: "1 Test Street", company_name: "Acme" }));
  assert.match(alter, /<GODOWN NAME="ZZ Godown" ACTION="Alter">/);
  assert.match(alter, /<PARENT>Primary<\/PARENT>/);
  assert.match(alter, /<ADDRESS>1 Test Street<\/ADDRESS>/);
  assert.match(alter, /<SVCURRENTCOMPANY>Acme<\/SVCURRENTCOMPANY>/);
  assert.match(alter, /<NAME>ZZ Godown<\/NAME>/, "without new_name the name is kept");

  const renamed = squash(client.alterGodownXml({ name: "ZZ Godown", new_name: "ZZ Godown B" }));
  assert.match(renamed, /<GODOWN NAME="ZZ Godown" ACTION="Alter">/);
  assert.match(renamed, /<NAME>ZZ Godown B<\/NAME>/);

  const del = squash(client.deleteGodownXml({ name: "ZZ Godown", company_name: "Acme" }));
  assert.match(del, /<GODOWN NAME="ZZ Godown" ACTION="Delete">/);
  assert.match(del, /<SVCURRENTCOMPANY>Acme<\/SVCURRENTCOMPANY>/);

  // executeCommand dispatches both, and the delete must report its own Delete counter
  const sent = [];
  client.assertWriteCompany = async () => {};
  client.postImport = async (xml, expected, label) => (sent.push({ expected, label }), { ok: true });
  await client.executeCommand({ command_type: "ALTER_GODOWN", payload: { name: "G" } });
  await client.executeCommand({ command_type: "DELETE_GODOWN", payload: { name: "G" } });
  assert.deepEqual(sent, [
    { expected: undefined, label: "ALTER_GODOWN" },
    { expected: "Delete", label: "DELETE_GODOWN" },
  ]);
  console.log("godown commands check passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
