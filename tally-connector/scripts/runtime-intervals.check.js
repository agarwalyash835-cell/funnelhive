// Self-check: heartbeat interval updates from the backend are applied live
// and the 5s live-sync floor holds. Run with: node scripts/runtime-intervals.check.js
const assert = require("node:assert");
const { AgentRuntime } = require("../src/agent/runtime");

function makeStore(initial) {
  let cfg = { ...initial };
  return {
    load: () => ({ ...cfg }),
    save: (next) => {
      cfg = { ...cfg, ...next };
      return { ...cfg };
    },
  };
}

const store = makeStore({
  agentId: "agent-1",
  agentToken: "token",
  heartbeatSeconds: 5,
  commandPollSeconds: 5,
  syncIntervalMinutes: 5,
  liveSyncEnabled: true,
  liveSyncProbeSeconds: 45,
  liveSyncIncrementalSeconds: 45,
  fullReconcileIntervalMinutes: 360,
});

const runtime = new AgentRuntime({ store, backend: {}, tally: {} });
let restarted = 0;
runtime.start = () => {
  restarted += 1;
};
runtime.state.running = true;

// Backend pushes 5s intervals via heartbeat → config updated + timers restarted.
runtime.applyIntervals({
  poll_interval_seconds: 5,
  sync_interval_minutes: 5,
  live_sync_enabled: true,
  live_sync_probe_seconds: 5,
  live_sync_incremental_seconds: 5,
  full_reconcile_interval_minutes: 360,
});
assert.strictEqual(store.load().liveSyncIncrementalSeconds, 5);
assert.strictEqual(store.load().liveSyncProbeSeconds, 5);
assert.strictEqual(restarted, 1, "timers should restart when intervals change");

// Same intervals again → no restart churn.
runtime.applyIntervals({
  poll_interval_seconds: 5,
  sync_interval_minutes: 5,
  live_sync_enabled: true,
  live_sync_probe_seconds: 5,
  live_sync_incremental_seconds: 5,
  full_reconcile_interval_minutes: 360,
});
assert.strictEqual(restarted, 1, "unchanged intervals must not restart timers");

// Missing intervals payload → no-op.
runtime.applyIntervals(null);
assert.strictEqual(restarted, 1);

console.log("runtime intervals check passed.");
