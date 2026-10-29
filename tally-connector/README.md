# FunnelHive Tally Connector

A small Windows tray app that keeps TallyPrime on the seller's PC in sync with FunnelHive. TallyPrime is never exposed
to the internet: the connector calls FunnelHive over HTTPS (`/api/v1/agent/tally/*`, served by `server/tally.js`).

## What it does

- Connects with a one-time code from FunnelHive (Tally → Connect a PC; it works once, for 30 minutes) and keeps the
  token it gets back on this PC (Electron `safeStorage` when available).
- Finds TallyPrime on `localhost:9000` (Tally's XML port: F1 → Settings → Connectivity → TallyPrime acts as Server/Both).
- Sends a heartbeat every 5 seconds, and fetches changes queued in FunnelHive every 5 seconds.
- Uploads companies, ledgers, vouchers, outstanding bills, units, godowns and stock items, only when they changed.
- Runs the changes queued in FunnelHive (ledgers, vouchers, receipts, payments, stock items, stock transfers…) through
  Tally's own XML import, then syncs straight away.
- Runs from the tray and can start with Windows.

## Seller setup

1. FunnelHive switches Tally on for the seller (Admin → Sellers → Tally add-on).
2. The seller downloads `funnelhive-tally-connector-setup.exe` from FunnelHive (Tally → Connect a PC) and installs it.
3. They open TallyPrime with their company loaded.
4. They copy the connect code from FunnelHive, paste it into the connector and click **Connect and start**.

## Requirements

- Windows 10 version 1809 (build 17763) or later, or Windows 11, 64-bit (x64).
- TallyPrime on the same PC, with its XML port (9000) on.

## Developer commands

```bash
cd tally-connector
npm install
npm run start:dev    # against a local FunnelHive on http://127.0.0.1:4000
npm run check        # smoke check (and node scripts/*.check.js for the rest)
npm run dist:win     # x64 NSIS installer: release/funnelhive-tally-connector-setup.exe
```

The installer isn't code-signed yet, so Windows SmartScreen may show "Windows protected your PC" the first time:
**More info → Run anyway**.

The connector code comes from AI Hive's Windows Tally agent; the server contract is the same, so changes to one can be
brought to the other.
