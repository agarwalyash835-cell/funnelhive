function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripCdata(value) {
  return String(value ?? "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Decodes the text of a Tally XML field.
 *  - Single pass, so "&amp;lt;" becomes the literal text "&lt;" (sequential replaceAll decoded it twice, to "<").
 *  - Numeric character references (&#4;, &#38;, &#x26;, &#13;&#10;) are decoded. Tally exports its root group as
 *    U+0004 + " Primary", i.e. "&#4; Primary"; leaving the reference raw is what showed up in tally_godown_list.
 *  - C0 control characters (U+0000-U+001F except tab/newline/CR) and DEL are dropped: they are never meaningful in master
 *    data and break display, JSON and search. So "&#4; Primary" -> "Primary".
 */
function decodeXml(value) {
  return stripCdata(value)
    .replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
      if (entity[0] !== "#") return NAMED_ENTITIES[entity];
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isInteger(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return String.fromCodePoint(code);
    })
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function firstTag(xml, tag) {
  const match = String(xml ?? "").match(new RegExp(`<${tag}(?=[\\s>])(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function tagBlocks(xml, tag) {
  return [...String(xml ?? "").matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"))].map((m) => m[0]);
}

function staticVariablesXml(staticVariables = {}) {
  const entries = Object.entries(staticVariables).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return "<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>";
  return `<STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${entries.map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join("\n        ")}
      </STATICVARIABLES>`;
}

function tallyExportEnvelope(reportName, options = {}) {
  const request = options.request || "Export";
  const type = options.type || "Data";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>${escapeXml(request)}</TALLYREQUEST>
    <TYPE>${escapeXml(type)}</TYPE>
    <ID>${escapeXml(reportName)}</ID>
  </HEADER>
  <BODY>
    <DESC>
      ${staticVariablesXml(options.staticVariables)}
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// reportName must be "Vouchers" for voucher creates/alters/deletes/cancels
// (including Stock Journal) - Tally silently misinterprets voucher XML sent
// under "All Masters" and raises unrelated validation errors (e.g. "Voucher
// date is missing") instead of the real cause.
//
// staticVariables (e.g. { SVCURRENTCOMPANY: "..." }) targets the write at a
// specific company rather than whatever happens to be active in the desktop
// TallyPrime UI - without it, a master looked up by plain name (no GUID) can
// silently hit the wrong company if two companies share that name.
function tallyImportEnvelope(tallyMessageXml, reportName = "All Masters", staticVariables) {
  const svEntries = staticVariables
    ? Object.entries(staticVariables).filter(([, v]) => v != null && v !== "")
    : [];
  const svBlock = svEntries.length
    ? `\n        <STATICVARIABLES>\n          ${svEntries.map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join("\n          ")}\n        </STATICVARIABLES>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>${svBlock}
      </REQUESTDESC>
      <REQUESTDATA>
        ${tallyMessageXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function localTallyToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function warnIfEducationalUnsafeDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const last = lastDayOfMonth(y, m);
  if (d !== 1 && d !== 2 && d !== last) {
    console.warn(`[tally] Educational Mode typically allows only 1st, 2nd or last day of month; sending ${yyyymmdd} unchanged`);
  }
}

function parseTallyDate(value) {
  if (!value) return localTallyToday();
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  const s = String(value).trim();
  if (/^\d{8}$/.test(s)) return s;

  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}${ymd[2].padStart(2, "0")}${ymd[3].padStart(2, "0")}`;
  }

  // D-Mon-YY / D-Mon-YYYY (Tally outstanding and bill-credit exports)
  const mon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (mon) {
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const mm = months[String(mon[2]).toLowerCase()];
    if (mm) {
      let year = String(mon[3]);
      if (year.length === 2) year = (Number(year) >= 70 ? "19" : "20") + year;
      return `${year}${mm}${String(mon[1]).padStart(2, "0")}`;
    }
  }

  // DD-MM-YYYY or MM/DD/YYYY — if the middle number is > 12 it cannot be a month (09/30/2026).
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    if (b > 12 && a <= 12) {
      return `${dmy[3]}${String(a).padStart(2, "0")}${String(b).padStart(2, "0")}`;
    }
    return `${dmy[3]}${String(b).padStart(2, "0")}${String(a).padStart(2, "0")}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  return s.replaceAll("-", "").replaceAll("/", "").slice(0, 8);
}

function tallyDateToIso(value) {
  const yyyymmdd = /^\d{8}$/.test(String(value ?? "")) ? String(value) : parseTallyDate(value);
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function normalizeCreditPeriod(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return `${s} Days`;
  return s;
}

function tallyBillCreditDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = String(Number(yyyymmdd.slice(6, 8)));
  const mon = months[Number(yyyymmdd.slice(4, 6)) - 1];
  if (!mon) return yyyymmdd;
  return `${d}-${mon}-${yyyymmdd.slice(2, 4)}`;
}

/** Value for <BILLCREDITPERIOD>: explicit "N Days", else due date as days (Tally applies this) or D-Mon-YY if due is before the voucher date. */
function billCreditPeriodValue({ creditPeriod, dueDate, voucherDate } = {}) {
  const explicit = normalizeCreditPeriod(creditPeriod);
  if (explicit) return explicit;
  if (dueDate == null || dueDate === "") return null;
  const due = parseTallyDate(dueDate);
  warnIfEducationalUnsafeDate(due);
  if (voucherDate) {
    const vch = parseTallyDate(voucherDate);
    if (/^\d{8}$/.test(due) && /^\d{8}$/.test(vch)) {
      const days = Math.round(
        (Date.UTC(+due.slice(0, 4), +due.slice(4, 6) - 1, +due.slice(6, 8)) -
          Date.UTC(+vch.slice(0, 4), +vch.slice(4, 6) - 1, +vch.slice(6, 8))) /
          86400000
      );
      if (days >= 0) return `${days}`;
    }
  }
  return tallyBillCreditDate(due);
}

function billCreditPeriodTag(value, billType) {
  if (!value || String(billType) !== "New Ref") return "";
  // Only a bare day count gets the "Days" suffix. An explicit "30 Days" used to become "30 Days Days" and a date
  // ("1-Sep-26") "1-Sep-26 Days", which TallyPrime reads as a different credit period.
  const text = String(value).trim();
  const shown = /^\d+$/.test(text) ? `${text} Days` : text;
  return `<BILLCREDITPERIOD JOINED="Yes">${escapeXml(shown)}</BILLCREDITPERIOD>`;
}

/** ISO due date from a Tally BILLCREDITPERIOD (date or "N Days") plus optional voucher date. */
function dueFromCreditPeriod(creditPeriod, voucherDate) {
  if (creditPeriod == null || creditPeriod === "") return null;
  const s = String(creditPeriod).trim();
  const daysMatch = s.match(/^(\d+)\s*Days?$/i) || (/^\d{1,4}$/.test(s) ? s.match(/^(\d+)$/) : null);
  if (daysMatch) {
    if (!voucherDate) return null;
    const base = parseTallyDate(voucherDate);
    if (!/^\d{8}$/.test(base)) return null;
    const due = new Date(Date.UTC(+base.slice(0, 4), +base.slice(4, 6) - 1, +base.slice(6, 8)) + Number(daysMatch[1]) * 86400000);
    const y = due.getUTCFullYear();
    const m = String(due.getUTCMonth() + 1).padStart(2, "0");
    const d = String(due.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return tallyDateToIso(s);
}

function tallyVoucherDeleteEnvelope({
  companyName,
  voucherType,
  voucherNumber,
  date,
} = {}) {
  if (!companyName) {
    throw new Error("companyName is required");
  }
  if (!voucherType) {
    throw new Error("voucherType is required");
  }
  if (!voucherNumber) {
    throw new Error("voucherNumber is required");
  }
  if (!date) {
    throw new Error("date is required");
  }

  const tallyDate = parseTallyDate(date);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER
          DATE="${escapeXml(tallyDate)}"
          TAGNAME="Voucher Number"
          TAGVALUE="${escapeXml(voucherNumber)}"
          VCHTYPE="${escapeXml(voucherType)}"
          ACTION="Delete">
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function tallyVoucherAlterEnvelope({
  companyName,
  voucherType,
  voucherNumber,
  date,
  newDate,
  extraBody = "",
} = {}) {
  if (!companyName) throw new Error("companyName is required");
  if (!voucherType) throw new Error("voucherType is required");
  if (!voucherNumber) throw new Error("voucherNumber is required");
  if (!date) throw new Error("date is required");

  const identDate = parseTallyDate(date);
  const innerDate = parseTallyDate(newDate || date);
  const body = String(extraBody || "").trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER
          DATE="${escapeXml(identDate)}"
          TAGNAME="Voucher Number"
          TAGVALUE="${escapeXml(voucherNumber)}"
          ACTION="Alter"
          VCHTYPE="${escapeXml(voucherType)}">
          <DATE>${escapeXml(innerDate)}</DATE>
          <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(voucherNumber)}</VOUCHERNUMBER>
          ${body}
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function tallyVoucherCancelEnvelope({ companyName, voucherType, voucherNumber, date } = {}) {
  if (!companyName) {
    throw new Error("companyName is required");
  }
  if (!voucherType) {
    throw new Error("voucherType is required");
  }
  if (!voucherNumber) {
    throw new Error("voucherNumber is required");
  }
  if (!date) {
    throw new Error("date is required");
  }

  const tallyDate = parseTallyDate(date);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER
          DATE="${escapeXml(tallyDate)}"
          TAGNAME="Voucher Number"
          TAGVALUE="${escapeXml(voucherNumber)}"
          ACTION="Cancel"
          VCHTYPE="${escapeXml(voucherType)}">
          <DATE>${escapeXml(tallyDate)}</DATE>
          <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(voucherNumber)}</VOUCHERNUMBER>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function requireOffsetLedger(voucherType, value) {
  const offset = String(value ?? "").trim();
  if (!offset) {
    throw new Error(`Pick an offset ledger. "${voucherType || "This"}" is a voucher type, not a ledger.`);
  }
  return offset;
}

function tallyVoucherCreateEnvelope({
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
  persistedView,
  objView,
  reference,
  referenceDate,
  remoteId,
  remote_id,
  hasItems = false,
} = {}) {
  const comp = companyName || "";
  if (!comp) {
    throw new Error("companyName is required");
  }
  const party = partyLedger || party_name;
  if (!party) {
    throw new Error("partyLedger is required");
  }

  const vchType = voucherType || "Sales";
  const vchTypeLower = String(vchType).trim().toLowerCase();
  const isSalesType = ["sales", "delivery note", "rejections out", "debit note"].includes(vchTypeLower);
  const isPurchaseType = ["purchase", "credit note", "receipt note", "rejections in"].includes(vchTypeLower);

  const numAmount = Math.abs(Number(amount || 0));
  const partyIsPositive = isSalesType;
  const partySignedStr = partyIsPositive ? `-${numAmount.toFixed(2)}` : numAmount.toFixed(2);
  const offsetSignedStr = partyIsPositive ? numAmount.toFixed(2) : `-${numAmount.toFixed(2)}`;

  const offset = requireOffsetLedger(vchType, offsetLedger || offset_ledger);

  const tallyDateStr = parseTallyDate(date);
  const vNum = voucherNumber != null && String(voucherNumber).trim() !== "" ? String(voucherNumber).trim() : null;

  const invoiceMode = isInvoice !== undefined ? Boolean(isInvoice) : (isSalesType || isPurchaseType);
  const defaultView = hasItems ? "Invoice Voucher View" : "Accounting Invoice Voucher View";
  const viewName = persistedView || objView || (invoiceMode ? defaultView : null);

  const b = bill && typeof bill === "object" ? bill : {};
  const billName =
    b.reference ||
    b.name ||
    (typeof bill === "string" && bill.trim() ? bill.trim() : null) ||
    vNum ||
    (party && numAmount ? `${vchType.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-6)}` : "");

  const billType = b.billType || b.bill_type || (["sales", "purchase"].includes(vchTypeLower) ? "New Ref" : "Agst Ref");

  const rawDueDate = b.dueDate || b.due_date || dueDate || due_date;
  const rawCreditPeriod =
    b.creditPeriod ||
    b.credit_period ||
    creditPeriod ||
    credit_period ||
    (creditDays != null && creditDays !== "" ? `${creditDays} Days` : credit_days != null && credit_days !== "" ? `${credit_days} Days` : null);
  const creditPeriodStr = billCreditPeriodValue({ creditPeriod: rawCreditPeriod, dueDate: rawDueDate, voucherDate: date });

  let billAllocationsXml = "";
  if (billName) {
    const creditTagInner = billCreditPeriodTag(creditPeriodStr, billType);
    const creditTag = creditTagInner ? `\n              ${creditTagInner}` : "";
    billAllocationsXml = `
            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(billName)}</NAME>
              <BILLTYPE>${escapeXml(billType)}</BILLTYPE>
              <AMOUNT>${escapeXml(partySignedStr)}</AMOUNT>${creditTag}
            </BILLALLOCATIONS.LIST>`;
  }

  const vAttrs = [`VCHTYPE="${escapeXml(vchType)}"`, `ACTION="Create"`];
  if (viewName) {
    vAttrs.push(`OBJVIEW="${escapeXml(viewName)}"`);
  }
  const rid = remoteId || remote_id;
  if (rid) {
    vAttrs.push(`REMOTEID="${escapeXml(rid)}"`);
  }

  const headerLines = [];
  headerLines.push(`<DATE>${escapeXml(tallyDateStr)}</DATE>`);
  headerLines.push(`<VOUCHERTYPENAME>${escapeXml(vchType)}</VOUCHERTYPENAME>`);
  if (vNum) {
    headerLines.push(`<VOUCHERNUMBER>${escapeXml(vNum)}</VOUCHERNUMBER>`);
  }
  if (viewName) {
    headerLines.push(`<PERSISTEDVIEW>${escapeXml(viewName)}</PERSISTEDVIEW>`);
    headerLines.push(`<ISINVOICE>Yes</ISINVOICE>`);
  }
  if (reference) {
    headerLines.push(`<REFERENCE>${escapeXml(reference)}</REFERENCE>`);
  }
  if (referenceDate) {
    const tallyRefDate = parseTallyDate(referenceDate);
    headerLines.push(`<REFERENCEDATE>${escapeXml(tallyRefDate)}</REFERENCEDATE>`);
  }
  if (narration) {
    headerLines.push(`<NARRATION>${escapeXml(narration)}</NARRATION>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(comp)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER ${vAttrs.join(" ")}>
          ${headerLines.join("\n          ")}
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${partyIsPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>${escapeXml(partySignedStr)}</AMOUNT>${billAllocationsXml}
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(offset)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${partyIsPositive ? "No" : "Yes"}</ISDEEMEDPOSITIVE>
            <AMOUNT>${escapeXml(offsetSignedStr)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function tallyUnitEnvelope({
  companyName,
  company_name,
  name,
  formalName,        // "Original name", e.g. "Numbers"
  formal_name,
  uqc,               // GST UQC, e.g. "NOS-NUMBERS"
  gst_rep_uom,
  decimalPlaces = 0,
  decimal_places,
  baseUnit,          // compound unit only
  base_unit,
  base_units,
  additionalUnit,    // compound unit only
  additional_unit,
  additional_units,
  conversion,        // compound unit only: 1 base = N additional
  action = "Create", // "Create" | "Alter" | "Delete"
  oldName,           // for rename when action = "Alter"
  old_name,
} = {}) {
  const comp = companyName || company_name;
  if (!comp) throw new Error("companyName is required");
  if (!name) throw new Error("name is required");

  const formal = formalName || formal_name;
  const gstUqc = uqc || gst_rep_uom;
  const decimals = decimalPlaces ?? decimal_places ?? 0;
  const base = baseUnit || base_unit || base_units;
  const additional = additionalUnit || additional_unit || additional_units;
  const old = oldName || old_name;

  const isCompound = Boolean(base && additional && conversion);
  const attrName = action === "Alter" && old ? old : name;

  // A Delete must still carry <NAME>: without it TallyPrime never answers the request (it freezes).
  let body = action === "Delete" ? `
          <NAME>${escapeXml(name)}</NAME>
        ` : "";
  if (action !== "Delete") {
    body = `
          <NAME>${escapeXml(name)}</NAME>
          <ISUPDATINGTARGETID>No</ISUPDATINGTARGETID>
          <ASORIGINAL>Yes</ASORIGINAL>
          <ISGSTEXCLUDED>No</ISGSTEXCLUDED>
          <ISSIMPLEUNIT>${isCompound ? "No" : "Yes"}</ISSIMPLEUNIT>
          ${formal ? `<ORIGINALNAME>${escapeXml(formal)}</ORIGINALNAME>` : ""}
          ${gstUqc ? `<GSTREPUOM>${escapeXml(gstUqc)}</GSTREPUOM>` : ""}
          ${isCompound ? `
          <BASEUNITS>${escapeXml(base)}</BASEUNITS>
          <ADDITIONALUNITS>${escapeXml(additional)}</ADDITIONALUNITS>
          <CONVERSION>${escapeXml(conversion)}</CONVERSION>` : `
          <DECIMALPLACES>${Number(decimals) || 0}</DECIMALPLACES>`}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(comp)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <UNIT NAME="${escapeXml(attrName)}" ACTION="${escapeXml(action)}">${body}
        </UNIT>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function unitsExportEnvelope(companyName) {
  const vars = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>UnitsColl</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${vars ? escapeXml(companyName) : ""}</SVCURRENTCOMPANY>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="UnitsColl" ISMODIFY="No">
            <TYPE>Units</TYPE>
            <FETCH>Name, OriginalName, GSTRepUOM, IsSimpleUnit, BaseUnits, AdditionalUnits, Conversion, DecimalPlaces, GUID, MasterID, AlterID</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function attrValue(xml, attr) {
  const match = String(xml ?? "").match(new RegExp(`\\s${attr}="([^"]*)"`, "i"));
  return match ? match[1].trim() : null;
}

module.exports = {
  attrValue,
  billCreditPeriodTag,
  billCreditPeriodValue,
  decodeXml,
  dueFromCreditPeriod,
  escapeXml,
  firstTag,
  localTallyToday,
  parseTallyDate,
  staticVariablesXml,
  tallyDateToIso,
  tallyExportEnvelope,
  tallyImportEnvelope,
  tallyUnitEnvelope,
  requireOffsetLedger,
  tallyVoucherAlterEnvelope,
  tallyVoucherCancelEnvelope,
  tallyVoucherCreateEnvelope,
  tallyVoucherDeleteEnvelope,
  unitsExportEnvelope,
  tagBlocks,
};
