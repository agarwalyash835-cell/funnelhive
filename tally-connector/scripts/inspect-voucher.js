// Inspect a specific voucher in TallyPrime and display all its identification fields and raw XML.
// Usage:
//   node scripts/inspect-voucher.js [voucherType] [voucherNumber] [companyName]
// Example:
//   node scripts/inspect-voucher.js Payment 1
//   node scripts/inspect-voucher.js Sales 42 "My Company"

const { TallyClient } = require("../src/agent/tally-client");

const args = process.argv.slice(2);
const voucherType = args[0] || "Payment";
const voucherNumber = args[1] || "1";
const companyName = args[2] || process.env.TALLY_COMPANY || "";
const tallyPort = process.env.TALLY_PORT ? Number(process.env.TALLY_PORT) : 9000;
const tallyHost = process.env.TALLY_HOST || "127.0.0.1";

async function main() {
  console.log(`\n======================================================`);
  console.log(` Inspecting Tally Voucher: ${voucherType} ${voucherNumber}`);
  console.log(` Connecting to: http://${tallyHost}:${tallyPort}`);
  console.log(`======================================================\n`);

  const client = new TallyClient(() => ({ tallyHost, tallyPort }));

  // 1. Detect active company if none supplied
  let targetCompany = companyName;
  if (!targetCompany) {
    try {
      const detected = await client.detect();
      if (detected.company_name) {
        targetCompany = detected.company_name;
        console.log(`Active company detected in TallyPrime: "${targetCompany}" (GUID: ${detected.company_guid})\n`);
      } else {
        const list = await client.companies();
        if (list[0]?.name) {
          targetCompany = list[0].name;
          console.log(`Company from List of Companies: "${targetCompany}" (GUID: ${list[0].tally_guid})\n`);
        }
      }
    } catch (e) {
      console.warn(`Could not detect active company: ${e.message}`);
    }
  } else {
    console.log(`Target company: "${targetCompany}"\n`);
  }

  // 2. Query the voucher
  console.log(`Querying Day Book for ${voucherType} ${voucherNumber}...`);
  try {
    const result = await client.queryVoucher({
      company_name: targetCompany,
      voucher_type: voucherType,
      voucher_number: voucherNumber,
    });

    if (!result.found) {
      console.error(`\n❌ Result: ${result.message}`);
      console.log(`\nTip: Ensure ${voucherType} ${voucherNumber} exists in Tally's Day Book for the current financial period.`);
      process.exit(1);
    }

    console.log(`\n✅ Voucher Found! Available Identifiers:`);
    console.log(`------------------------------------------------------`);
    console.log(`Voucher Type       : ${result.voucher_type}`);
    console.log(`Voucher Number     : ${result.voucher_number}`);
    console.log(`Voucher Date       : ${result.date}`);
    console.log(`Party / Account    : ${result.party_name || "—"}`);
    console.log(`Amount             : ${result.amount != null ? result.amount : "—"}`);
    console.log(`------------------------------------------------------`);
    console.log(`Tally GUID         : ${result.guid || "(none)"}`);
    console.log(`Tally MASTERID     : ${result.master_id || "(none)"}`);
    console.log(`Tally ALTERID      : ${result.alter_id || "(none)"}`);
    console.log(`Tally REMOTEID attr: ${result.remote_id_attr || "(none)"}`);
    console.log(`Tally VCHKEY attr  : ${result.vch_key_attr || "(none)"}`);
    console.log(`------------------------------------------------------\n`);

    console.log(`Raw Tally XML Block:`);
    console.log(`------------------------------------------------------`);
    console.log(result.raw_xml);
    console.log(`------------------------------------------------------\n`);
  } catch (err) {
    console.error(`\n❌ Error querying voucher from Tally:`, err.message);
    if (err.tally_response) {
      console.error(`\nTally Response:\n${err.tally_response}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
