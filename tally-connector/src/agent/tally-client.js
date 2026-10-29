const { execFileSync } = require("node:child_process");
const { decodeXml, firstTag, tagBlocks, tallyExportEnvelope, tallyImportEnvelope, requireOffsetLedger, tallyUnitEnvelope, tallyVoucherCreateEnvelope, tallyVoucherDeleteEnvelope, tallyVoucherCancelEnvelope, tallyVoucherAlterEnvelope, unitsExportEnvelope, parseTallyDate, escapeXml, billCreditPeriodValue, billCreditPeriodTag, dueFromCreditPeriod } = require("./xml");

function tallyProcessRunning() {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq tally.exe", "/NH"], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    return /tally\.exe/i.test(out);
  } catch {
    return false;
  }
}

function numeric(value) {
  if (value == null || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let n = Number(match[0]);
  if (!Number.isFinite(n)) return null;
  // Tally writes a credit/negative quantity as "5.00- nos" (minus after the number).
  const after = cleaned.slice((match.index ?? 0) + match[0].length);
  if (n > 0 && /^\s*-/.test(after)) n = -n;
  return n;
}

function bool(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  return ["yes", "true", "1"].includes(raw) ? true : ["no", "false", "0"].includes(raw) ? false : null;
}

function asDate(value) {
  // Day Book DATE is YYYYMMDD; bill tags are often D-Mon-YY ("1-Apr-26").
  // Slicing that to 10 chars stored "1-Apr-26" in Postgres DATE and aborted
  // the whole voucher sync (so later vouchers never appeared).
  return tallyBillDate(value);
}

// Bills Receivable/Payable reports render dates as "1-Apr-26" (D-Mon-YY)
// instead of YYYYMMDD — normalize to ISO so the backend stores real dates.
function tallyBillDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (m) {
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const mon = months[String(m[2]).toLowerCase()];
    if (mon) {
      let year = String(m[3]);
      if (year.length === 2) year = (Number(year) >= 70 ? "19" : "20") + year;
      return `${year}-${mon}-${String(m[1]).padStart(2, "0")}`;
    }
  }
  return raw.slice(0, 10);
}

function tallyDate(value) {
  return parseTallyDate(value);
}

function companyVars(companyName) {
  return companyName ? { SVCURRENTCOMPANY: companyName } : {};
}

function dayBookVars(companyName) {
  return {
    ...companyVars(companyName),
    SVFROMDATE: "20200101",
    SVTODATE: "20301231",
  };
}

function attrValue(xml, attr) {
  const match = String(xml ?? "").match(new RegExp(`\\s${attr}="([^"]*)"`, "i"));
  return match ? match[1].trim() : null;
}

// Tally Import Data responses report per-request counters; treat anything other
// than an applied change as a failure so the backend never marks a no-op SUCCESS.
// Delete/Cancel must report their own counters — a Cancel that reports CREATED=1
// (or a Delete reporting anything but DELETED) did NOT do what was asked.
// TallyPrime Educational edition only accepts voucher dates on the 1st, 2nd and last day of a month, and reports every
// other date as "Voucher date is missing" - which sends people hunting for a bug in the XML that is not there.
function importErrorHint(lineError) {
  if (/voucher date is missing/i.test(String(lineError ?? ""))) {
    return " (If this TallyPrime is the Educational edition, vouchers can only be dated the 1st, 2nd or last day of a month - this is the message it gives for any other date. Use one of those dates, or a licensed TallyPrime.)";
  }
  if (/cannot be deleted/i.test(String(lineError ?? ""))) {
    return " (TallyPrime refuses to delete a master that is still in use: a ledger that appears in vouchers, a unit or godown that stock items use, a group with ledgers under it. Remove or change what uses it first. A freshly created, unused master deletes normally.)";
  }
  return "";
}

// The Day Book export only covers the period TallyPrime has open and ignores the requested dates, so a voucher dated
// outside it looks "absent". Reporting delete/cancel SUCCESS for that (as this used to) told the user the voucher was
// gone while it was untouched in the books.
function voucherNotInDayBook(action, payload) {
  const label = `${payload.voucher_type || "voucher"} ${payload.voucher_number ?? ""}`.trim();
  const err = new Error(
    `Cannot ${action} ${label}: it was not found in TallyPrime (all dates were checked), so nothing was changed. If it was already removed or renamed in Tally, sync to refresh the list.`
  );
  err.code = "VOUCHER_NOT_IN_DAY_BOOK";
  err.requiresSync = true;
  return err;
}

function assertImportOk(xml, expectedAction) {
  const count = (tag) => numeric(firstTag(xml, tag)) ?? 0;
  const lineError = firstTag(xml, "LINEERROR");
  const errors = count("ERRORS");
  const created = count("CREATED");
  const altered = count("ALTERED");
  const deleted = count("DELETED");
  const cancelled = count("CANCELLED");
  const applied = created + altered + deleted + cancelled;
  if (errors > 0 || lineError) {
    throw new Error(`Tally rejected the change: ${lineError || `${errors} error(s)`}${importErrorHint(lineError)}`);
  }
  if (expectedAction === "Delete" && deleted === 0) {
    throw new Error("Tally did not delete the entry (0 deleted). Check the entry still exists and TallyPrime has the company open.");
  }
  if (expectedAction === "Cancel" && cancelled === 0) {
    throw new Error("Tally did not cancel the voucher (0 cancelled). Check the voucher still exists and TallyPrime has the company open.");
  }
  if (applied === 0) {
    throw new Error("Tally did not apply the change (0 created/altered/deleted). Check the entry exists and TallyPrime has the company open.");
  }
  return { created, altered, deleted, cancelled };
}

