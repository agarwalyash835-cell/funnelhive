// Ledger ingest failure must not skip stock upload. Run: node scripts/runtime-sync-isolate.check.js
const assert = require("node:assert");
const { AgentRuntime } = require("../src/agent/runtime");
const { TallyClient, TALLY_HTTP_TIMEOUT_MS } = require("../src/agent/tally-client");

let stockCalled = false;
const runtime = new AgentRuntime({
  store: { load: () => ({}) },
  backend: {
    syncCompanies: async (c) => ({ records_created: c.length, records_updated: 0 }),
    syncLedgers: async () => {
      throw new Error('column "master_id" of relation "tally_ledgers" does not exist');
    },
    syncUnits: async () => ({ records_created: 1, records_updated: 0 }),
    syncGodowns: async () => ({ records_created: 0, records_updated: 0 }),
    syncStockItems: async (_guid, records) => {
      stockCalled = true;
      assert.strictEqual(records[0].closing_balance, -5);
      return { records_created: records.length, records_updated: 0 };
    },
    syncVouchers: async () => ({ records_created: 0, records_updated: 0 }),
    syncOutstandings: async () => ({ records_created: 0, records_updated: 0 }),
  },
  tally: {
    companies: async () => [{ name: "Co", tally_guid: "g1", financial_year_from: "20260401", financial_year_to: "20270331" }],
    ledgers: async () => [{ name: "A" }],
    units: async () => [{ name: "Nos" }],
    godowns: async () => [],
    stockItems: async () => [{ name: "Item", closing_balance: -5 }],
    vouchers: async () => [],
    outstandings: async () => [],
  },
});

(async () => {
  const uploaded = await runtime.sync("SYNC_FULL");
  assert.ok(stockCalled, "stockItems upload must run after ledger 400");
  assert.strictEqual(uploaded.stockItems, 1);
  assert.ok(String(runtime.state.lastError).includes("master_id"));

  const xml = `<ENVELOPE><STOCKITEM NAME="Widget"><NAME>Widget</NAME><CLOSINGBALANCE>5.00- nos</CLOSINGBALANCE><BASEUNITS>nos</BASEUNITS></STOCKITEM></ENVELOPE>`;
  const parsed = new TallyClient({}).parseStockItems(xml);
  assert.strictEqual(parsed[0].closing_balance, -5);

  assert.ok(TALLY_HTTP_TIMEOUT_MS >= 120000, "do not abort Tally exports at 30s");

  let voucherCalled = false;
  let outstandingCalled = false;
  const crashy = new AgentRuntime({
    store: { load: () => ({}) },
    backend: {
      syncCompanies: async (c) => ({ records_created: c.length, records_updated: 0 }),
      syncLedgers: async () => ({ records_created: 1, records_updated: 0 }),
      syncUnits: async () => ({ records_created: 0, records_updated: 0 }),
      syncGodowns: async () => ({ records_created: 0, records_updated: 0 }),
      syncStockItems: async () => ({ records_created: 0, records_updated: 0 }),
      syncVouchers: async () => {
        voucherCalled = true;
        return { records_created: 0, records_updated: 0 };
      },
      syncOutstandings: async () => {
        outstandingCalled = true;
        return { records_created: 0, records_updated: 0 };
      },
    },
    tally: {
      companies: async () => [{ name: "Co", tally_guid: "g1" }],
      ledgers: async () => [{ name: "A" }],
      units: async () => [],
      godowns: async () => [],
      stockItems: async () => {
        throw new Error("This operation was aborted");
      },
      vouchers: async () => {
        throw new Error("should not run");
      },
      outstandings: async () => {
        throw new Error("should not run");
      },
    },
  });
  await crashy.sync("SYNC_FULL");
  assert.equal(voucherCalled, false, "do not fetch vouchers after Tally abort");
  assert.equal(outstandingCalled, false, "do not fetch outstandings after Tally abort");
  assert.ok(String(crashy.state.lastError).includes("aborted"));

  let caught = null;
  runtime.catchSync(Promise.reject(new Error("no company")));
  await new Promise((r) => setImmediate(r));
  caught = runtime.state.lastError;
  assert.strictEqual(caught, "no company");

  console.log("runtime sync isolate check passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
