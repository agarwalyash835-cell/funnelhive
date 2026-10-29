// Run: node scripts/ledger-mailing.check.js
// A ledger's address, state, country, pincode and mailing name only persist inside <LEDMAILINGDETAILS.LIST>. Loose tags
// under <LEDGER> are accepted by TallyPrime and silently dropped, so the address could never be read back.
const assert = require("node:assert/strict");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const { TallyClient, ledgerMailingDetailsXml, parseLedgerMailing, financialYearStartYmd } = require("../src/agent/tally-client");
const squash = (x) => x.replace(/\s+/g, " ");

const client = new TallyClient(() => ({}));

// write: everything goes into ONE mailing block, one <ADDRESS> per line, dated from the financial-year start
const xml = squash(
  client.alterLedgerXml({ name: "L", address: "7 Park Street\nKolkata", state: "West Bengal", pincode: "700016", country: "India", mailing_name: "L Pvt", company_name: "Acme" })
);
assert.match(xml, /<LEDMAILINGDETAILS\.LIST>/);
assert.match(xml, /<ADDRESS\.LIST TYPE="String"><ADDRESS>7 Park Street<\/ADDRESS><ADDRESS>Kolkata<\/ADDRESS><\/ADDRESS\.LIST>/);
assert.match(xml, /<APPLICABLEFROM>\d{8}<\/APPLICABLEFROM>/);
assert.match(xml, /<STATE>West Bengal<\/STATE>/);
assert.match(xml, /<COUNTRY>India<\/COUNTRY>/);
assert.match(xml, /<PINCODE>700016<\/PINCODE>/);
assert.match(xml, /<MAILINGNAME>L Pvt<\/MAILINGNAME>/);
assert.ok(!/<STATENAME>|<COUNTRYNAME>/.test(xml), "the loose tags TallyPrime drops must not be sent");
assert.ok(!/<LEDGER NAME="L" ACTION="Alter"> <NAME>L<\/NAME> <ADDRESS\.LIST/.test(xml), "no loose ADDRESS.LIST directly under LEDGER");

// nothing to say => no block (an alter that does not touch the address must not blank it)
assert.equal(ledgerMailingDetailsXml({ name: "L", email: "a@b.co" }), "");

// the financial year start
assert.equal(financialYearStartYmd(new Date("2026-10-06T00:00:00Z")), "20260401");
assert.equal(financialYearStartYmd(new Date("2027-02-10T00:00:00Z")), "20260401");
assert.equal(financialYearStartYmd(new Date("2026-03-31T10:00:00Z")), "20250401");

// read: the latest block wins; address lines are joined by the caller
const exported = `<LEDGER NAME="L"><LEDMAILINGDETAILS.LIST><ADDRESS.LIST TYPE="String"><ADDRESS>Old Rd</ADDRESS></ADDRESS.LIST><APPLICABLEFROM>20250401</APPLICABLEFROM><STATE>Karnataka</STATE></LEDMAILINGDETAILS.LIST>
<LEDMAILINGDETAILS.LIST><ADDRESS.LIST TYPE="String"><ADDRESS>12 MG Road</ADDRESS><ADDRESS>Bangalore</ADDRESS></ADDRESS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><PINCODE>560001</PINCODE><MAILINGNAME>L Pvt</MAILINGNAME><STATE>Karnataka</STATE><COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST></LEDGER>`;
const m = parseLedgerMailing(exported);
assert.deepEqual(m.addressLines, ["12 MG Road", "Bangalore"]);
assert.equal(m.pincode, "560001");
assert.equal(m.mailingName, "L Pvt");
assert.equal(m.country, "India");
// an empty list (ledger without an address) parses to nothing
assert.deepEqual(parseLedgerMailing('<LEDGER NAME="X"><LEDMAILINGDETAILS.LIST> </LEDMAILINGDETAILS.LIST></LEDGER>').addressLines, []);

// full parse of a ledger list reaches the mirror fields
const list = `<ENVELOPE><LEDGER NAME="L" RESERVEDNAME=""><GUID TYPE="String">g1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT>${exported.replace('<LEDGER NAME="L">', "").replace("</LEDGER>", "")}</LEDGER></ENVELOPE>`;
const [rec] = client.parseLedgers(list);
assert.equal(rec.address, "12 MG Road, Bangalore");
assert.equal(rec.state, "Karnataka");
assert.equal(rec.pincode, "560001");
assert.equal(rec.mailing_name, "L Pvt");
console.log("ledger mailing check passed.");
