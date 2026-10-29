// Self-check for Tally CRUD XML builders and import-response validation.
// Run with: node scripts/tally-crud.check.js
const assert = require("node:assert");
const { SYNC_COMMAND_TYPES, APP_VERSION } = require("../src/agent/constants");
const pkg = require("../package.json");
assert.equal(SYNC_COMMAND_TYPES.has("SYNC_GODOWNS"), true);
assert.equal(APP_VERSION, pkg.version);
const { TallyClient, createTallyVoucher, deleteTallyVoucher, cancelTallyVoucher, tallyUnitEnvelope, unitsExportEnvelope, vouchersListEnvelope, VOUCHER_COLLECTION_FETCH } = require("../src/agent/tally-client");
const { AgentRuntime, batchUploadPlan, SYNC_BATCH_SIZE, entityReconciles } = require("../src/agent/runtime");
assert.equal(entityReconciles("outstandings", "SYNC_INCREMENTAL"), true, "paid bills must leave the outstanding mirror");
const { parseTallyDate, dueFromCreditPeriod } = require("../src/agent/xml");

const client = new TallyClient(() => ({ tallyHost: "localhost", tallyPort: 9000 }));

// Import response validation: Tally errors must fail, applied changes must pass.
const posted = [];
client.postXml = async (xml) => {
  posted.push(xml);
  return client.__nextResponse;
};

async function expectRejects(promise, match) {
  try {
    await promise;
    assert.fail(`expected rejection matching ${match}`);
  } catch (err) {
    assert.match(err.message, match);
  }
}

