// TallyPrime 7.2 (seen live) exports a receipt with the bank as PARTYLEDGERNAME; the party is the line holding the bill.
const assert = require("node:assert/strict");
const { TallyClient } = require("../src/agent/tally-client");

const client = new TallyClient(() => ({}));
const xml = `<ENVELOPE><VOUCHER VCHTYPE="Receipt"><DATE>20261002</DATE><GUID>g-1</GUID><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>
<PARTYLEDGERNAME>HDFC Bank</PARTYLEDGERNAME>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sharma Steel Traders</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>10000.00</AMOUNT>
<BILLALLOCATIONS.LIST><NAME>FH/1</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>10000.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
</VOUCHER></ENVELOPE>`;
const [v] = client.parseVouchers(xml);
assert.equal(v.party_name, "Sharma Steel Traders");
assert.equal(v.bill_allocations[0].bill_name, "FH/1");
console.log("receipt-party check passed");
