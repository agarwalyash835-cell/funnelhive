// One source of truth: package.json. A hard-coded string drifted (1.0.0 here, 1.0.1 there), so the dashboard and the
// backend's minimum-version check saw an older build than the one actually running. package.json ships inside the
// packaged app, so this works installed as well as from source.
const APP_VERSION = String(require("../../package.json").version || "0.0.0");
const FIXED_API_BASE_URL = (process.env.TALLY_BACKEND_URL || "https://app.getaihive.in").replace(/\/+$/, "");
const DEFAULT_TALLY_HOST = "127.0.0.1";
const DEFAULT_TALLY_PORT = 9000;
const DEFAULT_HEARTBEAT_SECONDS = 5;
const DEFAULT_COMMAND_POLL_SECONDS = 5;
const DEFAULT_SYNC_INTERVAL_MINUTES = 5;

const SYNC_COMMAND_TYPES = new Set([
  "SYNC_COMPANIES",
  "SYNC_LEDGERS",
  "SYNC_VOUCHERS",
  "SYNC_OUTSTANDINGS",
  "SYNC_UNITS",
  "SYNC_STOCK_ITEMS",
  "SYNC_GODOWNS",
  "SYNC_INVENTORY",
  "SYNC_FULL",
]);

module.exports = {
  APP_VERSION,
  FIXED_API_BASE_URL,
  DEFAULT_TALLY_HOST,
  DEFAULT_TALLY_PORT,
  DEFAULT_HEARTBEAT_SECONDS,
  DEFAULT_COMMAND_POLL_SECONDS,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  SYNC_COMMAND_TYPES,
};
