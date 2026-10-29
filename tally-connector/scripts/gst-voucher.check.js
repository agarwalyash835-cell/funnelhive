// GST lines from the backend: the party is charged taxable value + tax, the tax ledgers sit on the revenue / purchase
// side, and every voucher balances (sum of ledger + inventory amounts = 0)
const assert = require("node:assert/strict");
const { TallyClient } = require("../src/agent/tally-client");

const client = new TallyClient(() => ({}));
const amounts = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"))].map((m) => Number((m[0].match(/<AMOUNT>([^<]+)<\/AMOUNT>/) || [])[1]));
const lineFor = (xml, ledger) => { const m = xml.match(new RegExp(`<LEDGERNAME>${ledger}</LEDGERNAME>\\s*<ISDEEMEDPOSITIVE>(\\w+)</ISDEEMEDPOSITIVE>[\\s\\S]*?<AMOUNT>([^<]+)</AMOUNT>`)); return m && { positive: m[1], amount: Number(m[2]) }; };

// a sale with items, intra-state 18%
const sale = client.createVoucherXml({ voucher_type: "Sales", party_name: "Sharma", offset_ledger: "Sales A/c", date: "2026-10-02", bill_number: "FH/9",
  items: [{ stock_item_name: "TMT", quantity: 2, rate: 500 }], taxes: [{ ledger_name: "Output CGST", amount: 90 }, { ledger_name: "Output SGST", amount: 90 }] });
assert.deepEqual(lineFor(sale, "Sharma"), { positive: "Yes", amount: -1180 });
assert.deepEqual(lineFor(sale, "Output CGST"), { positive: "No", amount: 90 });
assert.match(sale, /<NAME>FH\/9<\/NAME>\s*<BILLTYPE>New Ref<\/BILLTYPE>\s*<AMOUNT>-1180.00<\/AMOUNT>/);
const saleSum = [...amounts(sale, "LEDGERENTRIES.LIST"), ...amounts(sale, "ALLINVENTORYENTRIES.LIST")].reduce((s, n) => s + n, 0);
assert.equal(Math.round(saleSum * 100), 0, "the sale balances");

// a purchase by amount, interstate 5%
const buy = client.createVoucherXml({ voucher_type: "Purchase", party_name: "Gupta", offset_ledger: "Purchase A/c", date: "2026-10-02", amount: 2000, taxes: [{ ledger_name: "Input IGST", amount: 100 }] });
assert.deepEqual(lineFor(buy, "Gupta"), { positive: "No", amount: 2100 });
assert.deepEqual(lineFor(buy, "Purchase A/c"), { positive: "Yes", amount: -2000 });
assert.deepEqual(lineFor(buy, "Input IGST"), { positive: "Yes", amount: -100 });
assert.equal(amounts(buy, "ALLLEDGERENTRIES.LIST").reduce((s, n) => s + n, 0), 0, "the purchase balances");

// reading it back (TallyPrime 7.2 export order): the voucher amount is the party's total, not the first pre-tax line
const [read] = client.parseVouchers(`<ENVELOPE><VOUCHER><DATE>20261002</DATE><GUID>g-2</GUID><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Purchase A/c</LEDGERNAME><AMOUNT>-2000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Gupta</LEDGERNAME><AMOUNT>2100.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>GS/60</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>2100.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Input IGST</LEDGERNAME><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></ENVELOPE>`);
assert.deepEqual([read.party_name, read.amount], ["Gupta", 2100]);

// no taxes → unchanged
const plain = client.createVoucherXml({ voucher_type: "Sales", party_name: "Sharma", offset_ledger: "Sales A/c", date: "2026-10-02", amount: 500 });
assert.doesNotMatch(plain, /GST/);
console.log("gst-voucher check passed");
