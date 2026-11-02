// Run: node scripts/bill-due.check.js
// Bills' due dates: the voucher export asks Tally for each bill's credit period by name (with the plain fetch a bill
// saved as "15 Days" came back without one), and falls back to the plain export when Tally refuses the longer one.
const assert = require("node:assert/strict");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { TallyClient } = require("../src/agent/tally-client");

const VOUCHER = `<ENVELOPE><VOUCHER><DATE>20261102</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>8</VOUCHERNUMBER>
<PARTYLEDGERNAME>FH Test Customer</PARTYLEDGERNAME><AMOUNT>-236.00</AMOUNT>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>FH Test Customer</LEDGERNAME><AMOUNT>-236.00</AMOUNT>
<BILLALLOCATIONS.LIST><NAME>FHT-001</NAME><BILLTYPE>New Ref</BILLTYPE><BILLCREDITPERIOD JD="45612" P="15 Days">15 Days</BILLCREDITPERIOD><AMOUNT>-236.00</AMOUNT></BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST></VOUCHER></ENVELOPE>`;

(async () => {
  const client = new TallyClient(() => ({}));
  const asked = [];
  client.postXml = async (xml) => { asked.push(xml.includes("BillAllocations.BillCreditPeriod") ? "bills" : "plain"); return VOUCHER; };
  await client.voucherListXml("Aihive");
  assert.deepEqual(asked, ["bills"], "the credit periods are asked for");

  // a Tally that errors on the longer fetch: the plain one, and it isn't asked again
  const c2 = new TallyClient(() => ({}));
  const asked2 = [];
  c2.postXml = async (xml) => { const bills = xml.includes("BillAllocations.BillCreditPeriod"); asked2.push(bills ? "bills" : "plain"); if (bills) throw new Error("Unknown method"); return VOUCHER; };
  await c2.voucherListXml("Aihive");
  await c2.voucherListXml("Aihive");
  assert.deepEqual(asked2, ["bills", "plain", "plain"]);

  // one that answers with no vouchers at all: never trusted (the sync would retire every voucher) — the plain one
  const c3 = new TallyClient(() => ({}));
  const asked3 = [];
  c3.postXml = async (xml) => { const bills = xml.includes("BillAllocations.BillCreditPeriod"); asked3.push(bills ? "bills" : "plain"); return bills ? "<ENVELOPE></ENVELOPE>" : VOUCHER; };
  assert.match(await c3.voucherListXml("Aihive"), /<VOUCHER>/);
  assert.deepEqual(asked3, ["bills", "plain"]);

  // the bill's due date comes from its credit period
  const v = client.parseVouchers(VOUCHER)[0];
  const bill = (v.bill_allocations || []).find((b) => b.bill_name === "FHT-001");
  assert.ok(bill, JSON.stringify(v.bill_allocations));
  assert.equal(bill.due_date || null, "2026-11-17", JSON.stringify(bill));

  console.log("bill-due check passed");
})().catch((e) => { console.error(e); process.exit(1); });