function ledgersListEnvelope(companyName) {
  const vars = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${vars}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Ledgers" ISINITIALIZE="Yes">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
            <NATIVEMETHOD>Email</NATIVEMETHOD>
            <NATIVEMETHOD>LedgerPhone</NATIVEMETHOD>
            <NATIVEMETHOD>PhoneNumber</NATIVEMETHOD>
            <NATIVEMETHOD>MobileNo</NATIVEMETHOD>
            <NATIVEMETHOD>MailingName</NATIVEMETHOD>
            <NATIVEMETHOD>Address</NATIVEMETHOD>
            <NATIVEMETHOD>BillCreditPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>CreditPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
            <NATIVEMETHOD>MasterId</NATIVEMETHOD>
            <NATIVEMETHOD>AlterId</NATIVEMETHOD>
            <FETCH>Name,Parent,OpeningBalance,ClosingBalance,Email,LedgerPhone,PhoneNumber,MobileNo,MailingName,Address,LedMailingDetails,BillCreditPeriod,CreditPeriod,GUID,MasterId,AlterId</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function unitsListEnvelope(companyName) {
  return unitsExportEnvelope(companyName);
}

function godownsListEnvelope(companyName) {
  const vars = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Godowns</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${vars}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Godowns" ISINITIALIZE="Yes">
            <TYPE>Godown</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>Address</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
            <NATIVEMETHOD>MasterId</NATIVEMETHOD>
            <NATIVEMETHOD>AlterId</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function groupsListEnvelope(companyName) {
  const vars = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Groups</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${vars}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Groups" ISINITIALIZE="Yes">
            <TYPE>Group</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <FETCH>Name,Parent,GUID</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Confirmed live against TallyPrime (company "Tally XYZ", 2026-10-01): Collection
// TYPE=Voucher + this FETCH returns <VOUCHER> blocks with GUID/DATE/type and
// ALLLEDGERENTRIES / BILLALLOCATIONS / ALLINVENTORYENTRIES. Day Book is a
// subset of the same GUIDs. Do not invent extra FETCH names.
const VOUCHER_COLLECTION_FETCH =
  "Date, VoucherNumber, VoucherTypeName, PartyLedgerName, Amount, Narration, GUID, MasterId, AlterId, Reference, EffectiveDate, IsCancelled, IsOptional, AllLedgerEntries, LedgerEntries, AllInventoryEntries, InventoryEntries, BillAllocations";

function vouchersListEnvelope(companyName, dateRange = {}) {
  const vars = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  const from = dateRange.from ? parseTallyDate(dateRange.from) : "20200101";
  const to = dateRange.to ? parseTallyDate(dateRange.to) : "20301231";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>VouchersColl</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${vars}
        <SVFROMDATE>${escapeXml(from)}</SVFROMDATE>
        <SVTODATE>${escapeXml(to)}</SVTODATE>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="VouchersColl" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>${VOUCHER_COLLECTION_FETCH}</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function stockItemsListEnvelope(companyName) {
  const vars = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of StockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${vars}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of StockItems" ISINITIALIZE="Yes">
            <TYPE>StockItem</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>Category</NATIVEMETHOD>
            <NATIVEMETHOD>BaseUnits</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningValue</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningRate</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingValue</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingRate</NATIVEMETHOD>
            <NATIVEMETHOD>LastSaleRate</NATIVEMETHOD>
            <NATIVEMETHOD>LastPurcRate</NATIVEMETHOD>
            <NATIVEMETHOD>StandardCost</NATIVEMETHOD>
            <NATIVEMETHOD>StandardPrice</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
            <NATIVEMETHOD>MasterId</NATIVEMETHOD>
            <NATIVEMETHOD>AlterId</NATIVEMETHOD>
            <FETCH>Name,Parent,Category,BaseUnits,OpeningBalance,OpeningValue,OpeningRate,ClosingBalance,ClosingValue,ClosingRate,LastSaleRate,LastPurcRate,StandardCost,StandardPrice,GUID,MasterId,AlterId</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function companyListEnvelope() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Companies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVIsSimpleCompany>No</SVIsSimpleCompany>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Companies" ISINITIALIZE="Yes">
            <TYPE>Company</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
            <NATIVEMETHOD>StartingFrom</NATIVEMETHOD>
            <NATIVEMETHOD>EndingAt</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function currentCompanyEnvelope() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CompanyInfo</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <OBJECT NAME="CurrentCompany">
            <LOCALFORMULA>CurrentCompany:##SVCURRENTCOMPANY</LOCALFORMULA>
          </OBJECT>
          <COLLECTION NAME="CompanyInfo">
            <OBJECTS>CurrentCompany</OBJECTS>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function productReleaseEnvelope() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Function</TYPE>
    <ID>$$ProdInfo</ID>
  </HEADER>
  <BODY>
    <DESC>
      <FUNCPARAMLIST>
        <PARAM>ProdReleaseAsStr</PARAM>
      </FUNCPARAMLIST>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/** Large company exports must not be aborted at 30s while Tally is open. */
const TALLY_HTTP_TIMEOUT_MS = 120000;

/** 1 April of the financial year containing `date` (Indian financial year), as YYYYMMDD. */
function financialYearStartYmd(date = new Date()) {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  const year = ist.getUTCMonth() + 1 >= 4 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${year}0401`;
}

/**
 * A ledger's mailing details (address, state, country, pincode, mailing name). TallyPrime only keeps them inside a
 * <LEDMAILINGDETAILS.LIST> with an APPLICABLEFROM date; loose <ADDRESS.LIST>/<STATENAME>/<PINCODE>/<MAILINGNAME> tags
 * directly under <LEDGER> are accepted and then silently dropped (verified live: the ledger kept an empty list), which is
 * why an address written through the agent could never be read back.
 */
function ledgerMailingDetailsXml(payload) {
  const lines = String(payload.address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const has = lines.length || payload.mailing_name || payload.state || payload.country || payload.pincode;
  if (!has) return "";
  const from = String(payload.mailing_applicable_from || financialYearStartYmd()).replace(/-/g, "");
  return [
    "<LEDMAILINGDETAILS.LIST>",
    lines.length ? `  <ADDRESS.LIST TYPE="String">${lines.map((l) => `<ADDRESS>${escapeXml(l)}</ADDRESS>`).join("")}</ADDRESS.LIST>` : "",
    `  <APPLICABLEFROM>${escapeXml(from)}</APPLICABLEFROM>`,
    payload.mailing_name ? `  <MAILINGNAME>${escapeXml(payload.mailing_name)}</MAILINGNAME>` : "",
    payload.state ? `  <STATE>${escapeXml(payload.state)}</STATE>` : "",
    payload.country ? `  <COUNTRY>${escapeXml(payload.country)}</COUNTRY>` : "",
    payload.pincode ? `  <PINCODE>${escapeXml(payload.pincode)}</PINCODE>` : "",
    "</LEDMAILINGDETAILS.LIST>",
  ]
    .filter(Boolean)
    .join("\n    ");
}

/** The latest mailing details block of an exported ledger (history is one block per APPLICABLEFROM date). */
function parseLedgerMailing(block) {
  const blocks = tagBlocks(block, "LEDMAILINGDETAILS.LIST");
  const last = blocks[blocks.length - 1] || "";
  const addressLines = [...last.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/g)].map((m) => m[1]);
  return {
    addressLines,
    state: firstTag(last, "STATE"),
    country: firstTag(last, "COUNTRY"),
    pincode: firstTag(last, "PINCODE"),
    mailingName: firstTag(last, "MAILINGNAME"),
  };
}
/** Liveness probes (heartbeat) must give up quickly: a blocked TallyPrime would otherwise hold each one for two minutes. */
const TALLY_PROBE_TIMEOUT_MS = 8000;

/**
 * Turns a failed request to TallyPrime into something a person can act on. A request that is accepted but never answered
 * ("This operation was aborted") almost always means TallyPrime is waiting on a screen - the Backup Schedule prompt, a
 * confirmation, an error box - because while one is open it answers nothing. That is different from a closed port.
 */
function classifyTallyError(error, endpoint, timeoutMs) {
  if (error && error.name === "AbortError") {
    const err = new Error(
      `TallyPrime did not answer within ${Math.round(timeoutMs / 1000)}s (request aborted). It is open but busy or waiting on a screen: bring the TallyPrime window to the front and close any message, Backup Schedule or confirmation screen (Esc, or Q to quit it), then retry.`
    );
    err.code = "TALLY_NOT_RESPONDING";
    return err;
  }
  const code = error && error.cause && error.cause.code;
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND" || (error && error.message === "fetch failed")) {
    const err = new Error(`TallyPrime is not reachable at ${endpoint}. Check that it is running and that its server port is enabled (F1 > Settings > Connectivity).`);
    err.code = "TALLY_UNREACHABLE";
    return err;
  }
  return error;
}

class TallyClient {
  constructor(getConfig) {
    this.getConfig = typeof getConfig === "function" ? getConfig : () => getConfig || {};
    this.probeTimeoutMs = TALLY_PROBE_TIMEOUT_MS;
  }

  endpoint() {
    const cfg = this.getConfig();
    return `http://${cfg.tallyHost || "127.0.0.1"}:${Number(cfg.tallyPort || 9000)}`;
  }

  async postXml(xml, { timeoutMs } = {}) {
    const limit = timeoutMs ?? TALLY_HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      const res = await fetch(this.endpoint(), {
        method: "POST",
        headers: { "Content-Type": "text/xml;charset=utf-8" },
        body: xml,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Tally HTTP ${res.status}: ${text.slice(0, 240)}`);
      return text;
    } catch (error) {
      throw classifyTallyError(error, this.endpoint(), limit);
    } finally {
      clearTimeout(timer);
    }
  }

  async detect() {
    try {
      const companies = await this.companies({ timeoutMs: this.probeTimeoutMs });
      if (companies.length) {
        // companies()[0] is just the first LOADED company — with several
        // companies open it is often NOT the current one, which silently
        // misdirects every write. Prefer the true current company.
        const current = await this.currentCompanyRef();
        const picked =
          (current &&
            (companies.find((c) => c.tally_guid && current.tally_guid && c.tally_guid === current.tally_guid) ||
              companies.find(
                (c) => c.name && current.name && c.name.toLowerCase() === String(current.name).toLowerCase()
              ))) ||
          companies[0];
        return {
          tally_status: "ONLINE",
          company_loaded: true,
          company_name: picked.name,
          company_guid: picked.tally_guid,
        };
      }
      return { tally_status: "COMPANY_NOT_LOADED", company_loaded: false, company_name: null, company_guid: null };
    } catch (error) {
      this.productVersionCache = null;
      const port = Number(this.getConfig().tallyPort || 9000);
      if (error && error.code === "TALLY_NOT_RESPONDING") {
        // The port accepted the connection but nothing came back: a screen in TallyPrime is waiting for an answer.
        return { tally_status: "ERROR", company_loaded: false, company_name: null, company_guid: null, error: error.message };
      }
      if (tallyProcessRunning()) {
        return {
          tally_status: "PORT_CLOSED",
          company_loaded: false,
          company_name: null,
          company_guid: null,
          error: `TallyPrime is open, but it is not accepting requests on port ${port}. In Tally press F1, open Settings, then Connectivity, and set TallyPrime is acting as Both on port ${port}. Then restart TallyPrime.`,
        };
      }
      return { tally_status: "OFFLINE", company_loaded: false, company_name: null, company_guid: null, error: error.message };
    }
  }

  // Cached until Tally is unreachable: it may be upgraded while closed.
  async productVersion() {
    if (!this.productVersionCache) {
      const release = firstTag(await this.postXml(productReleaseEnvelope()), "RESULT");
      if (release) this.productVersionCache = `TallyPrime ${release.trim()}`;
    }
    return this.productVersionCache || null;
  }

  async companies(opts = {}) {
    const listXml = await this.postXml(companyListEnvelope(), opts);
    const companies = this.parseCompanies(listXml);
    if (companies.length) return companies;
    const currentXml = await this.postXml(currentCompanyEnvelope(), opts);
    return this.parseCompanies(currentXml);
  }

  async ledgers(companyGuid, companyName) {
    const xml = await this.postXml(ledgersListEnvelope(companyName));
    return this.parseLedgers(xml).map((record) => ({ ...record, company_guid: companyGuid }));
  }

  async groups(companyName) {
    const xml = await this.postXml(groupsListEnvelope(companyName));
    return tagBlocks(xml, "GROUP")
      .map((b) => {
        const rawName = firstTag(b, "NAME");
        const name = rawName ? String(rawName).replace(/<[^>]+>/g, "").trim() : null;
        if (!name || /^\d+$/.test(name)) return null;
        const rawParent = firstTag(b, "PARENT");
        const parent = rawParent ? String(rawParent).replace(/&#\d+;/g, "").replace(/[\x00-\x1F\x7F]/g, "").replace(/<[^>]+>/g, "").trim() : null;
        return { name, parent: parent || null };
      })
      .filter(Boolean);
  }

  async vouchers(companyGuid, companyName, dateRange = {}) {
    const xml = await this.postXml(vouchersListEnvelope(companyName, dateRange));
    return this.parseVouchers(xml).map((record) => ({ ...record, company_guid: companyGuid }));
  }

  async outstandings(companyGuid, companyName) {
    // NOTE: Tally's "Export Data" request returns an empty DATA block for the
    // Bills Receivable/Payable reports (verified against live TallyPrime:
    // 134-byte empty envelope). The plain "Export" request used by Day Book
    // is the working pattern, so use it here too.
    const recvXml = await this.postXml(tallyExportEnvelope("Bills Receivable", { staticVariables: companyVars(companyName) }));
    const records = this.parseOutstandings(recvXml, "RECEIVABLE");
    try {
      const payXml = await this.postXml(tallyExportEnvelope("Bills Payable", { staticVariables: companyVars(companyName) }));
      records.push(...this.parseOutstandings(payXml, "PAYABLE"));
    } catch {
      // Payables report unavailable on this Tally build — keep receivables,
      // but flag the list so the sync doesn't retire every payable bill.
      records.partial = true;
    }

    // Always fetch Day Book vouchers so we can enrich outstandings with real
    // dates.  Tally's Bills Receivable/Payable report puts the *financial
    // year start date* (e.g. 1-Apr-26) in <BILLDATE>, NOT the actual voucher
    // date, causing every bill to show as 2026-04-01.  The real voucher date
    // and due date live in the Day Book voucher / bill-allocation data.
    let dayBookVouchers = null;
    try {
      // The voucher Collection, not the Day Book: the Day Book only covers the period TallyPrime has open, so bills
      // dated outside it lost their real dates.
      const dayBook = await this.postXml(vouchersListEnvelope(companyName));
      dayBookVouchers = this.parseVouchers(dayBook);
    } catch {
      // Day Book unavailable — we'll keep the report dates as-is.
    }

    if (records.length && dayBookVouchers) {
      // Build a lookup: bill_name → { voucher_date, due_date, credit_period }
      // from the Day Book bill allocations.  When multiple vouchers reference
      // the same bill name, prefer the earliest voucher (the originating
      // invoice) since receipts/payments adjust the same bill.
      const billDateMap = new Map();
      for (const voucher of dayBookVouchers) {
        for (const bill of voucher.bill_allocations || []) {
          const key = String(bill.bill_name ?? "").trim();
          if (!key) continue;
          const existing = billDateMap.get(key);
          const vDate = voucher.voucher_date;
          // Keep the earliest voucher date — that is the original bill date.
          if (!existing || (vDate && (!existing.voucher_date || vDate < existing.voucher_date))) {
            billDateMap.set(key, {
              voucher_date: vDate,
              due_date: bill.due_date || voucher.due_date,
              credit_period: bill.credit_period || voucher.payment_terms,
            });
          }
        }
      }

      // Enrich each outstanding record with real dates from the Day Book.
      for (const rec of records) {
        const key = String(rec.bill_number ?? "").trim();
        const match = key ? billDateMap.get(key) : null;
        if (match) {
          // Day Book bill blocks carry no dates of their own; the voucher date
          // is the real bill date and Tally's BILLDUE is the real due date.
          // Never clear either — an absent value here must not blank a date
          // the report already supplied.
          if (match.voucher_date) rec.bill_date = match.voucher_date;
          // Outstanding <BILLDUE> is often FY-start (1-Apr), same as <BILLDATE>.
          // Day Book bill credit period / due date is the value we imported.
          const dayBookDue = match.due_date || dueFromCreditPeriod(match.credit_period, match.voucher_date);
          if (dayBookDue) rec.due_date = dayBookDue;
          else if (match.voucher_date && rec.due_date && String(rec.due_date).slice(0, 10) < String(match.voucher_date).slice(0, 10)) {
            rec.due_date = match.voucher_date;
          }
          if (match.credit_period && !rec.payment_terms) rec.payment_terms = match.credit_period;
        }
        // Recompute status from the corrected due_date. Compare at UTC
        // midnight of the day so a bill isn't overdue from 05:30 IST.
        const dueTime = rec.due_date ? new Date(`${String(rec.due_date).slice(0, 10)}T00:00:00Z`).getTime() : null;
        rec.status = rec.amount === 0 ? "PAID" : dueTime && dueTime < Date.now() ? "OVERDUE" : "PENDING";
      }
    } else if (!records.length && dayBookVouchers) {
      // Fallback: when the bill-wise reports come back empty (bill-wise
      // tracking disabled in Tally, or report name mismatch across Tally
      // builds), derive outstanding bills from Day Book voucher bill
      // allocations so Billing still reflects real bill references.
      for (const voucher of dayBookVouchers) {
        for (const bill of voucher.bill_allocations || []) {
          if (!bill.bill_name || bill.amount == null) continue;
          const isPayable = String(voucher.voucher_type || "").toLowerCase().includes("purchase") || String(voucher.voucher_type || "").toLowerCase().includes("payment");
          const billAmount = Math.abs(Number(bill.amount ?? 0));
          const billDue = bill.due_date || voucher.due_date || dueFromCreditPeriod(bill.credit_period, voucher.voucher_date);
          records.push({
            bill_type: isPayable ? "PAYABLE" : "RECEIVABLE",
            party_name: bill.party_name || voucher.party_name || bill.bill_name,
            bill_number: bill.bill_name,
            bill_date: bill.bill_date || voucher.voucher_date,
            due_date: billDue,
            amount: billAmount,
            pending_amount: bill.pending_amount != null ? Math.abs(Number(bill.pending_amount)) : billAmount,
            status: billAmount === 0 ? "PAID" : billDue && new Date(`${String(billDue).slice(0, 10)}T00:00:00Z`).getTime() < Date.now() ? "OVERDUE" : "PENDING",
            payment_terms: bill.credit_period || voucher.payment_terms,
            raw: {},
          });
        }
      }
    }
    return records.map((record) => ({ ...record, company_guid: companyGuid }));
  }

  async godowns(companyGuid, companyName) {
    const xml = await this.postXml(godownsListEnvelope(companyName));
    return this.parseGodowns(xml).map((record) => ({ ...record, company_guid: companyGuid }));
  }

  async units(companyGuid, companyName) {
    const xml = await this.postXml(unitsListEnvelope(companyName));
    return this.parseUnits(xml).map((record) => ({ ...record, company_guid: companyGuid }));
  }

  async queryGroupsRaw(companyName) {
    const xml = await this.postXml(tallyExportEnvelope("List of Accounts", { request: "Export Data", staticVariables: companyVars(companyName) }));
    return { tally_response: xml };
  }

  async stockItems(companyGuid, companyName) {
    const xml = await this.postXml(stockItemsListEnvelope(companyName));
    return this.parseStockItems(xml).map((record) => ({ ...record, company_guid: companyGuid }));
  }

  async queryStockItems(companyName) {
    return { tally_response: await this.postXml(stockItemsListEnvelope(companyName)) };
  }

  async currentCompany() {
    const currentXml = await this.postXml(currentCompanyEnvelope());
    const companies = this.parseCompanies(currentXml);
    return { company: companies[0] || null, companies };
  }

  async licenseInfo() {
    const xml = await this.postXml(tallyExportEnvelope("LicenseInfo", { type: "Collection" }));
    return {
      educational_mode: firstTag(xml, "ISEDUCATIONALMODE") || firstTag(xml, "ISEDUCATIONAL"),
      serial_number: firstTag(xml, "SERIALNUMBER"),
      account_id: firstTag(xml, "ACCOUNTID"),
      tally_response: xml,
    };
  }

  async vouchersByType(payload) {
    const xml = await this.postXml(
      tallyExportEnvelope("List Of Vouchers", {
        staticVariables: {
          ...companyVars(payload.company_name),
          SVFROMDATE: payload.from_date ? tallyDate(payload.from_date) : undefined,
          SVTODATE: payload.to_date ? tallyDate(payload.to_date) : undefined,
          VOUCHERTYPENAME: payload.voucher_type,
        },
      })
    );
    return { tally_response: xml };
  }

  async ledgerVouchers(payload) {
    const xml = await this.postXml(
      tallyExportEnvelope("Vouchers", {
        type: "Collection",
        staticVariables: {
          ...companyVars(payload.company_name),
          SVFROMDATE: payload.from_date ? tallyDate(payload.from_date) : undefined,
          SVTODATE: payload.to_date ? tallyDate(payload.to_date) : undefined,
          LEDGERNAME: payload.ledger_name,
        },
      })
    );
    return { tally_response: xml };
  }

  // Query a single voucher from Tally and return its raw block + key identity fields (GUID, MASTERID, REMOTEID)
  async queryVoucher(payload = {}) {
    const xml = await this.dayBookFor(payload);
    const block = this.findVoucherBlock(xml, payload);
    if (!block) {
      return {
        found: false,
        message: `Voucher ${payload.voucher_type || ""} ${payload.voucher_number || ""} not found in Day Book for "${payload.company_name || "active company"}"`,
      };
    }
    return {
      found: true,
      voucher_type: firstTag(block, "VOUCHERTYPENAME"),
      voucher_number: firstTag(block, "VOUCHERNUMBER"),
      date: asDate(firstTag(block, "DATE")),
      guid: firstTag(block, "GUID"),
      master_id: firstTag(block, "MASTERID"),
      alter_id: firstTag(block, "ALTERID"),
      remote_id_attr: attrValue(block, "REMOTEID"),
      vch_key_attr: attrValue(block, "VCHKEY"),
      party_name: firstTag(block, "PARTYLEDGERNAME") || firstTag(block, "PARTYNAME"),
      amount: numeric(firstTag(block, "AMOUNT")),
      raw_xml: block,
    };
  }

  parseCompanies(xml) {
    const blocks = [...tagBlocks(xml, "COMPANY"), ...tagBlocks(xml, "REMOTECMPINFO.LIST"), ...tagBlocks(xml, "COMPANYINFO")];
    if (!blocks.length) {
      const name =
        firstTag(xml, "CURRENTCOMPANY") ||
        firstTag(xml, "SVCURRENTCOMPANY") ||
        firstTag(xml, "CMPNAME") ||
        firstTag(xml, "NAME");
      return name ? [{ tally_guid: firstTag(xml, "GUID"), name, raw: { source: "fallback" } }] : [];
    }
    return blocks
      .map((block) => ({
        tally_guid: firstTag(block, "GUID") || firstTag(block, "MASTERID") || attrValue(block, "GUID"),
        name:
          firstTag(block, "CURRENTCOMPANY") ||
          firstTag(block, "NAME") ||
          firstTag(block, "REMOTECMPNAME") ||
          firstTag(block, "CMPNAME") ||
          attrValue(block, "NAME") ||
          "Tally Company",
        financial_year_from: asDate(firstTag(block, "STARTINGFROM")),
        financial_year_to: asDate(firstTag(block, "ENDINGAT")),
        raw: {},
      }))
      .filter((company) => company.name && company.name !== "Tally Company");
  }

  parseLedgers(xml) {
    const cleanField = (val) => {
      if (!val) return null;
      // decodeXml now handles numeric references and control characters for every parser (this used to be a
      // ledger-only workaround that also deleted legitimate references such as &#38;).
      const s = decodeXml(String(val));
      if (!s || s.toLowerCase() === "not applicable") return null;
      return s;
    };

    return tagBlocks(xml, "LEDGER")
      .map((block) => {
        const name = cleanField(attrValue(block, "NAME") || firstTag(block, "NAME"));
        // Filter out summary counter blocks like <LEDGER>3</LEDGER>
        if (!name || name === "Unnamed Ledger" || /^\d+$/.test(name.trim())) return null;

        const parent = cleanField(firstTag(block, "PARENT"));
        const emailRaw = cleanField(firstTag(block, "EMAIL"));
        const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
        const phone = cleanField(firstTag(block, "LEDGERPHONE") || firstTag(block, "PHONENUMBER") || firstTag(block, "MOBILENO"));
        const mailing = parseLedgerMailing(block);
        const mailingName = cleanField(mailing.mailingName || firstTag(block, "MAILINGNAME"));
        const addressLines = mailing.addressLines.map(cleanField).filter(Boolean);
        const address = addressLines.length ? addressLines.join(", ") : cleanField(firstTag(block, "ADDRESS"));
        const state = cleanField(mailing.state || firstTag(block, "STATENAME") || firstTag(block, "LEDGERSTATE"));
        const pincode = cleanField(mailing.pincode || firstTag(block, "PINCODE"));
        const country = cleanField(mailing.country || firstTag(block, "COUNTRYNAME") || firstTag(block, "LEDGERCOUNTRY"));
        const creditPeriodDays = numeric(firstTag(block, "BILLCREDITPERIOD") || firstTag(block, "CREDITPERIOD"));

        const openingBal = numeric(firstTag(block, "OPENINGBALANCE"));
        const closingRaw = firstTag(block, "CLOSINGBALANCE");
        const closingBal = numeric(closingRaw);
        const masterId = cleanField(firstTag(block, "MASTERID"));

        return {
          tally_guid: firstTag(block, "GUID") || attrValue(block, "GUID") || null,
          master_id: masterId || null,
          name,
          parent: parent || null,
          ledger_group: parent || null,
          opening_balance: openingBal != null ? openingBal : 0,
          closing_balance: closingBal != null ? closingBal : (closingRaw !== null ? 0 : (openingBal ?? 0)),
          email,
          phone,
          mailing_name: mailingName || null,
          address: address || null,
          state: state || null,
          pincode: pincode || null,
          country: country || null,
          credit_period_days: creditPeriodDays != null ? Math.round(creditPeriodDays) : null,
          raw: {},
        };
      })
      .filter(Boolean);
  }

  parseVouchers(xml) {
    return tagBlocks(xml, "VOUCHER").map((block) => {
      // ALL*ENTRIES.LIST is the full list. Invoice-view vouchers repeat the same
      // lines in LEDGERENTRIES.LIST / INVENTORYENTRIES.LIST (confirmed live), so
      // fall back to those only when the ALL list is empty. Empty placeholder
      // blocks (<...LIST> </...LIST>) carry no name and are skipped.
      const voucherDate = asDate(firstTag(block, "DATE"));
      const preferAll = (tag, ...nameTags) => {
        const named = (t) => tagBlocks(block, t).filter((b) => nameTags.some((n) => firstTag(b, n)));
        const all = named(`ALL${tag}`);
        return all.length ? all : named(tag);
      };
      const ledgerBlocks = preferAll("LEDGERENTRIES.LIST", "LEDGERNAME");
      const ledgerEntries = ledgerBlocks
        .map((line, index) => {
          const ledgerName = firstTag(line, "LEDGERNAME");
          if (!ledgerName) return null;
          const amount = numeric(firstTag(line, "AMOUNT"));
          return {
            line_index: index,
            ledger_name: ledgerName,
            amount,
            debit_amount: amount != null && amount < 0 ? Math.abs(amount) : null,
            credit_amount: amount != null && amount > 0 ? amount : null,
            is_deemed_positive: bool(firstTag(line, "ISDEEMEDPOSITIVE")),
            is_party_ledger: bool(firstTag(line, "ISPARTYLEDGER")),
            bill_allocations: this.parseBillAllocations(line, ledgerName, voucherDate),
            raw: {},
          };
        })
        .filter(Boolean)
        .map((line, index) => ({ ...line, line_index: index }));
      const inventoryBlocks = preferAll("INVENTORYENTRIES.LIST", "STOCKITEMNAME", "NAME");
      const inventoryEntries = inventoryBlocks
        .map((line, index) => {
          const stockName = firstTag(line, "STOCKITEMNAME") || firstTag(line, "NAME");
          if (!stockName) return null;
          const batchBlock = firstTag(line, "BATCHALLOCATIONS.LIST") || "";
          return {
            line_index: index,
            stock_item_name: stockName,
            actual_qty: numeric(firstTag(line, "ACTUALQTY")),
            billed_qty: numeric(firstTag(line, "BILLEDQTY")),
            rate: numeric(firstTag(line, "RATE")),
            amount: Math.abs(numeric(firstTag(line, "AMOUNT")) ?? 0),
            godown_name: firstTag(line, "GODOWNNAME") || firstTag(batchBlock, "GODOWNNAME"),
            batch_name: firstTag(line, "BATCHNAME") || firstTag(batchBlock, "BATCHNAME"),
            raw: {},
          };
        })
        .filter(Boolean)
        .map((line, index) => ({ ...line, line_index: index }));
      const totalDebit = ledgerEntries.reduce((sum, line) => sum + Number(line.debit_amount || 0), 0);
      const totalCredit = ledgerEntries.reduce((sum, line) => sum + Number(line.credit_amount || 0), 0);
      const firstBill = ledgerEntries.flatMap((line) => line.bill_allocations || [])[0];
      const guid = firstTag(block, "GUID") || firstTag(block, "MASTERID");
      const ridAttr = attrValue(block, "REMOTEID");
      const remoteId = ridAttr && ridAttr !== guid ? ridAttr : null;
      return {
        tally_guid: guid,
        remote_id: remoteId,
        master_id: firstTag(block, "MASTERID"),
        alter_id: firstTag(block, "ALTERID"),
        voucher_number: firstTag(block, "VOUCHERNUMBER"),
        voucher_type: firstTag(block, "VOUCHERTYPENAME"),
        voucher_date: asDate(firstTag(block, "DATE")),
        effective_date: asDate(firstTag(block, "EFFECTIVEDATE")) || asDate(firstTag(block, "DATE")),
        party_name: (() => {
          const rawParty = firstTag(block, "PARTYLEDGERNAME") || firstTag(block, "PARTYNAME");
          const nonCash = ledgerEntries.find((l) => l.ledger_name && !/^(cash\b|bank\b|check\b)/i.test(l.ledger_name.trim()));
          return (rawParty && !/^(cash\b|check\b)/i.test(rawParty.trim()) ? rawParty : nonCash?.ledger_name) || rawParty || null;
        })(),
        reference_number: firstTag(block, "REFERENCE") || firstTag(block, "REFERENCENUMBER"),
        due_date: firstBill?.due_date || null,
        payment_terms: firstBill?.credit_period || null,
        amount: (() => {
          const parsed = numeric(firstTag(block, "AMOUNT"));
          if (parsed != null) return Math.abs(parsed);
          return totalCredit || totalDebit || null;
        })(),
        total_debit: totalDebit || null,
        total_credit: totalCredit || null,
        is_cancelled: bool(firstTag(block, "ISCANCELLED")) === true,
        is_optional: bool(firstTag(block, "ISOPTIONAL")) === true,
        narration: firstTag(block, "NARRATION"),
        ledger_entries: ledgerEntries,
        bill_allocations: ledgerEntries.flatMap((line) => line.bill_allocations || []),
        inventory_entries: inventoryEntries,
        raw: {},
      };
    }).filter((record) => record.tally_guid || record.voucher_type || record.voucher_date);
  }

  parseBillAllocations(xml, ledgerName = null, voucherDate = null) {
    // Empty placeholder blocks (<BILLALLOCATIONS.LIST> </BILLALLOCATIONS.LIST>)
    // are emitted by Tally for vouchers without bill-wise details — skip them
    // instead of creating junk { bill_name: "Bill", amount: null } rows.
    return tagBlocks(xml, "BILLALLOCATIONS.LIST")
      .map((block) => {
        const billName = firstTag(block, "NAME") || firstTag(block, "BILLNAME") || firstTag(block, "REFERENCE");
        const amount = numeric(firstTag(block, "AMOUNT"));
        if (!billName && amount == null) return null;
        const party = firstTag(block, "BILLPARTY") || firstTag(block, "LEDGERNAME") || ledgerName;
        const creditPeriod = firstTag(block, "CREDITPERIOD") || firstTag(block, "BILLCREDITPERIOD");
        const dueFromTag = tallyBillDate(firstTag(block, "DUEDATE"));
        return {
          bill_name: billName || "Bill",
          party_name: party || null,
          bill_type: firstTag(block, "BILLTYPE"),
          bill_date: asDate(firstTag(block, "BILLDATE")) || voucherDate,
          due_date: dueFromTag || dueFromCreditPeriod(creditPeriod, voucherDate),
          credit_period: creditPeriod,
          amount,
          pending_amount: amount,
          status: "PENDING",
          raw: {},
        };
      })
      .filter(Boolean);
  }

  parseOutstandings(xml, billType = "RECEIVABLE") {
    // Tally renders outstanding bills in two shapes depending on the report:
    // 1. BILLALLOCATIONS.LIST blocks (NAME/BILLPARTY/AMOUNT/BILLDATE/DUEDATE).
    // 2. Bills Receivable/Payable export: <BILLFIXED><BILLDATE>1-Apr-26</...>
    //    <BILLREF>..</BILLREF><BILLPARTY>..</BILLPARTY></BILLFIXED> followed by
    //    sibling <BILLCL> (closing, signed), <BILLDUE> and <BILLOVERDUE> tags.
    // Amounts are magnitudes — Tally signs closings by direction (receivable
    // closings come back negative), so normalize with Math.abs.
    const fromAllocations = tagBlocks(xml, "BILLALLOCATIONS.LIST")
      .map((block) => {
        const billNumber = firstTag(block, "NAME") || firstTag(block, "BILLNAME");
        const partyName = firstTag(block, "BILLPARTY") || firstTag(block, "LEDGERNAME");
        // Skip empty placeholder blocks — no party and no bill number means
        // Tally returned no real outstanding bill here.
        if (!partyName && !billNumber) return null;
        const amount = Math.abs(numeric(firstTag(block, "AMOUNT")) ?? 0);
        const dueDate = tallyBillDate(firstTag(block, "DUEDATE"));
        return {
          bill_type: billType,
          party_name: partyName || "Unknown Party",
          bill_number: billNumber,
          bill_date: tallyBillDate(firstTag(block, "BILLDATE")),
          due_date: dueDate,
          amount,
          pending_amount: amount,
          status: amount === 0 ? "PAID" : dueDate && new Date(`${dueDate}T00:00:00Z`).getTime() < Date.now() ? "OVERDUE" : "PENDING",
          payment_terms: firstTag(block, "CREDITPERIOD") || firstTag(block, "BILLCREDITPERIOD"),
          raw: {},
        };
      })
      .filter(Boolean);
    const fromBillFixed = String(xml ?? "")
      .split(/<BILLFIXED>/i)
      .slice(1)
      .map((chunk) => {
        const [fixed = "", rest = ""] = chunk.split(/<\/BILLFIXED>/i);
        const billNumber = firstTag(fixed, "BILLREF") || firstTag(fixed, "NAME");
        const partyName = firstTag(fixed, "BILLPARTY");
        if (!partyName && !billNumber) return null;
        const amount = Math.abs(numeric(firstTag(rest, "BILLCL")) ?? 0);
        const billDate = tallyBillDate(firstTag(fixed, "BILLDATE"));
        const dueDate = tallyBillDate(firstTag(rest, "BILLDUE"));
        // BILLOVERDUE is Tally's own overdue verdict — trust it over a date
        // comparison, which flips a bill overdue at 00:00 of its due day.
        const overdue = numeric(firstTag(rest, "BILLOVERDUE"));
        return {
          bill_type: billType,
          party_name: partyName || "Unknown Party",
          bill_number: billNumber,
          bill_date: billDate,
          due_date: dueDate,
          amount,
          pending_amount: amount,
          status: amount === 0 ? "PAID" : (overdue != null && overdue > 0) || (dueDate && new Date(`${dueDate}T00:00:00Z`).getTime() < Date.now()) ? "OVERDUE" : "PENDING",
          payment_terms: null,
          raw: {},
        };
      })
      .filter(Boolean);
    return [...fromAllocations, ...fromBillFixed];
  }

  parseUnits(xml) {
    return tagBlocks(xml, "UNIT")
      .map((block) => {
        const raw = firstTag(block, "NAME") || attrValue(block, "NAME") || firstTag(block, "SYMBOL");
        const name = raw ? String(raw).replace(/<[^>]+>/g, "").trim() : null;
        if (!name || name === "Unit" || /^\d+$/.test(name) || name.startsWith("<")) return null;
        return {
          tally_guid: firstTag(block, "GUID") || firstTag(block, "MASTERID"),
          name,
          formal_name: firstTag(block, "ORIGINALNAME") || firstTag(block, "FORMALNAME"),
          symbol: firstTag(block, "SYMBOL") || name,
          uqc: firstTag(block, "GSTREPUOM") || firstTag(block, "UQC"),
          decimal_places: numeric(firstTag(block, "DECIMALPLACES")),
          is_simple: bool(firstTag(block, "ISSIMPLEUNIT")),
          base_units: firstTag(block, "BASEUNITS"),
          additional_units: firstTag(block, "ADDITIONALUNITS"),
          conversion: numeric(firstTag(block, "CONVERSION")),
          master_id: firstTag(block, "MASTERID"),
          alter_id: firstTag(block, "ALTERID"),
          raw: {},
        };
      })
      .filter(Boolean);
  }

  parseGodowns(xml) {
    return tagBlocks(xml, "GODOWN")
      .map((block) => {
        const raw = firstTag(block, "NAME") || attrValue(block, "NAME");
        const name = raw ? String(raw).replace(/<[^>]+>/g, "").trim() : null;
        if (!name || name === "Godown" || /^\d+$/.test(name) || name.startsWith("<")) return null;
        return {
          tally_guid: firstTag(block, "GUID") || firstTag(block, "MASTERID"),
          name,
          parent: firstTag(block, "PARENT"),
          address: firstTag(block, "ADDRESS"),
          raw: {},
        };
      })
      .filter(Boolean);
  }

  parseStockItems(xml) {
    const cleanField = (val) => {
      if (!val) return null;
      const s = String(val).replace(/&#\d+;/g, "").replace(/[\x00-\x1F\x7F]/g, "").replace(/<[^>]+>/g, "").trim();
      if (!s || s.toLowerCase() === "not applicable") return null;
      return s;
    };

    return tagBlocks(xml, "STOCKITEM")
      .map((block) => {
        const rawName = attrValue(block, "NAME") || firstTag(block, "NAME");
        const name = rawName ? String(rawName).replace(/<[^>]+>/g, "").trim() : null;
        // Filter out summary counter blocks like <STOCKITEM>2</STOCKITEM> or corrupted tags
        if (!name || name === "Stock Item" || /^\d+$/.test(name) || name.startsWith("<")) return null;

        const parent = cleanField(firstTag(block, "PARENT") || firstTag(block, "STOCKGROUPNAME") || firstTag(block, "STOCKGROUP"));
        const category = cleanField(firstTag(block, "CATEGORY") || firstTag(block, "STOCKCATEGORYNAME"));
        const baseUnitsRaw = firstTag(block, "BASEUNITS") || firstTag(block, "UNITS") || firstTag(block, "UOM");
        const baseUnits = cleanField((firstTag(baseUnitsRaw, "NAME") || baseUnitsRaw || "").replace(/<[^>]+>/g, ""));

        const openingBalance = numeric(firstTag(block, "OPENINGBALANCE"));
        const openingRate = numeric(firstTag(block, "OPENINGRATE"));
        let openingValue = numeric(firstTag(block, "OPENINGVALUE"));
        if (openingValue == null && openingBalance != null && openingRate != null) {
          openingValue = Math.round(openingBalance * openingRate * 100) / 100;
        }
        if (openingValue != null && openingBalance != null && openingBalance >= 0) {
          openingValue = Math.abs(openingValue);
        }

        const closingBalance = numeric(firstTag(block, "CLOSINGBALANCE"));
        const closingRate = numeric(firstTag(block, "CLOSINGRATE"));
        let closingValue = numeric(firstTag(block, "CLOSINGVALUE"));
        if (closingValue == null && closingBalance != null && closingRate != null) {
          closingValue = Math.round(closingBalance * closingRate * 100) / 100;
        }
        if (closingValue != null && closingBalance != null && closingBalance >= 0) {
          closingValue = Math.abs(closingValue);
        }

        const lastSaleRate = numeric(firstTag(block, "LASTSALERATE")) || numeric(firstTag(block, "STANDARDPRICE")) || closingRate;
        const lastPurchaseRate = numeric(firstTag(block, "LASTPURCRATE") || firstTag(block, "LASTPURCHASERATE")) || numeric(firstTag(block, "STANDARDCOST")) || openingRate;

        return {
          tally_guid: firstTag(block, "GUID") || firstTag(block, "MASTERID") || attrValue(block, "GUID"),
          name: cleanField(name) || name,
          parent: parent || null,
          category: category || null,
          base_units: baseUnits || null,
          opening_balance: openingBalance,
          opening_value: openingValue,
          closing_balance: closingBalance,
          closing_value: closingValue,
          last_sale_rate: lastSaleRate,
          last_purchase_rate: lastPurchaseRate,
          raw: {},
        };
      })
      .filter(Boolean);
  }

  // Masters (Ledger/Unit/StockItem/...) are keyed by NAME for Create/Alter/Delete.
  // The NAME attribute always locates the existing object; the inner <NAME>
  // element is the value Tally writes back - passing newName renames it,
  // otherwise both stay the same (no-op rename).
  // companyName pins the write to a specific company via SVCURRENTCOMPANY -
  // without it, plain-name lookups can hit the wrong company if two share a
  // name (only Create has nothing to disambiguate, so it never passes this).
  masterXml(tag, name, action, body = "", newName, companyName) {
    return tallyImportEnvelope(`
<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <${tag} NAME="${escapeXml(name)}" ACTION="${escapeXml(action)}">
    <NAME>${escapeXml(newName || name)}</NAME>
    ${body}
  </${tag}>
</TALLYMESSAGE>`, "All Masters", companyName ? { SVCURRENTCOMPANY: companyName } : undefined);
  }

  ledgerBodyXml(payload, { withDefaults = true } = {}) {
    return [
      payload.parent || withDefaults ? `<PARENT>${escapeXml(payload.parent || "Sundry Debtors")}</PARENT>` : "",
      ledgerMailingDetailsXml(payload),
      payload.email ? `<EMAIL>${escapeXml(payload.email)}</EMAIL>` : "",
      payload.phone ? `<LEDGERPHONE>${escapeXml(payload.phone)}</LEDGERPHONE>` : "",
      payload.mobile ? `<LEDGERMOBILE>${escapeXml(payload.mobile)}</LEDGERMOBILE>` : "",
      payload.contact_name ? `<LEDGERCONTACT>${escapeXml(payload.contact_name)}</LEDGERCONTACT>` : "",
      payload.pan ? `<INCOMETAXNUMBER>${escapeXml(payload.pan)}</INCOMETAXNUMBER>` : "",
      payload.gstin ? `<PARTYGSTIN>${escapeXml(payload.gstin)}</PARTYGSTIN>` : "",
      payload.gst_registration_type ? `<GSTREGISTRATIONTYPE>${escapeXml(payload.gst_registration_type)}</GSTREGISTRATIONTYPE>` : "",
      payload.maintain_bill_by_bill !== undefined ? `<ISBILLWISEON>${payload.maintain_bill_by_bill ? "Yes" : "No"}</ISBILLWISEON>` : "",
      payload.credit_period_days != null && payload.credit_period_days !== "" ? `<BILLCREDITPERIOD>${escapeXml(payload.credit_period_days)} Days</BILLCREDITPERIOD>` : "",
      payload.credit_limit != null && payload.credit_limit !== "" ? `<CREDITLIMIT>${escapeXml(payload.credit_limit)}</CREDITLIMIT>` : "",
      payload.opening_balance != null && payload.opening_balance !== "" ? `<OPENINGBALANCE>${escapeXml(payload.opening_balance)}</OPENINGBALANCE>` : "",
      payload.bank_account_number ? `<BANKACCOUNTNUMBER>${escapeXml(payload.bank_account_number)}</BANKACCOUNTNUMBER>` : "",
      payload.bank_name ? `<BANKNAME>${escapeXml(payload.bank_name)}</BANKNAME>` : "",
      payload.bank_branch ? `<BRANCHNAME>${escapeXml(payload.bank_branch)}</BRANCHNAME>` : "",
      payload.bank_acc_holder ? `<BANKACCHOLDERNAME>${escapeXml(payload.bank_acc_holder)}</BANKACCHOLDERNAME>` : "",
      payload.bank_ifsc ? `<BANKCONFIGIFSC>${escapeXml(payload.bank_ifsc)}</BANKCONFIGIFSC>` : "",
      payload.bank_micr ? `<BANKMICR>${escapeXml(payload.bank_micr)}</BANKMICR>` : "",
      payload.bank_iban ? `<BANKIBAN>${escapeXml(payload.bank_iban)}</BANKIBAN>` : "",
      payload.bank_swift ? `<SWIFTCODE>${escapeXml(payload.bank_swift)}</SWIFTCODE>` : "",
    ].filter(Boolean).join("\n    ");
  }

  createLedgerXml(payload) {
    return this.masterXml("LEDGER", payload.name, "Create", this.ledgerBodyXml(payload));
  }

  alterLedgerXml(payload) {
    return this.masterXml("LEDGER", payload.name, "Alter", this.ledgerBodyXml(payload, { withDefaults: false }), payload.new_name, payload.company_name);
  }

  unitBodyXml(payload) {
    const decimals = payload.decimal_places != null && payload.decimal_places !== "" ? Number(payload.decimal_places) : null;
    const isCompound = Boolean((payload.base_units || payload.baseUnit) && (payload.additional_units || payload.additionalUnit) && payload.conversion);
    return [
      `<ISSIMPLEUNIT>${isCompound || payload.simple === false || payload.is_simple === false ? "No" : "Yes"}</ISSIMPLEUNIT>`,
      payload.formal_name || payload.formalName ? `<ORIGINALNAME>${escapeXml(payload.formal_name || payload.formalName)}</ORIGINALNAME>` : "",
      payload.uqc || payload.gst_rep_uom || payload.GSTRepUOM ? `<GSTREPUOM>${escapeXml(payload.uqc || payload.gst_rep_uom || payload.GSTRepUOM)}</GSTREPUOM>` : "",
      payload.base_units || payload.baseUnit ? `<BASEUNITS>${escapeXml(payload.base_units || payload.baseUnit)}</BASEUNITS>` : "",
      payload.additional_units || payload.additionalUnit ? `<ADDITIONALUNITS>${escapeXml(payload.additional_units || payload.additionalUnit)}</ADDITIONALUNITS>` : "",
      payload.conversion ? `<CONVERSION>${escapeXml(payload.conversion)}</CONVERSION>` : "",
      !isCompound && Number.isFinite(decimals) ? `<DECIMALPLACES>${decimals}</DECIMALPLACES>` : "",
    ].filter(Boolean).join("\n    ");
  }

  createUnitXml(payload) {
    if (payload.company_name || payload.companyName) {
      return tallyUnitEnvelope({
        ...payload,
        companyName: payload.company_name || payload.companyName,
        action: "Create",
      });
    }
    return this.masterXml("UNIT", payload.name, "Create", this.unitBodyXml(payload));
  }

  alterUnitXml(payload) {
    if (payload.new_name) {
      return this.masterXml("UNIT", payload.name, "Alter", this.unitBodyXml(payload), payload.new_name, payload.company_name || payload.companyName);
    }
    if (payload.company_name || payload.companyName) {
      return tallyUnitEnvelope({
        ...payload,
        companyName: payload.company_name || payload.companyName,
        action: "Alter",
      });
    }
    return this.masterXml("UNIT", payload.old_name || payload.oldName || payload.name, "Alter", this.unitBodyXml(payload));
  }

  // Delete goes through masterXml (same request as godown / stock item / ledger deletes) with the company. The unit
  // envelope used to be used here: it sends <UNIT NAME="x" ACTION="Delete"></UNIT> with no <NAME> child, and TallyPrime
  // does not answer that request at all - it freezes until someone dismisses a screen, taking every later command with it.
  deleteUnitXml(payload) {
    return this.masterXml("UNIT", payload.name, "Delete", "", undefined, payload.company_name || payload.companyName);
  }

  godownBodyXml(payload) {
    return [
      payload.parent ? `<PARENT>${escapeXml(payload.parent)}</PARENT>` : "",
      payload.address ? `<ADDRESS>${escapeXml(payload.address)}</ADDRESS>` : "",
    ].filter(Boolean).join("\n    ");
  }

  createGodownXml(payload) {
    return this.masterXml("GODOWN", payload.name, "Create", this.godownBodyXml(payload));
  }

  // Alter keeps the godown's name unless new_name is given (a rename); only the fields sent are touched.
  alterGodownXml(payload) {
    return this.masterXml("GODOWN", payload.name, "Alter", this.godownBodyXml(payload), payload.new_name, payload.company_name);
  }

  deleteGodownXml(payload) {
    return this.masterXml("GODOWN", payload.name, "Delete", "", undefined, payload.company_name);
  }

  stockItemBodyXml(payload, { withDefaults = true } = {}) {
    const unit = payload.base_units || (withDefaults ? "Nos" : "");
    const costRate = payload.standard_cost != null && payload.standard_cost !== "" ? `${payload.standard_cost}/${unit || "Nos"}` : "";
    const priceRate = payload.standard_price != null && payload.standard_price !== "" ? `${payload.standard_price}/${unit || "Nos"}` : "";
    const godown = payload.godown_name || "Main Location";
    const openBal = payload.opening_balance != null && payload.opening_balance !== "" ? `${payload.opening_balance} ${unit || "Nos"}` : "";
    const openVal = payload.opening_value != null && payload.opening_value !== "" ? payload.opening_value : (payload.opening_rate && payload.opening_balance ? (Number(payload.opening_rate) * Number(payload.opening_balance)).toFixed(2) : "");
    const openRate = payload.opening_rate != null && payload.opening_rate !== "" ? `${payload.opening_rate}/${unit || "Nos"}` : "";

    const batchAlloc = openBal ? `
    <BATCHALLOCATIONS.LIST>
      <GODOWNNAME>${escapeXml(godown)}</GODOWNNAME>
      <BATCHNAME>Primary Batch</BATCHNAME>
      <OPENINGBALANCE>${escapeXml(openBal)}</OPENINGBALANCE>
      ${openRate ? `<OPENINGRATE>${escapeXml(openRate)}</OPENINGRATE>` : ""}
      ${openVal ? `<OPENINGVALUE>${escapeXml(openVal)}</OPENINGVALUE>` : ""}
    </BATCHALLOCATIONS.LIST>` : "";

    const stdCost = costRate ? `
    <STANDARDCOSTLIST.LIST>
      <RATE>${escapeXml(costRate)}</RATE>
    </STANDARDCOSTLIST.LIST>` : "";

    const stdPrice = priceRate ? `
    <STANDARDPRICELIST.LIST>
      <RATE>${escapeXml(priceRate)}</RATE>
    </STANDARDPRICELIST.LIST>` : "";

    return [
      unit ? `<BASEUNITS>${escapeXml(unit)}</BASEUNITS>` : "",
      payload.parent ? `<PARENT>${escapeXml(payload.parent)}</PARENT>` : "",
      payload.category ? `<CATEGORY>${escapeXml(payload.category)}</CATEGORY>` : "",
      payload.description ? `<DESCRIPTION>${escapeXml(payload.description)}</DESCRIPTION>` : "",
      openBal ? `<OPENINGBALANCE>${escapeXml(openBal)}</OPENINGBALANCE>` : "",
      openVal ? `<OPENINGVALUE>${escapeXml(openVal)}</OPENINGVALUE>` : "",
      openRate ? `<OPENINGRATE>${escapeXml(openRate)}</OPENINGRATE>` : "",
      stdCost,
      stdPrice,
      batchAlloc,
    ].filter(Boolean).join("\n    ");
  }

  createStockItemXml(payload) {
    return this.masterXml("STOCKITEM", payload.name, "Create", this.stockItemBodyXml(payload));
  }

  alterStockItemXml(payload) {
    return this.masterXml("STOCKITEM", payload.name, "Alter", this.stockItemBodyXml(payload, { withDefaults: false }), payload.new_name, payload.company_name);
  }

  // Voucher identity for writes. Proven live: Tally resolves the import-side
  // REMOTEID — an id WE assigned at creation — but NOT the export GUID of a
  // UI-created voucher (Delete/Alter by export GUID always fail, Cancel posts
  // junk). Backend stamps payload.remote_id for website-created vouchers.
  // Never fall back to tally_guid: that is Tally's export GUID and Import
  // then no-ops (0 altered) or silently creates a duplicate.
  voucherRemoteId(payload) {
    const rid = typeof payload.remote_id === "string" ? payload.remote_id.trim() : "";
    if (!rid) return "";
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[0-9a-fA-F]{8}$/.test(rid)) {
      return "";
    }
    return rid;
  }

  // Opening tag for voucher Create imports. Carries our REMOTEID when the
  // backend stamped one so the voucher stays addressable for later
  // alter/delete/cancel.
  voucherCreateTag(voucherType, payload, extraAttrs = "") {
    const rid = typeof payload.remote_id === "string" ? payload.remote_id.trim() : "";
    const remoteId = rid ? ` REMOTEID="${escapeXml(rid)}"` : "";
    return `<VOUCHER${remoteId} VCHTYPE="${escapeXml(voucherType)}" ACTION="Create"${extraAttrs}>`;
  }

  // UNRESOLVED, CONFIRMED LIVE (2026-09-29): voucher identification for
  // Alter/Delete/Cancel is not reliable against real TallyPrime once more
  // than one voucher of the same type exists on the same date.
  //   - Plain DATE+VOUCHERTYPENAME+VOUCHERNUMBER: silently no-ops (0
  //     created/altered/deleted, no error) once ambiguous or unmatched.
  //   - REMOTEID (the exact GUID Tally's own export reports) and REMOTEID+
  //     VCHKEY (also export-confirmed): Delete correctly errors "Voucher
  //     does not exist!" rather than matching - Tally's import engine does
  //     not resolve its own export GUIDs back to the same object.
  //   - Worse: Alter/Cancel with an unresolved REMOTEID do NOT error at all
  //     - they silently CREATE A NEW VOUCHER instead (confirmed live twice:
  //     an "Alter" and a "Cancel" both returned CREATED:1 with a new
  //     LASTVCHID, leaving phantom duplicate vouchers in the real company).
  // Do not trust these three commands' targeting without re-verifying the
  // real result afterward (re-sync + check voucher count), and do not
  // widen their use until Tally's actual identification requirement here
  // is understood (likely needs vendor docs/support, not more guessing).
  voucherActionXml(payload, action, extraBody = "") {
    // TallyPrime's import treats ACTION="Alter" on a voucher it cannot match as "create it". Never send an
    // alter/delete/cancel that does not name its target, or a phantom voucher is posted to the books.
    const rid = this.voucherRemoteId(payload);
    if (!rid && !payload.voucher_number) {
      throw new Error(
        `Refusing to ${String(action).toLowerCase()} a voucher without remote_id, tally_guid or voucher_number: TallyPrime would create a new voucher instead of changing an existing one.`
      );
    }
    const remoteId = rid ? ` REMOTEID="${escapeXml(rid)}"` : "";
    const vchKey = payload.vch_key ? ` VCHKEY="${escapeXml(payload.vch_key)}"` : "";
    return tallyImportEnvelope(`
<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <VOUCHER${remoteId}${vchKey} VCHTYPE="${escapeXml(payload.voucher_type)}" ACTION="${escapeXml(action)}">
    <DATE>${escapeXml(tallyDate(payload.date))}</DATE>
    <VOUCHERTYPENAME>${escapeXml(payload.voucher_type)}</VOUCHERTYPENAME>
    ${payload.voucher_number ? `<VOUCHERNUMBER>${escapeXml(payload.voucher_number)}</VOUCHERNUMBER>` : ""}
    ${extraBody}
  </VOUCHER>
</TALLYMESSAGE>`, "Vouchers");
  }

  // Generate XML to delete a voucher via Import Data Vouchers envelope
  deleteVoucherXml(options = {}) {
    const companyName = options.companyName || options.company_name;
    const voucherType = options.voucherType || options.voucher_type;
    const voucherNumber = options.voucherNumber ?? options.voucher_number;
    const date = options.date || options.voucher_date;
    return tallyVoucherDeleteEnvelope({ companyName, voucherType, voucherNumber, date });
  }

  // Generate XML to cancel a voucher via documented TAGNAME="VoucherNumber" TAGVALUE envelope
  cancelVoucherXml(options = {}) {
    const companyName = options.companyName || options.company_name;
    const voucherType = options.voucherType || options.voucher_type;
    const voucherNumber = options.voucherNumber || options.voucher_number;
    const date = options.date;
    return tallyVoucherCancelEnvelope({ companyName, voucherType, voucherNumber, date });
  }

  // Generate XML to create a voucher via documented Vouchers Import envelope
  createTallyVoucherXml(options = {}) {
    const companyName = options.companyName || options.company_name;
    const voucherType = options.voucherType || options.voucher_type || "Sales";
    const partyLedger = options.partyLedger || options.party_ledger || options.party_name;
    const voucherNumber = options.voucherNumber ?? options.voucher_number;
    const date = options.date || options.voucher_date;
    const amount = options.amount;
    const bill = options.bill;
    return tallyVoucherCreateEnvelope({
      ...options,
      companyName,
      voucherType,
      voucherNumber,
      date,
      partyLedger,
      amount,
      bill,
    });
  }


  // ponytail: Alter only touches header fields (date/narration/reference) —
  // sending ledger/inventory lists on Alter would replace them wholesale.
  // Full-lines mode: when payload.lines carries the COMPLETE ledger set for
  // the voucher, resend it (due-date edits). The backend composes lines from
  // the mirror and refuses unsafe shapes (inventory, != 1 New Ref bill, != 2 lines).
  alterVoucherXml(payload) {
    const body = [
      payload.narration != null ? `<NARRATION>${escapeXml(payload.narration)}</NARRATION>` : "",
      payload.reference_number != null ? `<REFERENCE>${escapeXml(payload.reference_number)}</REFERENCE>` : "",
    ].filter(Boolean).join("\n          ");
    let extraBody = body;
    if (Array.isArray(payload.lines) && payload.lines.length > 0) {
      const linesXml = payload.lines.map((line) => {
        const signed = line.debit ? -Math.abs(Number(line.amount || 0)) : Math.abs(Number(line.amount || 0));
        const billsXml = Array.isArray(line.bills)
          ? line.bills.map((bill) => `
            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(bill.name)}</NAME>
              ${bill.type ? `<BILLTYPE>${escapeXml(bill.type)}</BILLTYPE>` : ""}
              ${billCreditPeriodTag(this.billCreditPeriod(bill, payload.new_date || payload.date), bill.type)}
              <AMOUNT>${escapeXml(bill.amount)}</AMOUNT>
            </BILLALLOCATIONS.LIST>`).join("")
          : "";
        return `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(line.ledger_name)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${line.debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
            <AMOUNT>${escapeXml(signed)}</AMOUNT>${billsXml}
          </ALLLEDGERENTRIES.LIST>`;
      }).join("");
      extraBody = `${body ? `${body}\n` : ""}${linesXml}`;
    }
    const companyName = payload.company_name || payload.companyName;
    const voucherNumber = payload.voucher_number;
    const voucherType = payload.voucher_type;
    const identDate = payload.date;
    // Same Import envelope as Delete/Cancel: DATE + voucher number, never the
    // export GUID as REMOTEID (that no-ops with 0 altered).
    if (companyName && voucherNumber && voucherType && identDate) {
      return tallyVoucherAlterEnvelope({
        companyName,
        voucherType,
        voucherNumber,
        date: identDate,
        newDate: payload.new_date,
        extraBody,
      });
    }
    return this.voucherActionXml(payload, "Alter", extraBody);
  }

  // Tally stores a bill's due date only as <BILLCREDITPERIOD> ("N Days" from the voucher date); <DUEDATE> is ignored.
  billCreditPeriod(bill, voucherDate) {
    return billCreditPeriodValue({ creditPeriod: bill.credit_period, dueDate: bill.due_date, voucherDate });
  }

  // Double entry per Tally voucher type. In import XML a negative AMOUNT with
  // ISDEEMEDPOSITIVE=Yes is a debit; positive with No is a credit.
  // Party is credited for Purchase / Credit Note / Receipt, debited otherwise
  // (Sales / Debit Note / Payment). Journal/Contra pass explicit dr/cr ledgers.
  // Optional extras mirror Tally's voucher screen: manual voucher number,
  // order reference (+date), bill allocation type (New/Agst Ref, Advance,
  // On Account), bank instrument (cheque/UTR) on the offset line, and one
  // inventory line (item/qty/rate/godown) for invoice vouchers.
  createVoucherXml(payload, fallbackType = "Sales") {
    const voucherType = payload.voucher_type || fallbackType;
    const vchTypeLower = String(voucherType).trim().toLowerCase();
    const offsetLower = String(payload.offset_ledger ?? "").trim().toLowerCase();

    // Normalizing item entries (if any)
    const rawItems = Array.isArray(payload.items) && payload.items.length > 0
      ? payload.items
      : payload.stock_item_name
        ? [{
            stock_item_name: payload.stock_item_name,
            quantity: payload.quantity,
            unit: payload.unit,
            rate: payload.rate,
            amount: payload.amount,
            godown_name: payload.godown_name,
            batch_name: payload.batch_name,
            discount_percent: payload.discount_percent,
          }]
        : [];

    const hasItems = rawItems.length > 0;
    const itemsTotal = rawItems.reduce((sum, item) => sum + (Number(item.amount) || (Number(item.quantity || 0) * Number(item.rate || 0))), 0);
    const amount = Math.abs(Number(payload.amount || itemsTotal || 0));

    // Outward / sales direction: moves stock out, debits customer/cash, credits revenue.
    // - Explicit sales vouchers: Sales, Debit Note, Delivery Note, Rejections Out
    // - Any voucher with inventory items where offset ledger is "Sales" (or sales account)
    // - Any Receipt voucher that has inventory items attached (Sales Receipt / Cash Sale)
    // Explicit types win: a Credit Note against "Sales Returns" is still inward.
    const explicitInward = ["purchase", "credit note", "receipt note", "rejections in"].includes(vchTypeLower);
    const isSalesType =
      ["sales", "delivery note", "rejections out", "debit note"].includes(vchTypeLower) ||
      (!explicitInward && hasItems && (offsetLower === "sales" || offsetLower.includes("sales") || vchTypeLower === "receipt"));

    const isPurchaseType = explicitInward || (hasItems && !isSalesType);

    const offsetLedger = String(payload.offset_ledger ?? "").trim();

    // Sales-direction: party debited, sales credited
    // Purchase-direction: purchase debited, party credited
    const partyIsCredit = ["purchase", "credit note", "receipt", "receipt note"].includes(vchTypeLower);
    const partyName = payload.party_name || payload.partyLedger || payload.party_ledger;
    const isDualType = ["journal", "contra"].includes(vchTypeLower);
    if (isDualType) {
      if (!String(payload.debit_ledger ?? "").trim() || !String(payload.credit_ledger ?? "").trim()) {
        throw new Error("Journal and Contra need debit and credit ledgers — voucher type is not a ledger.");
      }
    } else {
      if (!String(partyName ?? "").trim()) throw new Error("Party ledger is required.");
      requireOffsetLedger(voucherType, offsetLedger);
    }
    const debitLedger = payload.debit_ledger || (partyIsCredit ? offsetLedger : partyName);
    const creditLedger = payload.credit_ledger || (partyIsCredit ? partyName : offsetLedger);
    const partyLedger = partyName || (partyIsCredit ? creditLedger : debitLedger);

    const b = payload.bill && typeof payload.bill === "object" ? payload.bill : {};
    const defaultBillType = ["sales", "purchase"].includes(vchTypeLower) ? "New Ref" : "Agst Ref";
    const billRefType = payload.bill_type || b.billType || b.bill_type || defaultBillType;
    // Agst Ref must name a real open bill; inventing one would leave a stray bill on the party.
    const autoBillName = billRefType !== "Agst Ref" && partyLedger && amount
      ? `${voucherType.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-6)}`
      : "";
    const billNumber = payload.bill_number
      ? String(payload.bill_number).trim()
      : b.reference
        ? String(b.reference).trim()
        : b.name
          ? String(b.name).trim()
          : (typeof payload.bill === "string" && payload.bill.trim() ? payload.bill.trim() : null) || autoBillName;

    const rawDueDate = payload.due_date || payload.dueDate || b.dueDate || b.due_date;
    const rawCreditPeriod =
      payload.credit_period ||
      payload.creditPeriod ||
      b.creditPeriod ||
      b.credit_period ||
      (payload.credit_days != null && payload.credit_days !== "" ? `${payload.credit_days} Days` : payload.creditDays != null && payload.creditDays !== "" ? `${payload.creditDays} Days` : null);
    const creditPeriodStr = billCreditPeriodValue({ creditPeriod: rawCreditPeriod, dueDate: rawDueDate, voucherDate: payload.date });
    const creditTagInner = billCreditPeriodTag(creditPeriodStr, billRefType);
    const billCreditXml = creditTagInner ? `\n        ${creditTagInner}` : "";

    if (hasItems) {
      // Invoice Voucher Mode with ALLINVENTORYENTRIES.LIST
      // If Sales-type / Outward: party is positive (Yes) debit (-amount)
      // If Purchase-type / Inward: party is deemed positive No credit (amount)
      const partyIsPositive = isSalesType;
      const partySigned = partyIsPositive ? -amount : amount;

      const billXml = billNumber
        ? `
      <BILLALLOCATIONS.LIST>
        <NAME>${escapeXml(billNumber)}</NAME>
        <BILLTYPE>${escapeXml(billRefType)}</BILLTYPE>
        <AMOUNT>${escapeXml(partySigned.toFixed(2))}</AMOUNT>${billCreditXml}
      </BILLALLOCATIONS.LIST>`
        : "";

      const inventoryXml = rawItems.map((item) => {
        const itemQty = Number(item.quantity || 0);
        const itemUnit = item.unit || "Nos";
        const qtyStr = `${itemQty} ${itemUnit}`;
        const itemRate = Number(item.rate || 0);
        const rateStr = `${itemRate.toFixed(2)}/${itemUnit}`;
        const itemAmount = Number(item.amount) || (itemQty * itemRate);
        const godown = item.godown_name || "Main Location";
        const batch = item.batch_name || "Primary Batch";
        // In Sales / Outward: inventory deemed positive No (credit / stock deduction), amount positive
        // In Purchase / Inward: inventory deemed positive Yes (debit / stock addition), amount negative
        const invDeemed = isSalesType ? "No" : "Yes";
        const invSigned = isSalesType ? itemAmount.toFixed(2) : `-${itemAmount.toFixed(2)}`;

        return `
    <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>${escapeXml(item.stock_item_name)}</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>${invDeemed}</ISDEEMEDPOSITIVE>
      <RATE>${escapeXml(rateStr)}</RATE>
      <ACTUALQTY>${escapeXml(qtyStr)}</ACTUALQTY>
      <BILLEDQTY>${escapeXml(qtyStr)}</BILLEDQTY>
      <AMOUNT>${escapeXml(invSigned)}</AMOUNT>
      <ACCOUNTINGALLOCATIONS.LIST>
        <LEDGERNAME>${escapeXml(offsetLedger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${invDeemed}</ISDEEMEDPOSITIVE>
        <AMOUNT>${escapeXml(invSigned)}</AMOUNT>
      </ACCOUNTINGALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>${escapeXml(godown)}</GODOWNNAME>
        <BATCHNAME>${escapeXml(batch)}</BATCHNAME>
        <AMOUNT>${escapeXml(invSigned)}</AMOUNT>
        <ACTUALQTY>${escapeXml(qtyStr)}</ACTUALQTY>
        <BILLEDQTY>${escapeXml(qtyStr)}</BILLEDQTY>
      </BATCHALLOCATIONS.LIST>
    </ALLINVENTORYENTRIES.LIST>`;
      }).join("");

      return tallyImportEnvelope(`
<TALLYMESSAGE xmlns:UDF="TallyUDF">
  ${this.voucherCreateTag(voucherType, payload, ` OBJVIEW="Invoice Voucher View"`)}
    <DATE>${escapeXml(tallyDate(payload.date))}</DATE>
    <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>
    ${payload.voucher_number ? `<VOUCHERNUMBER>${escapeXml(payload.voucher_number)}</VOUCHERNUMBER>` : ""}
    <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
    <ISINVOICE>Yes</ISINVOICE>
    ${payload.reference_number ? `<REFERENCE>${escapeXml(payload.reference_number)}</REFERENCE>` : ""}
    ${payload.reference_date ? `<REFERENCEDATE>${escapeXml(tallyDate(payload.reference_date))}</REFERENCEDATE>` : ""}
    <NARRATION>${escapeXml(payload.narration || "")}</NARRATION>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>${partyIsPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
      <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
      <AMOUNT>${escapeXml(partySigned.toFixed(2))}</AMOUNT>${billXml}
    </LEDGERENTRIES.LIST>${inventoryXml}
  </VOUCHER>
</TALLYMESSAGE>`, "Vouchers");
    }

    // Standard Pure Accounting Entry Mode
    const line = (ledger, isDebit) => {
      const signed = isDebit ? -amount : amount;
      const isParty = ledger === partyLedger;
      // payload.bills splits one party line across several bills (e.g. a receipt settling oldest bills first).
      const bills = Array.isArray(payload.bills) && payload.bills.length > 0
        ? payload.bills.map((bill) => ({ name: bill.name, type: bill.type || billRefType, amount: Math.abs(Number(bill.amount)) * Math.sign(signed) }))
        : billNumber ? [{ name: billNumber, type: billRefType, amount: signed }] : [];
      const billXml = isParty
        ? bills.map((bill) => `
      <BILLALLOCATIONS.LIST>
        ${bill.type === "On Account" && !bill.name ? "" : `<NAME>${escapeXml(bill.name)}</NAME>`}
        <BILLTYPE>${escapeXml(bill.type)}</BILLTYPE>
        <AMOUNT>${escapeXml(bill.amount)}</AMOUNT>${bill.type === billRefType ? billCreditXml : ""}
      </BILLALLOCATIONS.LIST>`).join("")
        : "";
      const isOffsetLine = ledger === offsetLedger && ledger !== partyLedger;
      const bankXml = payload.payment_ref && isOffsetLine
        ? `
      <BANKALLOCATIONS.LIST>
        <INSTRUMENTNUMBER>${escapeXml(payload.payment_ref)}</INSTRUMENTNUMBER>
        <INSTRUMENTDATE>${escapeXml(tallyDate(payload.instrument_date || payload.date))}</INSTRUMENTDATE>
        <TRANSACTIONTYPE>Cheque/DD</TRANSACTIONTYPE>
      </BANKALLOCATIONS.LIST>`
        : "";
      return `
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(ledger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
      <AMOUNT>${escapeXml(signed)}</AMOUNT>${isParty ? "\n      <ISPARTYLEDGER>Yes</ISPARTYLEDGER>" : ""}${billXml}${bankXml}
    </ALLLEDGERENTRIES.LIST>`;
    };

    return tallyImportEnvelope(`
<TALLYMESSAGE xmlns:UDF="TallyUDF">
  ${this.voucherCreateTag(voucherType, payload)}
    <DATE>${escapeXml(tallyDate(payload.date))}</DATE>
    <EFFECTIVEDATE>${escapeXml(tallyDate(payload.effective_date || payload.date))}</EFFECTIVEDATE>
    <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>
    ${payload.voucher_number ? `<VOUCHERNUMBER>${escapeXml(payload.voucher_number)}</VOUCHERNUMBER>` : ""}
    <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
    ${payload.reference_number ? `<REFERENCE>${escapeXml(payload.reference_number)}</REFERENCE>` : ""}
    ${payload.reference_date ? `<REFERENCEDATE>${escapeXml(tallyDate(payload.reference_date))}</REFERENCEDATE>` : ""}
    <NARRATION>${escapeXml(payload.narration || "")}</NARRATION>${line(debitLedger, true)}${line(creditLedger, false)}
  </VOUCHER>
</TALLYMESSAGE>`, "Vouchers");
  }

  // Stock Journal: move quantity of one item from a source godown to a
  // destination godown (consumption OUT + production IN).
  stockJournalXml(payload) {
    const qty = `${payload.quantity} ${payload.unit}`;
    const rate = payload.rate != null && payload.rate !== "" ? Number(payload.rate) : null;
    const amount = rate != null ? (rate * Number(payload.quantity)).toFixed(2) : null;
    const entry = (listTag, godown) => `
    <${listTag}>
      <STOCKITEMNAME>${escapeXml(payload.stock_item_name)}</STOCKITEMNAME>
      <ACTUALQTY>${escapeXml(qty)}</ACTUALQTY>
      <BILLEDQTY>${escapeXml(qty)}</BILLEDQTY>
      ${rate != null ? `<RATE>${escapeXml(rate)}/${escapeXml(payload.unit)}</RATE>` : ""}
      ${amount != null ? `<AMOUNT>${escapeXml(amount)}</AMOUNT>` : ""}
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>${escapeXml(godown)}</GODOWNNAME>
        <BATCHNAME>Primary Batch</BATCHNAME>
        <ACTUALQTY>${escapeXml(qty)}</ACTUALQTY>
        <BILLEDQTY>${escapeXml(qty)}</BILLEDQTY>
        ${amount != null ? `<AMOUNT>${escapeXml(amount)}</AMOUNT>` : ""}
      </BATCHALLOCATIONS.LIST>
    </${listTag}>`;
    return tallyImportEnvelope(`
<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <VOUCHER VCHTYPE="Stock Journal" ACTION="Create">
    <DATE>${escapeXml(tallyDate(payload.date))}</DATE>
    <VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME>
    <NARRATION>${escapeXml(payload.narration || `Transfer ${payload.source_godown} → ${payload.dest_godown}`)}</NARRATION>${entry("INVENTORYENTRIESOUT.LIST", payload.source_godown)}${entry("INVENTORYENTRIESIN.LIST", payload.dest_godown)}
  </VOUCHER>
</TALLYMESSAGE>`, "Vouchers");
  }

  async postImport(xml, expectedAction, actionLabel = "CRM Import") {
    console.log(`\n==================== [CRM ACTION: ${actionLabel}] ====================`);
    console.log(`[CRM Action: ${actionLabel}] >>> XML OUTGOING TO TALLY:\n${xml}`);
    const response = await this.postXml(xml);
    console.log(`[CRM Action: ${actionLabel}] <<< XML INCOMING FROM TALLY:\n${response}`);
    try {
      const summary = assertImportOk(response, expectedAction);
      console.log(`[CRM Action: ${actionLabel}] Outcome:`, summary);
      console.log(`==================== [END CRM ACTION: ${actionLabel}] ====================\n`);
      return { ...summary, tally_response: response };
    } catch (err) {
      console.error(`[CRM Action: ${actionLabel}] Import assertion failed: ${err.message}`);
      console.log(`==================== [END CRM ACTION: ${actionLabel}] ====================\n`);
      // Keep the raw Tally response on the error so the backend stores it
      // with the FAILED result — LINEERROR alone rarely explains a mismatch.
      err.tally_response = String(response ?? "").slice(0, 4000);
      throw err;
    }
  }

  // True current company (Gateway of Tally selection), or null when it cannot
  // be determined. Never throws — callers fail open and let Tally answer.
  async currentCompanyRef() {
    try {
      const { company } = await this.currentCompany();
      if (company && (company.tally_guid || company.name)) return company;
    } catch {
      // fall through
    }
    try {
      const companies = await this.companies();
      if (companies.length) return companies[0];
    } catch {
      // fall through
    }
    return null;
  }

  // Writes land in whatever company is CURRENTLY open in TallyPrime — the
  // Import envelope carries no company scope. Refuse locally when the open
  // company is provably not the command's company instead of sending a doomed
  // import that fails with "Voucher does not exist!". Fails open whenever
  // either side is unknown (older queued commands, undetectable company).
  async assertWriteCompany(payload, label) {
    const wantGuid = typeof payload.company_guid === "string" ? payload.company_guid.trim() : "";
    const wantName = typeof payload.company_name === "string" ? payload.company_name.trim() : "";
    if (!wantGuid && !wantName) return;
    const current = await this.currentCompanyRef();
    if (!current) return;
    const sameGuid = Boolean(wantGuid && current.tally_guid && wantGuid === current.tally_guid);
    const sameName = Boolean(
      wantName && current.name && wantName.toLowerCase() === String(current.name).toLowerCase()
    );
    if (!sameGuid && !sameName) {
      throw new Error(
        `Open company "${wantName || wantGuid}" in TallyPrime — "${current.name || "another company"}" is currently open, so ${label} would land in the wrong books.`
      );
    }
  }
  // Fresh Day Book export for the command's company (falls back to the
  // current company for older payloads without company context).
  // Vouchers of one calendar day via the same Collection export sync uses. Unlike the Day Book (which only lists the
  // period TallyPrime has open and ignores the requested dates), this sees vouchers on any date.
  async voucherCollectionFor(payload) {
    const day = payload.date ? String(payload.date).slice(0, 10) : "";
    return this.postXml(vouchersListEnvelope(payload.company_name, /^d{4}-d{2}-d{2}$/.test(day) ? { from: day, to: day } : {}));
  }

  // The export every voucher lookup / read-back / "is it really gone" check runs against. It used to be the Day Book,
  // which only lists the period TallyPrime has open and ignores the dates we ask for: a voucher dated outside that
  // period looked absent, so deletes and cancels were reported as done (or refused) without ever being looked at.
  // The voucher Collection (what sync uses) lists every voucher of the company, with the same fields.
  async dayBookFor(payload) {
    try {
      const xml = await this.voucherCollectionFor(payload);
      this.lookupComplete = true;
      return xml;
    } catch (error) {
      this.lookupComplete = false;
      // Collection export unavailable on this Tally build: fall back to the Day Book (open period only).
      console.error("[TallyClient] voucher collection export failed, falling back to the Day Book:", error.message);
      return this.postXml(tallyExportEnvelope("Day Book", { staticVariables: dayBookVars(payload.company_name) }));
    }
  }

  // Locate a voucher block in a Day Book export: GUID first, then the
  // type+number+date natural key.
  findVoucherBlock(xml, identity) {
    const blocks = tagBlocks(xml, "VOUCHER");
    const rid = typeof identity.remote_id === "string" ? identity.remote_id.trim() : "";
    if (rid) {
      const byRid = blocks.find((b) => attrValue(b, "REMOTEID") === rid);
      if (byRid) return byRid;
    }
    const guid = typeof identity.tally_guid === "string" ? identity.tally_guid.trim() : "";
    if (guid) {
      const byGuid = blocks.find((b) => (firstTag(b, "GUID") || firstTag(b, "MASTERID") || attrValue(b, "REMOTEID")) === guid);
      if (byGuid) return byGuid;
    }
    const wantNumber = String(identity.voucher_number ?? "");
    const wantType = String(identity.voucher_type || "");
    const wantDate = identity.date ? String(identity.date).slice(0, 10) : "";
    if (!wantNumber || !wantType) return null;
    return (
      blocks.find(
        (b) =>
          (firstTag(b, "VOUCHERNUMBER") || "") === wantNumber &&
          (firstTag(b, "VOUCHERTYPENAME") || "").toLowerCase() === wantType.toLowerCase() &&
          (!wantDate || asDate(firstTag(b, "DATE")) === wantDate)
      ) || null
    );
  }

  // Tally reports DELETED=1 even when the import matched nothing (verified
  // live), so a counter check alone produces false successes. Confirm the
  // voucher is really gone from a fresh export before reporting SUCCESS.
  async deleteVoucherVerified(payload) {
    await this.assertWriteCompany(payload, `deleting ${payload.voucher_type || "voucher"} ${payload.voucher_number ?? ""}`.trim());
    const xml = await this.dayBookFor(payload);
    const existing = this.findVoucherBlock(xml, payload);
    if (!existing) {
      // Absent from the export that lists every voucher: it is gone (idempotent delete). Absent from the Day Book
      // fallback proves nothing - that only lists the open period - so refuse instead of claiming success.
      if (this.lookupComplete) {
        return { deleted: 1, created: 0, altered: 0, tally_response: "Voucher not present in TallyPrime (all dates checked): already deleted" };
      }
      throw voucherNotInDayBook("delete", payload);
    }

    // Refresh type/number from the live block, but NEVER invent remote_id:
    // the Day Book REMOTEID attribute is the export GUID, which Tally does
    // not resolve for writes (verified live) — only the backend-stamped
    // website remote_id is addressable. An absent remote_id means the backend
    // should have refused this command at queue time.
    const dayBookType = firstTag(existing, "VOUCHERTYPENAME");
    if (dayBookType) {
      payload.voucher_type = dayBookType;
    }
    const dayBookNum = firstTag(existing, "VOUCHERNUMBER");
    if (dayBookNum && !payload.voucher_number) {
      payload.voucher_number = dayBookNum;
    }
    let companyName = payload.company_name || payload.companyName;
    if (!companyName) {
      const current = await this.currentCompanyRef();
      if (current?.name) companyName = current.name;
    }

    const existingRid = attrValue(existing, "REMOTEID");
    const rid = (typeof payload.remote_id === "string" && payload.remote_id.trim())
      ? payload.remote_id.trim()
      : (existingRid && existingRid.trim())
        ? existingRid.trim()
        : (typeof payload.tally_guid === "string" && payload.tally_guid.trim())
          ? payload.tally_guid.trim()
          : (firstTag(existing, "GUID") || "").trim();

    const dayBookDate = firstTag(existing, "DATE");
    if (dayBookDate && !payload.date) {
      payload.date = dayBookDate;
    }
    const dayBookGuid = firstTag(existing, "GUID");
    const dayBookVchKey = attrValue(existing, "VCHKEY");
    const vchKey = payload.vch_key || payload.vchKey || dayBookVchKey || null;

    const idLabel = rid ? `, ID: ${rid}` : "";
    const vLabel = `${payload.voucher_type || "voucher"} ${payload.voucher_number ?? ""}`.trim();

    if (!companyName) {
      console.error(`[TallyClient:deleteVoucherVerified] Warning: companyName not provided or detected for ${vLabel}. payload=`, payload);
    }
    if (!rid && !dayBookNum && !payload.voucher_number && !vchKey) {
      console.error(`[TallyClient:deleteVoucherVerified] Warning: voucher ${vLabel} has no addressable REMOTEID/GUID or voucherNumber. payload=`, payload);
    }

    let result = null;
    let lastDeleteXml = "";
    try {
      const dayBookType = firstTag(existing, "VOUCHERTYPENAME");
      const resolvedType = payload.voucher_type || dayBookType;
      const resolvedNum = payload.voucher_number || dayBookNum;
      const resolvedDate = payload.date || dayBookDate;

      if (!resolvedType) {
        throw new Error("voucherType is required to delete voucher");
      }
      if (!resolvedNum) {
        throw new Error("voucherNumber is required to delete voucher");
      }
      if (!resolvedDate) {
        throw new Error("date is required to delete voucher");
      }

      console.log(`[TallyClient:deleteVoucherVerified] Target voucher:`, {
        companyName,
        voucherType: resolvedType,
        voucherNumber: resolvedNum,
        date: resolvedDate,
      });

      if (companyName) {
        lastDeleteXml = this.deleteVoucherXml({
          companyName,
          voucherType: resolvedType,
          voucherNumber: resolvedNum,
          date: resolvedDate,
        });
        console.log(`\n==================== [CRM ACTION: DELETE_VOUCHER] ====================`);
        console.log(`[CRM Action: DELETE_VOUCHER] Target: ${resolvedType} #${resolvedNum} (${resolvedDate}) in "${companyName}"`);
        console.log(`[CRM Action: DELETE_VOUCHER] >>> XML OUTGOING TO TALLY:\n${lastDeleteXml}`);
        const responseText = await this.postXml(lastDeleteXml);
        console.log(`[CRM Action: DELETE_VOUCHER] <<< XML INCOMING FROM TALLY:\n${responseText}`);
        if (responseText && responseText.toLowerCase().includes("<lineerror>")) {
          const lineError = firstTag(responseText, "LINEERROR") || "Tally rejected voucher deletion";
          console.error(
            `[TallyClient:deleteVoucherVerified] Delete rejected by Tally for ${vLabel}${idLabel} in "${companyName}":\nReason: ${lineError}\nRequest XML:\n${lastDeleteXml}\nResponse XML:\n${responseText}`
          );
          const err = new Error(`Tally rejected deletion: ${lineError} (Company: "${companyName}", RemoteID: "${rid}")`);
          err.tally_response = String(responseText).slice(0, 4000);
          console.log(`==================== [END CRM ACTION: DELETE_VOUCHER] ====================\n`);
          throw err;
        }
        console.log(`[CRM Action: DELETE_VOUCHER] Outcome: Success (DELETED=1)`);
        console.log(`==================== [END CRM ACTION: DELETE_VOUCHER] ====================\n`);
        result = { deleted: 1, created: 0, altered: 0, tally_response: responseText };
      } else {
        lastDeleteXml = this.voucherActionXml(payload, "Delete");
        result = await this.postImport(lastDeleteXml, "Delete", "DELETE_VOUCHER");
      }
    } catch (err) {
      const afterXml = await this.dayBookFor(payload);
      const stillPresent = this.findVoucherBlock(afterXml, payload);
      if (!stillPresent) {
        return { deleted: 1, created: 0, altered: 0, tally_response: err.tally_response || "" };
      }
      console.error(
        `[TallyClient:deleteVoucherVerified] Deletion failed for ${vLabel}${idLabel}: ${err.message}`,
        err.tally_response ? `\nRaw Tally response:\n${err.tally_response}` : ""
      );
      if (/does not exist|not found/i.test(err.message) || err.code === "TALLY_XML_DELETE_UNSUPPORTED" || err.code === "TALLY_VOUCHER_NOT_FOUND") {
        const unsupportedErr = new Error(
          "Voucher exists in TallyPrime but cannot be deleted using the XML import identifier available for this voucher."
        );
        unsupportedErr.code = "TALLY_XML_DELETE_UNSUPPORTED";
        unsupportedErr.requiresManualAction = true;
        unsupportedErr.requiresSync = false;
        unsupportedErr.tally_response = err.tally_response || "";
        unsupportedErr.voucher = {
          type: firstTag(stillPresent, "VOUCHERTYPENAME") || payload.voucher_type || "Payment",
          number: firstTag(stillPresent, "VOUCHERNUMBER") || payload.voucher_number || "",
          date: asDate(firstTag(stillPresent, "DATE")) || payload.date,
          masterId: firstTag(stillPresent, "MASTERID") || null,
          alterId: firstTag(stillPresent, "ALTERID") || null,
          remoteId: attrValue(stillPresent, "REMOTEID") || rid || null,
          vchKey: attrValue(stillPresent, "VCHKEY") || null,
        };
        throw unsupportedErr;
      }
      throw err;
    }
    const verifyXml = await this.dayBookFor(payload);
    const remaining = this.findVoucherBlock(verifyXml, payload);
    if (remaining) {
      const verifyMsg = "Voucher exists in TallyPrime but cannot be deleted using the XML import identifier available for this voucher.";
      console.error(
        `[TallyClient:deleteVoucherVerified] Post-delete verification failed for ${vLabel}${idLabel}:\nVoucher still present in Day Book for "${companyName || "active company"}".\nSent XML:\n${lastDeleteXml}\nTally response:\n${result?.tally_response || ""}`
      );
      const verifyErr = new Error(verifyMsg);
      verifyErr.code = "TALLY_XML_DELETE_UNSUPPORTED";
      verifyErr.requiresManualAction = true;
      verifyErr.requiresSync = false;
      verifyErr.tally_response = result?.tally_response;
      verifyErr.voucher = {
        type: firstTag(remaining, "VOUCHERTYPENAME") || payload.voucher_type || "Payment",
        number: firstTag(remaining, "VOUCHERNUMBER") || payload.voucher_number || "",
        date: asDate(firstTag(remaining, "DATE")) || payload.date,
        masterId: firstTag(remaining, "MASTERID") || null,
        alterId: firstTag(remaining, "ALTERID") || null,
        remoteId: attrValue(remaining, "REMOTEID") || rid || null,
        vchKey: attrValue(remaining, "VCHKEY") || null,
      };
      throw verifyErr;
    }
    return result;
  }

  // Cancel manifests as an alter (ALTERED=1, ISCANCELLED=Yes) on this Tally
  // build — the CANCELLED counter stays 0 even for genuine cancels (verified
  // live). Identifies the voucher using DATE + TAGNAME="VoucherNumber" TAGVALUE
  // which works for both XML-created and UI-created vouchers.
  async cancelVoucherVerified(payload) {
    await this.assertWriteCompany(payload, `cancelling ${payload.voucher_type || "voucher"} ${payload.voucher_number ?? ""}`.trim());
    const xml = await this.dayBookFor(payload);
    const existing = this.findVoucherBlock(xml, payload);
    if (!existing) {
      throw voucherNotInDayBook("cancel", payload);
    }
    if (firstTag(existing, "ISCANCELLED") === "Yes") {
      return { cancelled: 1, created: 0, altered: 0, tally_response: "Voucher already cancelled in Day Book" };
    }

    const dayBookType = firstTag(existing, "VOUCHERTYPENAME") || payload.voucher_type;
    const dayBookNum = firstTag(existing, "VOUCHERNUMBER") || payload.voucher_number;
    const dateRaw = firstTag(existing, "DATE") || payload.date;
    let companyName = payload.company_name || payload.companyName;
    if (!companyName) {
      const current = await this.currentCompanyRef();
      if (current?.name) companyName = current.name;
    }

    const vLabel = `${dayBookType || "voucher"} ${dayBookNum ?? ""}`.trim();
    let result = null;
    let cancelXml = "";

    try {
      if (companyName && dayBookType && dayBookNum && dateRaw) {
        cancelXml = this.cancelVoucherXml({
          companyName,
          voucherType: dayBookType,
          voucherNumber: dayBookNum,
          date: dateRaw,
        });
        console.log(`\n==================== [CRM ACTION: CANCEL_VOUCHER] ====================`);
        console.log(`[CRM Action: CANCEL_VOUCHER] Target: ${dayBookType} #${dayBookNum} (${dateRaw}) in "${companyName}"`);
        console.log(`[CRM Action: CANCEL_VOUCHER] >>> XML OUTGOING TO TALLY:\n${cancelXml}`);
        const responseText = await this.postXml(cancelXml);
        console.log(`[CRM Action: CANCEL_VOUCHER] <<< XML INCOMING FROM TALLY:\n${responseText}`);
        if (responseText && responseText.toLowerCase().includes("<lineerror>")) {
          const lineError = firstTag(responseText, "LINEERROR") || "Tally rejected voucher cancellation";
          console.error(
            `[TallyClient:cancelVoucherVerified] Cancel rejected by Tally for ${vLabel} in "${companyName}":\nReason: ${lineError}\nRequest XML:\n${cancelXml}\nResponse XML:\n${responseText}`
          );
          const err = new Error(`Tally rejected cancellation: ${lineError} (Company: "${companyName}", Voucher: "${dayBookType} ${dayBookNum}")`);
          err.tally_response = String(responseText).slice(0, 4000);
          console.log(`==================== [END CRM ACTION: CANCEL_VOUCHER] ====================\n`);
          throw err;
        }
        console.log(`[CRM Action: CANCEL_VOUCHER] Outcome: Success (ALTERED=1, ISCANCELLED=Yes)`);
        console.log(`==================== [END CRM ACTION: CANCEL_VOUCHER] ====================\n`);
        result = { cancelled: 1, created: 0, altered: 1, tally_response: responseText };
      } else {
        cancelXml = this.voucherActionXml(payload, "Cancel");
        result = await this.postImport(cancelXml, "Cancel", "CANCEL_VOUCHER");
      }
      if (result.created > 0) {
        throw new Error(
          "Tally did not cancel the voucher (it posted a new entry instead) — cancel it directly in TallyPrime (Day Book → select it → Alt+X) and sync."
        );
      }
    } catch (err) {
      const afterXml = await this.dayBookFor(payload);
      const block = this.findVoucherBlock(afterXml, payload);
      if (block && firstTag(block, "ISCANCELLED") === "Yes") {
        return { cancelled: 1, created: 0, altered: 1, tally_response: err.tally_response || "" };
      }
      console.error(
        `[TallyClient:cancelVoucherVerified] Cancellation failed for ${vLabel}: ${err.message}`,
        err.tally_response ? `\nRaw Tally response:\n${err.tally_response}` : ""
      );
      const cancelErr = new Error(
        `Voucher exists in TallyPrime (${vLabel}) but could not be cancelled: ${err.message}`
      );
      cancelErr.code = "TALLY_VOUCHER_CANCEL_FAILED";
      cancelErr.requiresManualAction = true;
      cancelErr.tally_response = err.tally_response || "";
      cancelErr.voucher = {
        type: dayBookType,
        number: dayBookNum,
        date: asDate(dateRaw),
        masterId: firstTag(existing, "MASTERID"),
        alterId: firstTag(existing, "ALTERID"),
        remoteId: attrValue(existing, "REMOTEID") || payload.remote_id || null,
        vchKey: attrValue(existing, "VCHKEY") || null,
      };
      throw cancelErr;
    }

    const verifyXml = await this.dayBookFor(payload);
    const block = this.findVoucherBlock(verifyXml, payload);
    if (!block || firstTag(block, "ISCANCELLED") !== "Yes") {
      const unconfirmedErr = new Error(
        `Tally did not cancel the voucher (${vLabel}) — verify in TallyPrime (Day Book → select it → Alt+X).`
      );
      unconfirmedErr.code = "TALLY_VOUCHER_CANCEL_FAILED";
      unconfirmedErr.requiresManualAction = true;
      unconfirmedErr.tally_response = result?.tally_response;
      unconfirmedErr.voucher = {
        type: dayBookType,
        number: dayBookNum,
        date: asDate(dateRaw),
        masterId: firstTag(block || existing, "MASTERID"),
        alterId: firstTag(block || existing, "ALTERID"),
        remoteId: attrValue(block || existing, "REMOTEID") || payload.remote_id || null,
        vchKey: attrValue(block || existing, "VCHKEY") || null,
      };
      throw unconfirmedErr;
    }
    return result;
  }

  // Alter by voucher number + date (same envelope as Delete/Cancel), then
  // read back the edited fields.
  async alterVoucherVerified(payload) {
    const hasLines = Array.isArray(payload.lines) && payload.lines.length > 0;
    if (!hasLines && (payload.due_date || payload.dueDate || payload.credit_period || payload.creditPeriod || payload.credit_days)) {
      throw new Error("A due-date edit needs the voucher's ledger lines — edit it from the voucher page or directly in TallyPrime.");
    }
    let companyName = payload.company_name || payload.companyName;
    if (!companyName) {
      const current = await this.currentCompanyRef();
      if (current?.name) companyName = current.name;
    }
    const xmlPayload = companyName ? { ...payload, company_name: companyName, companyName } : payload;
    const result = await this.postImport(this.alterVoucherXml(xmlPayload), undefined, "ALTER_VOUCHER");
    const xml = await this.dayBookFor(payload);
    const block = this.findVoucherBlock(xml, payload);
    if (!block) {
      // The import itself reported the edit applied (postImport throws otherwise), so a failed read-back is not a
      // failure of the edit: report it as applied but unverified.
      return { ...result, verified: false, note: "Edit applied, but the voucher could not be read back from TallyPrime to confirm it. Sync to refresh the list." };
    }
    const mismatch = [];
    if (payload.new_date && asDate(firstTag(block, "DATE")) !== String(payload.new_date).slice(0, 10)) {
      mismatch.push("date");
    }
    if (payload.narration != null && (firstTag(block, "NARRATION") || "") !== String(payload.narration)) {
      mismatch.push("narration");
    }
    if (
      payload.reference_number != null &&
      (firstTag(block, "REFERENCE") || firstTag(block, "REFERENCENUMBER") || "") !== String(payload.reference_number)
    ) {
      mismatch.push("reference");
    }
    const dueBill = hasLines ? payload.lines.flatMap((line) => line.bills || []).find((bill) => bill.type === "New Ref") : null;
    const expectedCredit = dueBill ? this.billCreditPeriod(dueBill, payload.new_date || payload.date) : null;
    if (/^\d+$/.test(expectedCredit || "") && (firstTag(block, "BILLCREDITPERIOD") || "").trim() !== `${expectedCredit} Days`) {
      mismatch.push("due date");
    }
    if (mismatch.length) {
      throw new Error(`Tally did not apply the edit (${mismatch.join(", ")} unchanged) — edit it directly in TallyPrime and sync.`);
    }
    return result;
  }

  // Locate a freshly created voucher in a Day Book export: our REMOTEID
  // first (Tally echoes it back), then type + date + amount + party.
  // Tally Educational Mode reports CREATED=1 even when nothing persists
  // (verified live), so presence here — not the counter — decides SUCCESS.
  findCreatedVoucher(xml, payload, voucherType) {
    if (payload.remote_id) {
      const byRid = this.findVoucherBlock(xml, { remote_id: payload.remote_id });
      if (byRid) return byRid;
    }
    const wantType = String(payload.voucher_type || voucherType || "");
    const wantDate = String(payload.date || "").slice(0, 10);
    const wantAmt = payload.amount == null || payload.amount === "" ? NaN : Math.abs(Number(payload.amount));
    const wantParty = payload.party_name ? String(payload.party_name).toLowerCase() : "";
    return (
      tagBlocks(xml, "VOUCHER").find((b) => {
        if (wantType && (firstTag(b, "VOUCHERTYPENAME") || "").toLowerCase() !== wantType.toLowerCase()) return false;
        if (wantDate && asDate(firstTag(b, "DATE")) !== wantDate) return false;
        if (Number.isFinite(wantAmt)) {
          const bAmt = numeric(firstTag(b, "AMOUNT"));
          if (bAmt == null || Math.abs(bAmt) !== wantAmt) return false;
        }
        if (wantParty) {
          const bp = firstTag(b, "PARTYLEDGERNAME") || firstTag(b, "PARTYNAME") || "";
          if (bp.toLowerCase() !== wantParty) return false;
        }
        return true;
      }) || null
    );
  }

  // Create with a read-back check: confirm the voucher is really in the Day
  // Book and hand its Tally identity back so the mirror adopts it instantly.
  async createVoucherVerified(payload, fallbackType) {
    const result = await this.postImport(
      this.createVoucherXml(payload, fallbackType),
      undefined,
      `CREATE_${String(fallbackType || "").toUpperCase()}`
    );
    if (!result.created) {
      throw new Error("Tally did not create the voucher (0 created) — check TallyPrime for a blocking dialog or date restriction and retry.");
    }
    const xml = await this.dayBookFor(payload);
    const block = this.findCreatedVoucher(xml, payload, fallbackType);
    if (!block) {
      throw new Error(
        "Tally reported the voucher created but it is not in the Day Book — check TallyPrime for a blocking dialog, date/period restriction, or confirm the right company is open, then sync."
      );
    }
    return {
      ...result,
      verified_guid: firstTag(block, "GUID") || null,
      verified_number: firstTag(block, "VOUCHERNUMBER") || null,
    };
  }

  // Human label for pre-flight mismatch errors.
  describeWrite(command, payload) {
    if (command.command_type === "DELETE_LEDGER") return `deleting ledger "${payload.name}"`;
    if (command.command_type === "ALTER_LEDGER") return `editing ledger "${payload.name}"`;
    if (command.command_type === "CREATE_LEDGER") return `creating ledger "${payload.name}"`;
    if (["DELETE_VOUCHER", "CANCEL_VOUCHER", "ALTER_VOUCHER"].includes(command.command_type)) {
      return `${command.command_type === "DELETE_VOUCHER" ? "deleting" : command.command_type === "CANCEL_VOUCHER" ? "cancelling" : "editing"} ${payload.voucher_type || "voucher"} ${payload.voucher_number ?? ""}`.trim();
    }
    return `applying ${command.command_type}`;
  }

  async executeCommand(command) {
    const payload = command.payload || command.payload_json || {};
    const isWrite = /^(CREATE_|ALTER_|DELETE_|CANCEL_|POST_)/.test(command.command_type);
    if (isWrite) {
      await this.assertWriteCompany(payload, this.describeWrite(command, payload));
    }
    if (command.command_type === "CREATE_LEDGER") return this.postImport(this.createLedgerXml(payload), undefined, "CREATE_LEDGER");
    if (command.command_type === "ALTER_LEDGER") return this.postImport(this.alterLedgerXml(payload), undefined, "ALTER_LEDGER");
    if (command.command_type === "DELETE_LEDGER") return this.postImport(this.masterXml("LEDGER", payload.name, "Delete", "", undefined, payload.company_name), "Delete", "DELETE_LEDGER");
    if (command.command_type === "CREATE_UNIT") return this.postImport(this.createUnitXml(payload), undefined, "CREATE_UNIT");
    if (command.command_type === "ALTER_UNIT") return this.postImport(this.alterUnitXml(payload), undefined, "ALTER_UNIT");
    if (command.command_type === "DELETE_UNIT") return this.postImport(this.deleteUnitXml(payload), "Delete", "DELETE_UNIT");
    if (command.command_type === "CREATE_STOCK_ITEM") return this.postImport(this.createStockItemXml(payload), undefined, "CREATE_STOCK_ITEM");
    if (command.command_type === "ALTER_STOCK_ITEM") return this.postImport(this.alterStockItemXml(payload), undefined, "ALTER_STOCK_ITEM");
    if (command.command_type === "DELETE_STOCK_ITEM") return this.postImport(this.masterXml("STOCKITEM", payload.name, "Delete", "", undefined, payload.company_name), "Delete", "DELETE_STOCK_ITEM");
    if (command.command_type === "CREATE_GODOWN") return this.postImport(this.createGodownXml(payload), undefined, "CREATE_GODOWN");
    if (command.command_type === "ALTER_GODOWN") return this.postImport(this.alterGodownXml(payload), undefined, "ALTER_GODOWN");
    if (command.command_type === "DELETE_GODOWN") return this.postImport(this.deleteGodownXml(payload), "Delete", "DELETE_GODOWN");
    if (command.command_type === "ALTER_VOUCHER") return this.alterVoucherVerified(payload);
    if (command.command_type === "DELETE_VOUCHER") return this.deleteVoucherVerified(payload);
    if (command.command_type === "DELETE_TALLY_VOUCHER") return this.deleteTallyVoucher(payload);
    if (command.command_type === "CANCEL_VOUCHER") return this.cancelVoucherVerified(payload);
    if (command.command_type === "CANCEL_TALLY_VOUCHER") return this.cancelTallyVoucher(payload);
    if (command.command_type === "CREATE_STOCK_JOURNAL") return this.postImport(this.stockJournalXml(payload), undefined, "CREATE_STOCK_JOURNAL");
    if (command.command_type === "CREATE_TALLY_VOUCHER") return this.createTallyVoucher(payload);
    if (["CREATE_VOUCHER", "CREATE_PAYMENT", "CREATE_RECEIPT", "POST_PAYMENT_RECEIPT"].includes(command.command_type)) {
      const fallbackType = command.command_type === "CREATE_PAYMENT" ? "Payment" : command.command_type === "CREATE_RECEIPT" || command.command_type === "POST_PAYMENT_RECEIPT" ? "Receipt" : "Sales";
      return this.postImport(this.createVoucherXml(payload, fallbackType), undefined, command.command_type);
    }
    if (command.command_type === "GET_TALLY_STATUS") return this.detect();
    if (command.command_type === "QUERY_CURRENT_COMPANY") return this.currentCompany();
    if (command.command_type === "QUERY_LICENSE_INFO") return this.licenseInfo();
    if (command.command_type === "QUERY_GROUPS") return this.queryGroupsRaw(payload.company_name);
    if (command.command_type === "QUERY_STOCK_ITEMS") return this.queryStockItems(payload.company_name);
    if (command.command_type === "QUERY_VOUCHERS_BY_TYPE") return this.vouchersByType(payload);
    if (command.command_type === "QUERY_RECEIVABLES") return { tally_response: await this.postXml(tallyExportEnvelope("Bills Receivable", { staticVariables: companyVars(payload.company_name) })) };
    if (command.command_type === "QUERY_LEDGER_VOUCHERS") return this.ledgerVouchers(payload);
    if (command.command_type === "QUERY_VOUCHER") return this.queryVoucher(payload);
    throw new Error(`Unsupported command ${command.command_type}`);
  }

  deleteTallyVoucher(payload = {}) {
    return deleteTallyVoucher({
      ...payload,
      tallyUrl: this.endpoint(),
    });
  }

  cancelTallyVoucher(payload = {}) {
    return cancelTallyVoucher({
      ...payload,
      tallyUrl: this.endpoint(),
    });
  }

  createTallyVoucher(payload = {}) {
    return createTallyVoucher({
      ...payload,
      tallyUrl: this.endpoint(),
    });
  }
}

const DEFAULT_TALLY_URL = "http://127.0.0.1:9000";

async function deleteTallyVoucher({
  companyName,
  voucherType,
  voucher_type,
  voucherNumber,
  voucher_number,
  date,
  voucher_date,
  tallyUrl = DEFAULT_TALLY_URL,
} = {}) {
  const vType = voucherType || voucher_type;
  const vNum = voucherNumber != null && String(voucherNumber).trim() !== "" ? String(voucherNumber).trim() : (voucher_number != null && String(voucher_number).trim() !== "" ? String(voucher_number).trim() : null);
  const vDate = date || voucher_date;

  console.log("[deleteTallyVoucher] Target voucher:", {
    companyName,
    voucherType: vType,
    voucherNumber: vNum,
    date: vDate,
  });

  if (!companyName) {
    const err = new Error("companyName is required");
    console.error("[deleteTallyVoucher] Failed: companyName is required");
    throw err;
  }
  if (!vType) {
    const err = new Error("voucherType is required");
    console.error("[deleteTallyVoucher] Failed: voucherType is required");
    throw err;
  }
  if (!vNum) {
    const err = new Error("voucherNumber is required");
    console.error("[deleteTallyVoucher] Failed: voucherNumber is required");
    throw err;
  }
  if (!vDate) {
    const err = new Error("date is required");
    console.error("[deleteTallyVoucher] Failed: date is required");
    throw err;
  }

  const xml = tallyVoucherDeleteEnvelope({ companyName, voucherType: vType, voucherNumber: vNum, date: vDate });
  console.log(`[deleteTallyVoucher] >>> XML OUTGOING TO TALLY:\n${xml}`);
  let response;
  try {
    response = await fetch(tallyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml;charset=utf-8",
      },
      body: xml,
    });
  } catch (netErr) {
    console.error(`[deleteTallyVoucher] Network failure contacting Tally at ${tallyUrl}:`, netErr.message);
    throw netErr;
  }

  if (!response.ok) {
    const httpErr = new Error(`Tally HTTP error: ${response.status} ${response.statusText}`);
    console.error(`[deleteTallyVoucher] HTTP request rejected by Tally (${tallyUrl}):`, httpErr.message);
    throw httpErr;
  }

  const responseText = await response.text();
  console.log(`[deleteTallyVoucher] <<< XML INCOMING FROM TALLY:\n${responseText}`);
  const lineError = firstTag(responseText, "LINEERROR");
  if (lineError) {
    console.error(
      `[deleteTallyVoucher] Tally returned <LINEERROR>: ${lineError}\nCompany: ${companyName}\nVoucherType: ${vType}\nVoucherNumber: ${vNum}\nResponse: ${responseText}`
    );
    const isNotFound = /does not exist|not found/i.test(lineError);
    return {
      success: false,
      code: isNotFound ? "TALLY_VOUCHER_NOT_FOUND" : "TALLY_DELETE_REJECTED",
      message: lineError,
      voucher: {
        type: vType,
        number: vNum,
        date: vDate,
      },
      response: responseText,
    };
  }

  const deleted = Number(firstTag(responseText, "DELETED") || 0);
  const errors = Number(firstTag(responseText, "ERRORS") || 0);
  if (errors > 0 || (deleted === 0 && responseText.includes("<DELETED>"))) {
    return {
      success: false,
      code: "TALLY_VOUCHER_DELETE_FAILED",
      message: "Tally import did not delete voucher",
      voucher: {
        type: vType,
        number: vNum,
        date: vDate,
      },
      response: responseText,
    };
  }

  return {
    success: true,
    code: "TALLY_VOUCHER_DELETED",
    deleted: deleted || 1,
    message: "Voucher deleted successfully from TallyPrime.",
    voucher: {
      type: vType,
      number: vNum,
      date: vDate,
    },
    response: responseText,
  };
}

async function cancelTallyVoucher({
  companyName,
  voucherType,
  voucher_type,
  voucherNumber,
  voucher_number,
  date,
  voucher_date,
  tallyUrl = DEFAULT_TALLY_URL,
} = {}) {
  const vType = voucherType || voucher_type;
  const vNum = voucherNumber != null && String(voucherNumber).trim() !== "" ? String(voucherNumber).trim() : (voucher_number != null && String(voucher_number).trim() !== "" ? String(voucher_number).trim() : null);
  const vDate = date || voucher_date;

  console.log("[cancelTallyVoucher] Target voucher:", {
    companyName,
    voucherType: vType,
    voucherNumber: vNum,
    date: vDate,
  });

  if (!companyName) throw new Error("companyName is required");
  if (!vType) throw new Error("voucherType is required");
  if (!vNum) throw new Error("voucherNumber is required");
  if (!vDate) throw new Error("date is required");

  const xml = tallyVoucherCancelEnvelope({ companyName, voucherType: vType, voucherNumber: vNum, date: vDate });
  console.log(`[cancelTallyVoucher] >>> XML OUTGOING TO TALLY:\n${xml}`);
  let response;
  try {
    response = await fetch(tallyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml;charset=utf-8",
      },
      body: xml,
    });
  } catch (netErr) {
    console.error(`[cancelTallyVoucher] Network failure contacting Tally at ${tallyUrl}:`, netErr.message);
    throw netErr;
  }

  if (!response.ok) {
    const httpErr = new Error(`Tally HTTP error: ${response.status} ${response.statusText}`);
    console.error(`[cancelTallyVoucher] HTTP request rejected by Tally (${tallyUrl}):`, httpErr.message);
    throw httpErr;
  }

  const responseText = await response.text();
  console.log(`[cancelTallyVoucher] <<< XML INCOMING FROM TALLY:\n${responseText}`);
  const lineError = firstTag(responseText, "LINEERROR");
  if (lineError) {
    console.error(
      `[cancelTallyVoucher] Tally returned <LINEERROR>: ${lineError}\nCompany: ${companyName}\nVoucherType: ${voucherType}\nVoucherNumber: ${voucherNumber}\nResponse: ${responseText}`
    );
    return {
      success: false,
      code: "TALLY_VOUCHER_CANCEL_FAILED",
      message: lineError,
      voucher: {
        type: voucherType,
        number: voucherNumber,
        date,
      },
      rawResponse: responseText,
    };
  }

  return {
    success: true,
    code: "TALLY_VOUCHER_CANCELLED",
    message: "Voucher cancellation request accepted by TallyPrime.",
    voucher: {
      type: voucherType,
      number: voucherNumber,
      date,
    },
    rawResponse: responseText,
  };
}

async function createTallyVoucher({
  companyName,
  voucherType = "Sales",
  voucherNumber,
  date,
  partyLedger,
  party_name,
  amount = 0,
  bill,
  dueDate,
  due_date,
  creditPeriod,
  credit_period,
  creditDays,
  credit_days,
  offsetLedger,
  offset_ledger,
  narration,
  isInvoice,
  reference,
  referenceDate,
  remoteId,
  remote_id,
  tallyUrl = DEFAULT_TALLY_URL,
} = {}) {
  if (!companyName) {
    console.error("[createTallyVoucher] Failed: companyName is required");
    throw new Error("companyName is required");
  }
  const party = partyLedger || party_name;
  if (!party) {
    console.error("[createTallyVoucher] Failed: partyLedger is required");
    throw new Error("partyLedger is required");
  }

  const xml = tallyVoucherCreateEnvelope({
    companyName,
    voucherType,
    voucherNumber,
    date,
    partyLedger: party,
    amount,
    bill,
    dueDate,
    due_date,
    creditPeriod,
    credit_period,
    creditDays,
    credit_days,
    offsetLedger,
    offset_ledger,
    narration,
    isInvoice,
    reference,
    referenceDate,
    remoteId,
    remote_id,
  });

  console.log(`[createTallyVoucher] >>> XML OUTGOING TO TALLY:\n${xml}`);
  let response;
  try {
    response = await fetch(tallyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml;charset=utf-8",
      },
      body: xml,
    });
  } catch (netErr) {
    console.error(`[createTallyVoucher] Network failure contacting Tally at ${tallyUrl}:`, netErr.message);
    throw netErr;
  }

  if (!response.ok) {
    const httpErr = new Error(`Tally HTTP error: ${response.status} ${response.statusText}`);
    console.error(`[createTallyVoucher] HTTP request rejected by Tally (${tallyUrl}):`, httpErr.message);
    throw httpErr;
  }

  const responseText = await response.text();
  console.log(`[createTallyVoucher] <<< XML INCOMING FROM TALLY:\n${responseText}`);

  const lineError = firstTag(responseText, "LINEERROR");
  if (lineError) {
    console.error(
      `[createTallyVoucher] Tally returned <LINEERROR>: ${lineError}\nCompany: ${companyName}\nVoucherType: ${voucherType}\nVoucherNumber: ${voucherNumber}\nResponse: ${responseText}`
    );
    return {
      success: false,
      code: "TALLY_VOUCHER_CREATE_FAILED",
      message: lineError,
      voucher: {
        type: voucherType,
        number: voucherNumber,
        date,
      },
      rawResponse: responseText,
    };
  }

  const created = Number(firstTag(responseText, "CREATED") || 0);
  const errors = Number(firstTag(responseText, "ERRORS") || 0);
  if (errors > 0 || (created === 0 && responseText.includes("<CREATED>"))) {
    return {
      success: false,
      code: "TALLY_VOUCHER_CREATE_FAILED",
      message: "Tally import did not create voucher",
      voucher: {
        type: voucherType,
        number: voucherNumber,
        date,
      },
      rawResponse: responseText,
    };
  }

  return {
    success: true,
    code: "TALLY_VOUCHER_CREATED",
    created: created || 1,
    message: "Voucher created successfully in TallyPrime.",
    voucher: {
      type: voucherType,
      number: voucherNumber,
      date,
      amount,
      partyLedger: party,
    },
    rawResponse: responseText,
  };
}

module.exports = {
  TallyClient,
  TALLY_HTTP_TIMEOUT_MS,
  TALLY_PROBE_TIMEOUT_MS,
  ledgerMailingDetailsXml,
  parseLedgerMailing,
  financialYearStartYmd,
  classifyTallyError,
  createTallyVoucher,
  deleteTallyVoucher,
  cancelTallyVoucher,
  tallyUnitEnvelope,
  unitsExportEnvelope,
  vouchersListEnvelope,
  VOUCHER_COLLECTION_FETCH,
};
