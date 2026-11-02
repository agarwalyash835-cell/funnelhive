// Run: node scripts/clear-fields.check.js
// An edit that empties a field ("" in the payload) writes an empty tag — a field just left out stays as it is — and the
// record is read back: if TallyPrime kept the value (it still answers "altered"), the command fails naming the field.
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

  // the XML: emptied fields become empty tags; untouched ones stay out
  const g = squash(client.alterGodownXml({ name: "Main Warehouse", address: "" }));
  assert.match(g, /<ADDRESS\.LIST TYPE="String"><ADDRESS><\/ADDRESS><\/ADDRESS\.LIST>/);
  assert.doesNotMatch(g, /<PARENT>/, "a parent not sent isn't touched");
  assert.match(squash(client.alterGodownXml({ name: "W", parent: "" })), /<PARENT>&#4; Primary<\/PARENT>/);
  assert.doesNotMatch(squash(client.alterGodownXml({ name: "W", address: "1 Road" })), /ADDRESS\.LIST/, "a real address is written as before");

  const l = squash(client.alterLedgerXml({ name: "Ravi", email: "", phone: "", gstin: "", credit_period_days: "", state: "" }));
  for (const t of ["<EMAIL></EMAIL>", "<LEDGERPHONE></LEDGERPHONE>", "<PARTYGSTIN></PARTYGSTIN>", "<BILLCREDITPERIOD></BILLCREDITPERIOD>", "<STATE></STATE>"]) assert.ok(l.includes(t), t);
  assert.match(l, /<LEDMAILINGDETAILS\.LIST>/, "an emptied state still goes in the mailing details");
  assert.doesNotMatch(squash(client.alterLedgerXml({ name: "Ravi", phone: "98" })), /<EMAIL>/, "an email not sent isn't touched");

  assert.match(squash(client.alterUnitXml({ name: "Box", formal_name: "" })), /<ORIGINALNAME><\/ORIGINALNAME>/);
  const si = squash(client.alterStockItemXml({ name: "Rod", category: "", parent: "" }));
  assert.match(si, /<CATEGORY><\/CATEGORY>/);
  assert.match(si, /<PARENT>&#4; Primary<\/PARENT>/);

  // the read-back
  client.assertWriteCompany = async () => {};
  client.postImport = async () => ({ altered: 1 });
  let inTally = [{ name: "Main Warehouse", address: "Test address", parent: "\u0004 Primary" }];
  client.godowns = async () => inTally;
  await assert.rejects(
    client.executeCommand({ command_type: "ALTER_GODOWN", payload: { name: "Main Warehouse", address: "", company_name: "Aihive" } }),
    /TallyPrime kept the address/,
    "Tally said altered but kept it: the command fails",
  );
  inTally = [{ name: "Main Warehouse", address: null, parent: "\u0004 Primary" }];
  const ok = await client.executeCommand({ command_type: "ALTER_GODOWN", payload: { name: "Main Warehouse", address: "", parent: "", company_name: "Aihive" } });
  assert.equal(ok.verified, true);
  assert.deepEqual(ok.cleared, ["address", "parent"], "the root group counts as no parent");

  // nothing emptied: Tally's own answer, no read-back
  let read = 0;
  client.godowns = async () => { read++; return inTally; };
  await client.executeCommand({ command_type: "ALTER_GODOWN", payload: { name: "Main Warehouse", address: "New" } });
  assert.equal(read, 0);

  // a renamed record is found by its new name; one that can't be read back is reported as unverified, not failed
  client.ledgers = async () => [{ name: "Ravi Traders", email: null }];
  assert.equal((await client.executeCommand({ command_type: "ALTER_LEDGER", payload: { name: "Ravi", new_name: "Ravi Traders", email: "" } })).verified, true);
  client.ledgers = async () => [];
  assert.equal((await client.executeCommand({ command_type: "ALTER_LEDGER", payload: { name: "Ghost", email: "" } })).verified, false);

  console.log("clear-fields check passed");
})().catch((e) => { console.error(e); process.exit(1); });