(async () => {
  // 1. LINEERROR → failure even with HTTP 200.
  client.__nextResponse = "<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger 'X' does not exist!</LINEERROR></RESPONSE>";
  await expectRejects(client.postImport("<xml/>"), /Ledger 'X' does not exist/);

  // 2. Zero applied → failure.
  client.__nextResponse = "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><ERRORS>0</ERRORS></RESPONSE>";
  await expectRejects(client.postImport("<xml/>"), /did not apply/);

  // 3. Deleted counts as success.
  client.__nextResponse = "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>1</DELETED><ERRORS>0</ERRORS></RESPONSE>";
  const ok = await client.postImport("<xml/>");
  assert.strictEqual(ok.deleted, 1);

  // 3b. Delete/Cancel must report their own counters — a Cancel that reports
  // CREATED=1 (seen live: cancel marked SUCCESS while the voucher stayed
  // active) and a Delete without DELETED=1 are failures, not successes.
  client.__nextResponse = "<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><CANCELLED>0</CANCELLED><ERRORS>0</ERRORS></RESPONSE>";
  await expectRejects(client.postImport("<xml/>", "Cancel"), /did not cancel/);
  await expectRejects(client.postImport("<xml/>", "Delete"), /did not delete/);
  client.__nextResponse = "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><CANCELLED>1</CANCELLED><ERRORS>0</ERRORS></RESPONSE>";
  const cancelled = await client.postImport("<xml/>", "Cancel");
  assert.strictEqual(cancelled.cancelled, 1);

  // 4. XML builders carry the right ACTION and identity.
  const alterLedger = client.alterLedgerXml({ name: "Acme & Co", email: "a@b.com" });
  assert.match(alterLedger, /<LEDGER NAME="Acme &amp; Co" ACTION="Alter">/);
  assert.match(alterLedger, /<EMAIL>a@b.com<\/EMAIL>/);
  assert.ok(!alterLedger.includes("<PARENT>"), "Alter must not inject default parent");

  const deleteLedger = client.masterXml("LEDGER", "Acme", "Delete");
  assert.match(deleteLedger, /<LEDGER NAME="Acme" ACTION="Delete">/);

  const parsedLedgers = client.parseLedgers(`
    <ENVELOPE><BODY><DATA>
      <LEDGER NAME="ABC Traders">
        <GUID>guid-led-1</GUID>
        <MASTERID>9001</MASTERID>
        <PARENT>Sundry Debtors</PARENT>
      </LEDGER>
    </DATA></BODY></ENVELOPE>`);
  assert.strictEqual(parsedLedgers[0].tally_guid, "guid-led-1");
  assert.strictEqual(parsedLedgers[0].master_id, "9001");
  assert.notStrictEqual(parsedLedgers[0].tally_guid, parsedLedgers[0].master_id);

  const delVoucher = client.voucherActionXml(
    { voucher_type: "Sales", date: "2026-07-01", voucher_number: "42", tally_guid: "guid-1" },
    "Delete"
  );
  assert.match(delVoucher, /<VOUCHER VCHTYPE="Sales" ACTION="Delete">/);
  assert.ok(!delVoucher.includes("REMOTEID="), "export GUID must not become REMOTEID");
  assert.match(delVoucher, /<DATE>20260701<\/DATE>/);
  assert.match(delVoucher, /<VOUCHERNUMBER>42<\/VOUCHERNUMBER>/);

  // Dedicated deleteVoucherXml test matching exact Tally import structure
  const delVchXml = client.deleteVoucherXml({
    companyName: "Acme Corp",
    voucherType: "Payment",
    voucherNumber: "1",
    date: "2026-04-01",
  });
  assert.match(delVchXml, /<TALLYREQUEST>Import<\/TALLYREQUEST>/);
  assert.match(delVchXml, /<TYPE>Data<\/TYPE>/);
  assert.match(delVchXml, /<ID>Vouchers<\/ID>/);
  assert.match(delVchXml, /<SVCURRENTCOMPANY>Acme Corp<\/SVCURRENTCOMPANY>/);
  assert.match(
    delVchXml,
    /<VOUCHER\s+DATE="20260401"\s+TAGNAME="Voucher Number"\s+TAGVALUE="1"\s+VCHTYPE="Payment"\s+ACTION="Delete">\s*<\/VOUCHER>/
  );

  assert.throws(() => client.deleteVoucherXml({ voucherType: "Payment", voucherNumber: "1", date: "2026-04-01" }), /companyName is required/);
  assert.throws(() => client.deleteVoucherXml({ companyName: "Acme", voucherNumber: "1", date: "2026-04-01" }), /voucherType is required/);
  assert.throws(() => client.deleteVoucherXml({ companyName: "Acme", voucherType: "Payment", date: "2026-04-01" }), /voucherNumber is required/);
  assert.throws(() => client.deleteVoucherXml({ companyName: "Acme", voucherType: "Payment", voucherNumber: "1" }), /date is required/);

  // deleteTallyVoucher method tests
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><DELETED>1</DELETED></RESPONSE>",
  });
  const delOk = await client.deleteTallyVoucher({ companyName: "Acme", voucherType: "Payment", voucherNumber: "1", date: "2026-04-01" });
  assert.strictEqual(delOk.success, true);
  assert.strictEqual(delOk.code, "TALLY_VOUCHER_DELETED");

  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><LINEERROR>Voucher not found</LINEERROR></RESPONSE>",
  });
  const delFail = await client.deleteTallyVoucher({ companyName: "Acme", voucherType: "Payment", voucherNumber: "1", date: "2026-04-01" });
  assert.strictEqual(delFail.success, false);
  assert.strictEqual(delFail.code, "TALLY_VOUCHER_NOT_FOUND");
  assert.strictEqual(delFail.voucher.number, "1");
  global.fetch = originalFetch;

  // Standalone deleteTallyVoucher with fetch
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><DELETED>1</DELETED></RESPONSE>",
  });
  const standaloneDel = await deleteTallyVoucher({ companyName: "Acme", voucherType: "Payment", voucherNumber: "1", date: "2026-04-01" });
  assert.strictEqual(standaloneDel.success, true);
  assert.strictEqual(standaloneDel.code, "TALLY_VOUCHER_DELETED");
  global.fetch = originalFetch;

  // Standalone deleteTallyVoucher not found test
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><LINEERROR>Voucher does not exist!</LINEERROR></RESPONSE>",
  });
  const standaloneNotFound = await deleteTallyVoucher({ companyName: "Acme", voucherType: "Payment", voucherNumber: "1", date: "2026-04-01" });
  assert.strictEqual(standaloneNotFound.success, false);
  assert.strictEqual(standaloneNotFound.code, "TALLY_VOUCHER_NOT_FOUND");
  assert.strictEqual(standaloneNotFound.voucher.number, "1");
  global.fetch = originalFetch;

  // cancelVoucherXml envelope structure test
  const cancelXml = client.cancelVoucherXml({
    companyName: "Tally XYZ",
    voucherType: "Payment",
    voucherNumber: "1",
    date: "2026-04-01",
  });
  assert.match(cancelXml, /<TALLYREQUEST>Import<\/TALLYREQUEST>/);
  assert.match(cancelXml, /<TYPE>Data<\/TYPE>/);
  assert.match(cancelXml, /<ID>Vouchers<\/ID>/);
  assert.match(cancelXml, /<SVCURRENTCOMPANY>Tally XYZ<\/SVCURRENTCOMPANY>/);
  assert.match(
    cancelXml,
    /<VOUCHER\s+DATE="20260401"\s+TAGNAME="Voucher Number"\s+TAGVALUE="1"\s+ACTION="Cancel"\s+VCHTYPE="Payment">/
  );
  assert.match(cancelXml, /<DATE>20260401<\/DATE>/);
  assert.match(cancelXml, /<VOUCHERTYPENAME>Payment<\/VOUCHERTYPENAME>/);
  assert.match(cancelXml, /<VOUCHERNUMBER>1<\/VOUCHERNUMBER>/);

  assert.throws(() => client.cancelVoucherXml({ voucherType: "Payment", voucherNumber: "1", date: "2026-04-01" }), /companyName is required/);
  assert.throws(() => client.cancelVoucherXml({ companyName: "Acme", voucherNumber: "1", date: "2026-04-01" }), /voucherType is required/);
  assert.throws(() => client.cancelVoucherXml({ companyName: "Acme", voucherType: "Payment", date: "2026-04-01" }), /voucherNumber is required/);
  assert.throws(() => client.cancelVoucherXml({ companyName: "Acme", voucherType: "Payment", voucherNumber: "1" }), /date is required/);

  // Standalone cancelTallyVoucher success test
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><ALTERED>1</ALTERED><CANCELLED>0</CANCELLED></RESPONSE>",
  });
  const cancelOk = await cancelTallyVoucher({
    companyName: "Tally XYZ",
    voucherType: "Payment",
    voucherNumber: "1",
    date: "2026-04-01",
  });
  assert.strictEqual(cancelOk.success, true);
  assert.strictEqual(cancelOk.code, "TALLY_VOUCHER_CANCELLED");
  assert.strictEqual(cancelOk.voucher.type, "Payment");
  assert.strictEqual(cancelOk.voucher.number, "1");
  assert.strictEqual(cancelOk.voucher.date, "2026-04-01");

  // Standalone cancelTallyVoucher failure with LINEERROR
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><LINEERROR>No matching voucher found</LINEERROR></RESPONSE>",
  });
  const cancelFail = await cancelTallyVoucher({
    companyName: "Tally XYZ",
    voucherType: "Payment",
    voucherNumber: "999",
    date: "2026-04-01",
  });
  assert.strictEqual(cancelFail.success, false);
  assert.strictEqual(cancelFail.code, "TALLY_VOUCHER_CANCEL_FAILED");
  assert.strictEqual(cancelFail.message, "No matching voucher found");
  global.fetch = originalFetch;

  // CANCEL_TALLY_VOUCHER route test
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><ALTERED>1</ALTERED></RESPONSE>",
  });
  const execCancel = await client.executeCommand({
    command_type: "CANCEL_TALLY_VOUCHER",
    payload: {
      companyName: "Tally XYZ",
      voucherType: "Payment",
      voucherNumber: "1",
      date: "2026-04-01",
    },
  });
  assert.strictEqual(execCancel.success, true);
  assert.strictEqual(execCancel.code, "TALLY_VOUCHER_CANCELLED");
  global.fetch = originalFetch;

  const alterVoucher = client.alterVoucherXml({
    voucher_type: "Sales",
    date: "2026-07-01",
    voucher_number: "15",
    company_name: "Acme",
    tally_guid: "guid-1",
    new_date: "2026-07-05",
    narration: "updated",
  });
  assert.match(alterVoucher, /ACTION="Alter"/);
  assert.match(alterVoucher, /TAGNAME="Voucher Number"/);
  assert.match(alterVoucher, /TAGVALUE="15"/);
  assert.match(alterVoucher, /DATE="20260701"/);
  assert.match(alterVoucher, /<DATE>20260705<\/DATE>/);
  assert.match(alterVoucher, /<NARRATION>updated<\/NARRATION>/);
  assert.ok(!alterVoucher.includes("REMOTEID="), "Alter must not address by export GUID");
  assert.ok(!alterVoucher.includes("ALLLEDGERENTRIES"), "Alter must not send ledger lines");

  const alterAmount = client.alterVoucherXml({
    voucher_type: "Receipt",
    date: "2026-04-01",
    voucher_number: "8",
    company_name: "Acme",
    amount: 800,
    lines: [
      { ledger_name: "Cash", amount: 800, debit: true },
      { ledger_name: "Ab", amount: 800, debit: false },
    ],
  });
  assert.match(alterAmount, /ACTION="Alter"/);
  assert.match(alterAmount, /TAGNAME="Voucher Number"/);
  assert.match(alterAmount, /ALLLEDGERENTRIES/);
  assert.match(alterAmount, /<LEDGERNAME>Cash<\/LEDGERNAME>/);
  assert.match(alterAmount, /<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>/);
  assert.match(alterAmount, /<AMOUNT>-800<\/AMOUNT>/);
  assert.match(alterAmount, /<LEDGERNAME>Ab<\/LEDGERNAME>/);
  assert.match(alterAmount, /<AMOUNT>800<\/AMOUNT>/);

  const alterDue = client.alterVoucherXml({
    voucher_type: "Sales",
    date: "2026-10-01",
    voucher_number: "2",
    company_name: "Acme",
    lines: [
      { ledger_name: "ABC Traders", debit: true, amount: 5000, bills: [{ name: "INV-002", type: "New Ref", amount: -5000, due_date: "2026-11-15" }] },
      { ledger_name: "Sales", debit: false, amount: 5000 },
    ],
  });
  assert.match(alterDue, /<BILLCREDITPERIOD JOINED="Yes">45 Days<\/BILLCREDITPERIOD>/);
  assert.ok(!alterDue.includes("<DUEDATE>"), "Tally ignores DUEDATE on import");
  await expectRejects(client.alterVoucherVerified({ voucher_type: "Sales", date: "2026-10-01", remote_id: "rid-1", due_date: "2026-11-15" }), /ledger lines/);

  // 4b. Write pre-flight: the open company must match the command's company.
  // No company context (older queued commands) or undetectable current
  // company fails open; a provable mismatch fails before touching Tally.
  client.currentCompany = async () => ({ company: { tally_guid: "guid-a", name: "Acme" }, companies: [] });
  await client.assertWriteCompany({ company_guid: "guid-a", company_name: "Acme" }, "deleting");
  await client.assertWriteCompany({}, "deleting");
  await expectRejects(
    client.assertWriteCompany({ company_guid: "guid-b", company_name: "Beta" }, "deleting Receipt 8"),
    /Open company "Beta"/
  );
  client.currentCompany = async () => { throw new Error("nope"); };
  await client.assertWriteCompany({ company_guid: "guid-b" }, "deleting");

  // 4c. detect() prefers the true current company over the first loaded one.
  delete client.currentCompany; // restore the real method stubbed above
  client.postXml = async (xml) => {
    if (xml.includes("CompanyInfo")) {
      return `<RESPONSE><COMPANYINFO><NAME>Beta</NAME><GUID>guid-b</GUID></COMPANYINFO></RESPONSE>`;
    }
    return `<RESPONSE><COMPANY><NAME>Acme</NAME><GUID>guid-a</GUID></COMPANY><COMPANY><NAME>Beta</NAME><GUID>guid-b</GUID></COMPANY></RESPONSE>`;
  };
  const detected = await client.detect();
  assert.strictEqual(detected.company_guid, "guid-b");
  assert.strictEqual(detected.company_name, "Beta");
  client.postXml = async (xml) => {
    posted.push(xml);
    return client.__nextResponse;
  };

  // 4d. REMOTEID addressing: website remote_id only. Export GUID / tally_guid
  // must not be stamped — Tally Import does not resolve them.
  const actionNoRid = client.voucherActionXml({ voucher_type: "Receipt", date: "2026-04-01", voucher_number: "8", tally_guid: "g-v" }, "Delete");
  assert.ok(!actionNoRid.includes("REMOTEID="), "export GUID must not become REMOTEID");
  const actionRid = client.voucherActionXml({ voucher_type: "Receipt", date: "2026-04-01", voucher_number: "8", tally_guid: "g-v", remote_id: "r-v" }, "Delete");
  assert.match(actionRid, /REMOTEID="r-v"/);
  assert.ok(!actionRid.includes("g-v"), "remote_id must replace the export GUID");
  const createdNoRid = client.createVoucherXml({ voucher_type: "Receipt", party_name: "Acme", amount: 100, offset_ledger: "Cash" }, "Receipt");
  assert.ok(!createdNoRid.includes("REMOTEID"), "creates without remote_id stay unchanged");
  const createdRid = client.createVoucherXml({ voucher_type: "Receipt", party_name: "Acme", amount: 100, remote_id: "r-new", offset_ledger: "Cash" }, "Receipt");
  assert.match(createdRid, /REMOTEID="r-new"/);

  // 4e. Verified voucher writes: counters alone lie (Delete reports DELETED=1
  // on no-match, Cancel reports CREATED=1), so Day Book read-back decides.
  const importOk = "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>1</DELETED><LASTVCHID>0</LASTVCHID><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED></RESPONSE>";
  const goneBook = "<ENVELOPE><BODY><DATA></DATA></BODY></ENVELOPE>";
  const presentBook = "<ENVELOPE><BODY><DATA><VOUCHER><GUID>g-1</GUID><VOUCHERNUMBER>8</VOUCHERNUMBER><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><DATE>20260401</DATE><ISCANCELLED>No</ISCANCELLED><NARRATION>old</NARRATION></VOUCHER></DATA></BODY></ENVELOPE>";
  const cancelledBook = presentBook.replace("<ISCANCELLED>No</ISCANCELLED>", "<ISCANCELLED>Yes</ISCANCELLED>");
  const dayBookFor = (book) => async (xml) => (xml.includes("<TALLYREQUEST>Import") ? importOk : book);
  const delPayload = { voucher_type: "Receipt", voucher_number: "8", date: "2026-04-01", tally_guid: "g-1", remote_id: "r-1" };
  client.postXml = dayBookFor(goneBook);
  const delPayloadWithCompany = { ...delPayload, company_name: "Acme Corp" };
  client.postXml = dayBookFor(goneBook);
  assert.strictEqual((await client.deleteVoucherVerified(delPayloadWithCompany)).deleted, 1);
  client.postXml = dayBookFor(presentBook);
  await expectRejects(client.deleteVoucherVerified(delPayload), /cannot be deleted using the XML import identifier/);

  // TALLY_XML_DELETE_UNSUPPORTED test for deleteVoucherVerified
  client.postXml = async (xml) => {
    if (xml.includes("<TALLYREQUEST>Import")) {
      return "<RESPONSE><LINEERROR>Voucher does not exist!</LINEERROR></RESPONSE>";
    }
    return presentBook;
  };
  try {
    await client.deleteVoucherVerified({ ...delPayload, company_name: "Acme Corp" });
    assert.fail("should have thrown TALLY_XML_DELETE_UNSUPPORTED");
  } catch (err) {
    assert.strictEqual(err.code, "TALLY_XML_DELETE_UNSUPPORTED");
    assert.strictEqual(err.requiresManualAction, true);
    assert.strictEqual(err.voucher.number, "8");
    assert.strictEqual(err.voucher.type, "Receipt");
    assert.match(err.message, /cannot be deleted using the XML import identifier/);
  }

  // queryVoucher test
  client.postXml = async () => presentBook;
  const queried = await client.queryVoucher({ voucher_type: "Receipt", voucher_number: "8", date: "2026-04-01" });
  assert.strictEqual(queried.found, true);
  assert.strictEqual(queried.guid, "g-1");
  assert.strictEqual(queried.voucher_number, "8");
  assert.strictEqual(queried.voucher_type, "Receipt");
  const execQueried = await client.executeCommand({
    command_type: "QUERY_VOUCHER",
    payload: { voucher_type: "Receipt", voucher_number: "8", date: "2026-04-01" },
  });
  assert.strictEqual(execQueried.found, true);
  assert.strictEqual(execQueried.guid, "g-1");

  client.postXml = async (xml) => {
    if (xml.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>")) {
      return "<RESPONSE><CREATED>0</CREATED><ALTERED>1</ALTERED><DELETED>0</DELETED><LASTVCHID>0</LASTVCHID><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED></RESPONSE>";
    }
    return cancelledBook;
  };
  await client.cancelVoucherVerified(delPayload);
  client.postXml = dayBookFor(presentBook);
  await expectRejects(client.cancelVoucherVerified(delPayload), /did not cancel/);
  client.postXml = async (xml) => {
    if (xml.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>")) {
      return "<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><LASTVCHID>9</LASTVCHID><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED></RESPONSE>";
    }
    return cancelledBook;
  };
  await expectRejects(client.cancelVoucherVerified(delPayload), /new entry instead/);
  client.postXml = async (xml) => {
    if (xml.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>")) {
      return "<RESPONSE><CREATED>0</CREATED><ALTERED>1</ALTERED><DELETED>0</DELETED><LASTVCHID>0</LASTVCHID><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED></RESPONSE>";
    }
    return presentBook.replace("<NARRATION>old</NARRATION>", "<NARRATION>new</NARRATION>");
  };
  await client.alterVoucherVerified({ ...delPayload, narration: "new" });
  await expectRejects(client.alterVoucherVerified({ ...delPayload, narration: "other" }), /unchanged/);
  client.postXml = async (xml) => {
    posted.push(xml);
    return client.__nextResponse;
  };

  // 5. executeCommand routes new command types to import.
  client.__nextResponse = "<RESPONSE><ALTERED>1</ALTERED><ERRORS>0</ERRORS></RESPONSE>";
  const result = await client.executeCommand({ command_type: "ALTER_LEDGER", payload: { name: "Acme" } });
  assert.strictEqual(result.altered, 1);

  // 6. Double-entry direction per voucher type (negative = debit).
  const sales = client.createVoucherXml({ voucher_type: "Sales", party_name: "Acme", amount: 100, bill_number: "INV-1", offset_ledger: "Sales" });
  assert.match(sales, /<LEDGERNAME>Acme<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-100<\/AMOUNT>/, "Sales debits party");
  assert.match(sales, /<LEDGERNAME>Sales<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>100<\/AMOUNT>/, "Sales credits sales ledger");
  assert.match(sales, /<BILLTYPE>New Ref<\/BILLTYPE>/, "Sales raises a new bill ref");
  assert.throws(
    () => client.createVoucherXml({ voucher_type: "Sales", party_name: "Acme", amount: 100 }),
    /voucher type, not a ledger/,
  );

  const creditNote = client.createVoucherXml({ voucher_type: "Credit Note", party_name: "Acme", amount: 50, bill_number: "INV-1", offset_ledger: "Sales" });
  assert.match(creditNote, /<LEDGERNAME>Acme<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>50<\/AMOUNT>/, "Credit Note credits party");
  assert.match(creditNote, /<LEDGERNAME>Sales<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-50<\/AMOUNT>/, "Credit Note debits sales");
  assert.match(creditNote, /<BILLTYPE>Agst Ref<\/BILLTYPE>/, "Credit Note settles the existing bill");

  const debitNote = client.createVoucherXml({ voucher_type: "Debit Note", party_name: "Supp", amount: 30, offset_ledger: "Purchase" });
  assert.match(debitNote, /<LEDGERNAME>Supp<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-30<\/AMOUNT>/, "Debit Note debits supplier");
  assert.match(debitNote, /<LEDGERNAME>Purchase<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>/, "Debit Note credits purchase");

  const journal = client.createVoucherXml({ voucher_type: "Journal", debit_ledger: "Rent", credit_ledger: "Cash", amount: 20 });
  assert.match(journal, /<LEDGERNAME>Rent<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-20<\/AMOUNT>/, "Journal debits explicit ledger");
  assert.match(journal, /<LEDGERNAME>Cash<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>20<\/AMOUNT>/, "Journal credits explicit ledger");

  const itemCreditNote = client.createVoucherXml({ voucher_type: "Credit Note", party_name: "Acme", amount: 50, offset_ledger: "Sales Returns", items: [{ stock_item_name: "Widget", quantity: 1, rate: 50, amount: 50 }] });
  assert.match(itemCreditNote, /<LEDGERNAME>Acme<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>/, "item Credit Note still credits the party despite a 'Sales…' ledger");

  const matched = client.createVoucherXml({
    voucher_type: "Receipt", party_name: "Acme", amount: 700, offset_ledger: "Cash", bill_type: "Agst Ref",
    bills: [{ name: "INV-1", type: "Agst Ref", amount: 400 }, { name: "INV-2", type: "Agst Ref", amount: 200 }, { name: "", type: "On Account", amount: 100 }],
  });
  assert.match(matched, /<NAME>INV-1<\/NAME>\s*<BILLTYPE>Agst Ref<\/BILLTYPE>\s*<AMOUNT>400<\/AMOUNT>/, "Match payment settles INV-1");
  assert.match(matched, /<NAME>INV-2<\/NAME>\s*<BILLTYPE>Agst Ref<\/BILLTYPE>\s*<AMOUNT>200<\/AMOUNT>/, "Match payment settles INV-2");
  assert.match(matched, /<BILLALLOCATIONS\.LIST>\s*<BILLTYPE>On Account<\/BILLTYPE>\s*<AMOUNT>100<\/AMOUNT>/, "excess goes On Account without a name");

  // 7. Stock journal moves qty between godowns (OUT source, IN destination).
  const sj = client.stockJournalXml({ stock_item_name: "Widget", quantity: 5, unit: "Nos", source_godown: "Main", dest_godown: "Branch", rate: 10 });
  assert.match(sj, /VCHTYPE="Stock Journal"/);
  assert.match(sj, /<INVENTORYENTRIESOUT.LIST>[\s\S]*<GODOWNNAME>Main<\/GODOWNNAME>[\s\S]*<\/INVENTORYENTRIESOUT.LIST>/, "OUT entry uses source godown");
  assert.match(sj, /<INVENTORYENTRIESIN.LIST>[\s\S]*<GODOWNNAME>Branch<\/GODOWNNAME>[\s\S]*<\/INVENTORYENTRIESIN.LIST>/, "IN entry uses destination godown");
  assert.match(sj, /<ACTUALQTY>5 Nos<\/ACTUALQTY>/);
  assert.match(sj, /<AMOUNT>50.00<\/AMOUNT>/);

  // 8. Payables merge into outstandings with bill_type tagging.
  const parsed = client.parseOutstandings("<X><BILLALLOCATIONS.LIST><BILLPARTY>Supp</BILLPARTY><NAME>PB-1</NAME><AMOUNT>10</AMOUNT></BILLALLOCATIONS.LIST></X>", "PAYABLE");
  assert.strictEqual(parsed[0].bill_type, "PAYABLE");

  // 9. Calendar due date is sent as BILLCREDITPERIOD YYYYMMDD (not N Days / BILLDUE)
  const invoiceXml = client.createTallyVoucherXml({
    companyName: "Tally XYZ",
    voucherType: "Sales",
    voucherNumber: "INV-001",
    date: "2026-09-30",
    partyLedger: "ABC Customer",
    amount: 10000,
    offsetLedger: "Sales",
    bill: {
      reference: "INV-001",
      dueDate: "2026-10-30",
    },
  });

  assert.match(invoiceXml, /<VERSION>1<\/VERSION>/);
  assert.match(invoiceXml, /<TALLYREQUEST>Import<\/TALLYREQUEST>/);
  assert.match(invoiceXml, /<TYPE>Data<\/TYPE>/);
  assert.match(invoiceXml, /<ID>Vouchers<\/ID>/);
  assert.match(invoiceXml, /<SVCURRENTCOMPANY>Tally XYZ<\/SVCURRENTCOMPANY>/);
  assert.match(invoiceXml, /<VOUCHER\s+VCHTYPE="Sales"\s+ACTION="Create"\s+OBJVIEW="Accounting Invoice Voucher View">/);
  assert.match(invoiceXml, /<DATE>20260930<\/DATE>/);
  assert.match(invoiceXml, /<VOUCHERTYPENAME>Sales<\/VOUCHERTYPENAME>/);
  assert.match(invoiceXml, /<VOUCHERNUMBER>INV-001<\/VOUCHERNUMBER>/);
  assert.match(invoiceXml, /<PERSISTEDVIEW>Accounting Invoice Voucher View<\/PERSISTEDVIEW>/);
  assert.match(invoiceXml, /<ISINVOICE>Yes<\/ISINVOICE>/);
  assert.match(invoiceXml, /<LEDGERNAME>ABC Customer<\/LEDGERNAME>/);
  assert.match(invoiceXml, /<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>/);
  assert.match(invoiceXml, /<AMOUNT>-10000\.00<\/AMOUNT>/);
  assert.match(invoiceXml, /<BILLALLOCATIONS\.LIST>/);
  assert.match(invoiceXml, /<NAME>INV-001<\/NAME>/);
  assert.match(invoiceXml, /<BILLTYPE>New Ref<\/BILLTYPE>/);
  assert.match(invoiceXml, /<BILLCREDITPERIOD[^>]*>30 Days<\/BILLCREDITPERIOD>/);
  assert.ok(!invoiceXml.includes("<BILLDUE>"), "Must not send BILLDUE tag");
  assert.ok(!invoiceXml.includes("<!--"), "Must not include XML comments");
  assert.match(invoiceXml, /<LEDGERNAME>Sales<\/LEDGERNAME>/);
  assert.match(invoiceXml, /<AMOUNT>10000\.00<\/AMOUNT>/);

  // 10. createVoucherXml with due_date as YYYYMMDD; due before voucher date is kept
  const salesWithDue = client.createVoucherXml({
    voucher_type: "Sales",
    party_name: "Acme",
    amount: 500,
    bill_number: "INV-99",
    offset_ledger: "Sales",
    date: "2026-09-30",
    due_date: "2026-09-01",
  });
  assert.match(salesWithDue, /<BILLCREDITPERIOD[^>]*>1-Sep-26<\/BILLCREDITPERIOD>/);
  assert.ok(!salesWithDue.includes("<BILLDUE>"), "createVoucherXml must not send BILLDUE");

  const salesDueAfter = client.createVoucherXml({
    voucher_type: "Sales",
    party_name: "Acme",
    amount: 500,
    bill_number: "INV-98",
    offset_ledger: "Sales",
    date: "2026-09-01",
    due_date: "2026-09-30",
  });
  assert.match(salesDueAfter, /<BILLCREDITPERIOD[^>]*>29 Days<\/BILLCREDITPERIOD>/);
  assert.ok(!salesWithDue.includes("<BILLDUE>"), "createVoucherXml must not send BILLDUE");

  const purchaseWithDue = client.createVoucherXml({
    voucher_type: "Purchase",
    party_name: "Supp",
    amount: 800,
    bill_number: "PUR-1",
    offset_ledger: "Purchase",
    date: "2026-09-30",
    due_date: "2026-09-01",
  });
  assert.match(purchaseWithDue, /<BILLCREDITPERIOD[^>]*>1-Sep-26<\/BILLCREDITPERIOD>/);
  assert.match(purchaseWithDue, /<BILLTYPE>New Ref<\/BILLTYPE>/);

  const paymentAgst = client.createVoucherXml({
    voucher_type: "Payment",
    party_name: "Supp",
    amount: 800,
    bill_number: "PUR-1",
    offset_ledger: "Cash",
    date: "2026-09-30",
    due_date: "2026-09-01",
  });
  assert.ok(!paymentAgst.includes("BILLCREDITPERIOD"), "Agst Ref Payment must not send BILLCREDITPERIOD");

  const receiptNewRef = client.createVoucherXml({
    voucher_type: "Receipt",
    party_name: "Acme",
    amount: 100,
    bill_number: "ADV-1",
    bill_type: "New Ref",
    offset_ledger: "Cash",
    date: "2026-09-30",
    due_date: "2026-09-01",
  });
  assert.match(receiptNewRef, /<BILLCREDITPERIOD[^>]*>1-Sep-26<\/BILLCREDITPERIOD>/);

  assert.strictEqual(parseTallyDate("09/30/2026"), "20260930");
  assert.strictEqual(parseTallyDate("30/09/2026"), "20260930");
  assert.strictEqual(dueFromCreditPeriod("20260901"), "2026-09-01");
  assert.strictEqual(dueFromCreditPeriod("30 Days", "2026-09-01"), "2026-10-01");

  // 10b. Date parsing supports DD-MM-YYYY and bare numbers in creditPeriod
  const dmyInvoice = client.createTallyVoucherXml({
    companyName: "Acme",
    voucherType: "Sales",
    date: "30-09-2026",
    partyLedger: "Cust",
    amount: 100,
    offsetLedger: "Sales",
    creditPeriod: 15,
  });
  assert.match(dmyInvoice, /<DATE>20260930<\/DATE>/);
  assert.match(dmyInvoice, /<BILLCREDITPERIOD[^>]*>15 Days<\/BILLCREDITPERIOD>/);

  // 10c. Credit note vs Debit note signs in tallyVoucherCreateEnvelope
  const cnXml = client.createTallyVoucherXml({
    companyName: "Acme",
    voucherType: "Credit Note",
    partyLedger: "Customer B",
    amount: 200,
    offsetLedger: "Sales Returns",
  });
  assert.match(cnXml, /<LEDGERNAME>Customer B<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>\s*<AMOUNT>200\.00<\/AMOUNT>/);
  assert.match(cnXml, /<LEDGERNAME>Sales Returns<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-200\.00<\/AMOUNT>/);

  const dnXml = client.createTallyVoucherXml({
    companyName: "Acme",
    voucherType: "Debit Note",
    partyLedger: "Supplier A",
    amount: 300,
    offsetLedger: "Purchase Returns",
  });
  assert.match(dnXml, /<LEDGERNAME>Supplier A<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>\s*<AMOUNT>-300\.00<\/AMOUNT>/);
  assert.match(dnXml, /<LEDGERNAME>Purchase Returns<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>300\.00<\/AMOUNT>/);

  const dayBookXml = `<ENVELOPE><VOUCHER>
    <DATE>20260930</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <VOUCHERNUMBER>INV-DUE</VOUCHERNUMBER>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Cust</LEDGERNAME>
      <AMOUNT>-100</AMOUNT>
      <BILLALLOCATIONS.LIST>
        <NAME>INV-DUE</NAME>
        <BILLTYPE>New Ref</BILLTYPE>
        <AMOUNT>-100</AMOUNT>
        <BILLCREDITPERIOD>20260901</BILLCREDITPERIOD>
      </BILLALLOCATIONS.LIST>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER></ENVELOPE>`;
  const parsedVch = client.parseVouchers(dayBookXml);
  assert.strictEqual(parsedVch[0].bill_allocations[0].due_date, "2026-09-01");
  assert.strictEqual(parsedVch[0].due_date, "2026-09-01");

  // D-Mon-YY bill tags must become ISO — raw "1-Apr-26" aborts Postgres DATE inserts.
  const fyBill = client.parseBillAllocations(
    `<BILLALLOCATIONS.LIST><NAME>INV-FY</NAME><BILLDATE>1-Apr-26</BILLDATE><DUEDATE>1-Sep-26</DUEDATE><AMOUNT>-50</AMOUNT></BILLALLOCATIONS.LIST>`,
    "Cust",
    "2026-09-01"
  );
  assert.strictEqual(fyBill[0].bill_date, "2026-04-01");
  assert.strictEqual(fyBill[0].due_date, "2026-09-01");
  assert.match(fyBill[0].bill_date, /^\d{4}-\d{2}-\d{2}$/);

  const prevPostXml = client.postXml;
  client.postXml = async (xml) => {
    if (String(xml).includes("<ID>Bills Receivable</ID>")) {
      return `<ENVELOPE><BILLFIXED><BILLDATE>1-Apr-26</BILLDATE><BILLREF>INV-DUE</BILLREF><BILLPARTY>Cust</BILLPARTY></BILLFIXED><BILLCL>100</BILLCL><BILLDUE>1-Apr-26</BILLDUE></ENVELOPE>`;
    }
    if (String(xml).includes("<ID>Bills Payable</ID>")) return "<ENVELOPE/>";
    // bill-date enrichment reads the voucher collection (every date), not the period-limited Day Book
    if (String(xml).includes("<ID>Day Book</ID>") || String(xml).includes("<ID>VouchersColl</ID>")) return dayBookXml;
    return "<ENVELOPE/>";
  };
  const enriched = await client.outstandings("guid", "Acme");
  assert.strictEqual(enriched[0].bill_number, "INV-DUE");
  assert.strictEqual(enriched[0].due_date, "2026-09-01");
  assert.strictEqual(enriched[0].bill_date, "2026-09-30");
  client.postXml = prevPostXml;

  // 11. Standalone createTallyVoucher with mocked fetch
  const prevFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></RESPONSE>",
  });

  const createdOk = await createTallyVoucher({
    companyName: "Acme",
    voucherType: "Sales",
    voucherNumber: "INV-100",
    date: "2026-09-30",
    partyLedger: "Customer A",
    offsetLedger: "Sales Account",
    amount: 2500,
    bill: { reference: "INV-100", dueDate: "2026-10-30" },
  });
  assert.strictEqual(createdOk.success, true);
  assert.strictEqual(createdOk.created, 1);

  // Standalone createTallyVoucher failure handling
  global.fetch = async () => ({
    ok: true,
    text: async () => "<RESPONSE><LINEERROR>Ledger 'Customer A' does not exist!</LINEERROR></RESPONSE>",
  });
  const createdFail = await createTallyVoucher({
    companyName: "Acme",
    voucherType: "Sales",
    partyLedger: "Customer A",
    offsetLedger: "Sales Account",
    amount: 1000,
  });
  assert.strictEqual(createdFail.success, false);
  assert.strictEqual(createdFail.code, "TALLY_VOUCHER_CREATE_FAILED");
  assert.match(createdFail.message, /Customer A/);

  global.fetch = prevFetch;

  // 12. Unit simple create
  const simpleUnitXml = tallyUnitEnvelope({
    companyName: "Acme",
    name: "Nos",
    formalName: "Numbers",
    uqc: "NOS-NUMBERS",
    decimalPlaces: 0,
    action: "Create",
  });
  assert.match(simpleUnitXml, /<ID>All Masters<\/ID>/);
  assert.match(simpleUnitXml, /<UNIT NAME="Nos" ACTION="Create">/);
  assert.match(simpleUnitXml, /<NAME>Nos<\/NAME>/);
  assert.match(simpleUnitXml, /<ISSIMPLEUNIT>Yes<\/ISSIMPLEUNIT>/);
  assert.match(simpleUnitXml, /<ORIGINALNAME>Numbers<\/ORIGINALNAME>/);
  assert.match(simpleUnitXml, /<GSTREPUOM>NOS-NUMBERS<\/GSTREPUOM>/);
  assert.match(simpleUnitXml, /<DECIMALPLACES>0<\/DECIMALPLACES>/);

  // 13. Unit compound create
  const compoundUnitXml = tallyUnitEnvelope({
    companyName: "Acme",
    name: "Box of 12 Nos",
    baseUnit: "Box",
    additionalUnit: "Nos",
    conversion: 12,
    action: "Create",
  });
  assert.match(compoundUnitXml, /<UNIT NAME="Box of 12 Nos" ACTION="Create">/);
  assert.match(compoundUnitXml, /<ISSIMPLEUNIT>No<\/ISSIMPLEUNIT>/);
  assert.match(compoundUnitXml, /<BASEUNITS>Box<\/BASEUNITS>/);
  assert.match(compoundUnitXml, /<ADDITIONALUNITS>Nos<\/ADDITIONALUNITS>/);
  assert.match(compoundUnitXml, /<CONVERSION>12<\/CONVERSION>/);
  assert.ok(!compoundUnitXml.includes("<DECIMALPLACES>"), "Compound unit must not have DECIMALPLACES");

  // 14. Unit alter rename and unit delete
  const renameXml = tallyUnitEnvelope({
    companyName: "Acme",
    name: "KGS",
    oldName: "Kgs",
    formalName: "Kilograms",
    action: "Alter",
  });
  assert.match(renameXml, /<UNIT NAME="Kgs" ACTION="Alter">/);
  assert.match(renameXml, /<NAME>KGS<\/NAME>/);

  const deleteUnitXml = tallyUnitEnvelope({
    companyName: "Acme",
    name: "Nos",
    action: "Delete",
  });
  assert.match(deleteUnitXml, /<UNIT NAME="Nos" ACTION="Delete">\s*<NAME>Nos<\/NAME>\s*<\/UNIT>/);

  // 15. unitsExportEnvelope and parseUnits
  const exportXml = unitsExportEnvelope("Acme");
  assert.match(exportXml, /<ID>UnitsColl<\/ID>/);
  assert.match(exportXml, /<TYPE>Units<\/TYPE>/);
  assert.match(exportXml, /<FETCH>Name, OriginalName, GSTRepUOM, IsSimpleUnit, BaseUnits, AdditionalUnits, Conversion, DecimalPlaces, GUID, MasterID, AlterID<\/FETCH>/);

  const sampleUnitsXml = `
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        <UNIT NAME="Nos">
          <NAME>Nos</NAME>
          <ORIGINALNAME>Numbers</ORIGINALNAME>
          <GSTREPUOM>NOS-NUMBERS</GSTREPUOM>
          <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
          <DECIMALPLACES>0</DECIMALPLACES>
          <GUID>guid-nos-123</GUID>
          <MASTERID>101</MASTERID>
          <ALTERID>202</ALTERID>
        </UNIT>
        <UNIT NAME="Box of 10 Nos">
          <NAME>Box of 10 Nos</NAME>
          <ISSIMPLEUNIT>No</ISSIMPLEUNIT>
          <BASEUNITS>Box</BASEUNITS>
          <ADDITIONALUNITS>Nos</ADDITIONALUNITS>
          <CONVERSION>10</CONVERSION>
          <GUID>guid-box-456</GUID>
          <MASTERID>102</MASTERID>
          <ALTERID>203</ALTERID>
        </UNIT>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>`;

  const parsedUnits = client.parseUnits(sampleUnitsXml);
  assert.strictEqual(parsedUnits.length, 2);
  assert.strictEqual(parsedUnits[0].name, "Nos");
  assert.strictEqual(parsedUnits[0].formal_name, "Numbers");
  assert.strictEqual(parsedUnits[0].uqc, "NOS-NUMBERS");
  assert.strictEqual(parsedUnits[0].is_simple, true);
  assert.strictEqual(parsedUnits[0].decimal_places, 0);
  assert.strictEqual(parsedUnits[0].tally_guid, "guid-nos-123");
  assert.strictEqual(parsedUnits[0].master_id, "101");
  assert.strictEqual(parsedUnits[0].alter_id, "202");

  assert.strictEqual(parsedUnits[1].name, "Box of 10 Nos");
  assert.strictEqual(parsedUnits[1].is_simple, false);
  assert.strictEqual(parsedUnits[1].base_units, "Box");
  assert.strictEqual(parsedUnits[1].additional_units, "Nos");
  assert.strictEqual(parsedUnits[1].conversion, 10);
  assert.strictEqual(parsedUnits[1].tally_guid, "guid-box-456");

  // 16. Voucher sync Collection envelope (not Day Book)
  const vchEnv = vouchersListEnvelope("Acme", { from: "2026-04-01", to: "2027-03-31" });
  assert.match(vchEnv, /<TYPE>Collection<\/TYPE>/);
  assert.match(vchEnv, /<ID>VouchersColl<\/ID>/);
  assert.match(vchEnv, /<TYPE>Voucher<\/TYPE>/);
  assert.ok(vchEnv.includes(`<FETCH>${VOUCHER_COLLECTION_FETCH}</FETCH>`));
  assert.match(vchEnv, /<SVFROMDATE>20260401<\/SVFROMDATE>/);
  assert.match(vchEnv, /<SVTODATE>20270331<\/SVTODATE>/);
  assert.match(vchEnv, /<SVCURRENTCOMPANY>Acme<\/SVCURRENTCOMPANY>/);

  const collectionXml = `
<ENVELOPE>
  <BODY>
    <DESC><CMPINFO><VOUCHER>20</VOUCHER></CMPINFO></DESC>
    <DATA>
      <COLLECTION>
        <VOUCHER VCHTYPE="Sales">
          <DATE>20260901</DATE>
          <GUID>guid-sale-1</GUID>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <VOUCHERNUMBER>15</VOUCHERNUMBER>
          <PARTYLEDGERNAME>Cust</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Cust</LEDGERNAME>
            <AMOUNT>-100</AMOUNT>
            <BILLALLOCATIONS.LIST>
              <NAME>INV-1</NAME>
              <AMOUNT>-100</AMOUNT>
            </BILLALLOCATIONS.LIST>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>`;
  const parsedColl = client.parseVouchers(collectionXml);
  assert.strictEqual(parsedColl.length, 1);
  assert.strictEqual(parsedColl[0].tally_guid, "guid-sale-1");
  assert.strictEqual(parsedColl[0].voucher_type, "Sales");
  assert.strictEqual(parsedColl[0].ledger_entries.length, 1);
  assert.strictEqual(parsedColl[0].amount, 100);
  assert.strictEqual(parsedColl[0].bill_allocations[0].bill_name, "INV-1");

  // Invoice-view vouchers repeat their lines in LEDGERENTRIES.LIST; count them once.
  const line = (name, amt, bill = "") => `<LEDGERNAME>${name}</LEDGERNAME><AMOUNT>${amt}</AMOUNT>${bill}`;
  const bill = "<BILLALLOCATIONS.LIST><NAME>INV-9</NAME><AMOUNT>-500</AMOUNT></BILLALLOCATIONS.LIST>";
  const [invView] = client.parseVouchers(`<VOUCHER><GUID>g-inv</GUID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <ALLLEDGERENTRIES.LIST>${line("Cust", -500, bill)}</ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST>${line("Sales", 500)}</ALLLEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>${line("Cust", -500, bill)}</LEDGERENTRIES.LIST><LEDGERENTRIES.LIST>${line("Sales", 500)}</LEDGERENTRIES.LIST></VOUCHER>`);
  assert.deepStrictEqual(invView.ledger_entries.map((l) => l.ledger_name), ["Cust", "Sales"]);
  assert.strictEqual(invView.total_debit, 500);
  assert.strictEqual(invView.bill_allocations.length, 1);
  const [legacy] = client.parseVouchers(`<VOUCHER><GUID>g-le</GUID><ALLLEDGERENTRIES.LIST> </ALLLEDGERENTRIES.LIST><LEDGERENTRIES.LIST>${line("Cust", -50)}</LEDGERENTRIES.LIST></VOUCHER>`);
  assert.strictEqual(legacy.ledger_entries.length, 1);

  const postedVch = [];
  const prevVchPost = client.postXml;
  client.postXml = async (xml) => {
    postedVch.push(xml);
    return collectionXml;
  };
  const synced = await client.vouchers("g", "Acme", { from: "2026-04-01", to: "2027-03-31" });
  client.postXml = prevVchPost;
  assert.match(postedVch[0], /<ID>VouchersColl<\/ID>/);
  assert.ok(!postedVch[0].includes("<ID>Day Book</ID>"));
  assert.strictEqual(synced[0].tally_guid, "guid-sale-1");
  assert.strictEqual(synced[0].company_guid, "g");

  const fullPlan = batchUploadPlan(Array.from({ length: 501 }, (_, i) => ({ i })), true);
  assert.strictEqual(SYNC_BATCH_SIZE, 500);
  assert.strictEqual(fullPlan.length, 2);
  assert.strictEqual(fullPlan[0].records.length, 500);
  assert.strictEqual(fullPlan[0].reconcile, false);
  assert.strictEqual(fullPlan[1].records.length, 1);
  assert.strictEqual(fullPlan[1].reconcile, true);
  const one = batchUploadPlan([{ i: 1 }], true);
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].reconcile, true);
  const incrPlan = batchUploadPlan([{ i: 1 }], false);
  assert.strictEqual(incrPlan.length, 1);
  assert.strictEqual(incrPlan[0].reconcile, false);
  const emptyFull = batchUploadPlan([], true);
  assert.strictEqual(emptyFull[0].reconcile, true);

  const ledgerCalls = [];
  const batchRuntime = new AgentRuntime({
    store: { load: () => ({}) },
    backend: {
      syncLedgers: async (_guid, records, opts) => {
        ledgerCalls.push({ n: records.length, reconcile: opts.reconcile === true, before: opts.reconcileBefore });
        return {
          records_created: records.length,
          records_updated: 0,
          reconcile_before: ledgerCalls.length === 1 ? "2026-10-02 00:00:00+00" : undefined,
        };
      },
    },
    tally: {},
  });
  const batched = await batchRuntime.uploadInBatches("SYNC_FULL", "ledgers", Array.from({ length: 501 }, (_, i) => ({ i })), (records, opts) =>
    batchRuntime.backend.syncLedgers("g", records, opts)
  );
  assert.strictEqual(ledgerCalls.length, 2);
  assert.strictEqual(ledgerCalls[0].n, 500);
  assert.strictEqual(ledgerCalls[0].reconcile, false);
  assert.strictEqual(ledgerCalls[0].before, undefined);
  assert.strictEqual(ledgerCalls[1].n, 1);
  assert.strictEqual(ledgerCalls[1].reconcile, true);
  assert.strictEqual(ledgerCalls[1].before, "2026-10-02 00:00:00+00");
  assert.strictEqual(batched.records_created, 501);

  console.log("tally CRUD check passed.");
})();
