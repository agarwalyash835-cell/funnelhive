// Run: node scripts/voucher-lookup.check.js
// Voucher lookups must see vouchers on ANY date. The Day Book only lists the period TallyPrime has open, so a voucher
// dated outside it looked "absent" and deletes/cancels were reported as done (or wrongly refused) without being checked.
const assert = require("node:assert/strict");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { TallyClient } = require("../src/agent/tally-client");

const COLLECTION = `<ENVELOPE><BODY><DATA><COLLECTION>
<VOUCHER>2</VOUCHER>
<VOUCHER REMOTEID="g-1" VCHTYPE="Receipt"><DATE>20260401</DATE><VOUCHERNUMBER>1</VOUCHERNUMBER><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><GUID>g-1</GUID><ISCANCELLED>No</ISCANCELLED></VOUCHER>
<VOUCHER REMOTEID="g-9" VCHTYPE="Sales"><DATE>20261031</DATE><VOUCHERNUMBER>9</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><GUID>g-9</GUID><ISCANCELLED>No</ISCANCELLED></VOUCHER>
</COLLECTION></DATA></BODY></ENVELOPE>`;
const DAY_BOOK = COLLECTION.replace(/<VOUCHER REMOTEID="g-9"[\s\S]*?<\/VOUCHER>/, ""); // open period only

(async () => {
  const client = new TallyClient(() => ({ tallyHost: "localhost", tallyPort: 9000 }));
  const sent = [];
  client.postXml = async (xml) => {
    sent.push(xml);
    return /<ID>VouchersColl<\/ID>/.test(xml) ? COLLECTION : DAY_BOOK;
  };

  // A voucher outside the Day Book's period is found through the collection.
  const xml = await client.dayBookFor({ company_name: "Co", date: "2026-10-31" });
  assert.ok(sent.every((x) => /VouchersColl/.test(x)), "lookup must use the voucher collection, not the Day Book");
  const block = client.findVoucherBlock(xml, { voucher_type: "Sales", voucher_number: "9", date: "2026-10-31" });
  assert.ok(block, "a voucher dated outside the open period must be found");

  // The collection failing falls back to the Day Book instead of breaking every write.
  const origError = console.error;
  console.error = () => {};
  client.postXml = async (xml) => {
    if (/VouchersColl/.test(xml)) throw new Error("collection unavailable");
    return DAY_BOOK;
  };
  const fallback = await client.dayBookFor({ company_name: "Co", date: "2026-04-01" });
  console.error = origError;
  assert.ok(client.findVoucherBlock(fallback, { voucher_type: "Receipt", voucher_number: "1", date: "2026-04-01" }));

  // Absent from the full collection => already gone: delete is idempotent, cancel is an error (nothing to cancel).
  client.postXml = async () => COLLECTION;
  client.assertWriteCompany = async () => {};
  const gone = { voucher_type: "Sales", voucher_number: "404", date: "2026-10-31", company_name: "Co" };
  assert.equal((await client.deleteVoucherVerified({ ...gone })).deleted, 1);
  await assert.rejects(client.cancelVoucherVerified({ ...gone }), (e) => e.code === "VOUCHER_NOT_IN_DAY_BOOK");

  // Absent from the Day Book FALLBACK proves nothing (it only lists the open period): never report success.
  client.postXml = async (xml) => {
    if (/VouchersColl/.test(xml)) throw new Error("collection unavailable");
    return DAY_BOOK;
  };
  console.error = () => {};
  await assert.rejects(client.deleteVoucherVerified({ ...gone }), (e) => e.code === "VOUCHER_NOT_IN_DAY_BOOK");
  await assert.rejects(client.cancelVoucherVerified({ ...gone }), (e) => e.code === "VOUCHER_NOT_IN_DAY_BOOK");
  console.error = origError;
  console.log("voucher lookup check passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
