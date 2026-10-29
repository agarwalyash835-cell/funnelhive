const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const {
  DEFAULT_COMMAND_POLL_SECONDS,
  DEFAULT_HEARTBEAT_SECONDS,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  DEFAULT_TALLY_HOST,
  DEFAULT_TALLY_PORT,
} = require("./constants");

const CONFIG_FILE = "agent-config.json";

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function defaults() {
  return {
    tallyHost: DEFAULT_TALLY_HOST,
    tallyPort: DEFAULT_TALLY_PORT,
    heartbeatSeconds: DEFAULT_HEARTBEAT_SECONDS,
    commandPollSeconds: DEFAULT_COMMAND_POLL_SECONDS,
    syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
    liveSyncEnabled: true,
    liveSyncProbeSeconds: 5,
    liveSyncIncrementalSeconds: 5,
    fullReconcileIntervalMinutes: 360,
    agentId: null,
    agentToken: null,
    activatedAt: null,
    features: [],
    autoStart: true,
  };
}

function encrypt(value) {
  if (!value) return null;
  if (!safeStorage.isEncryptionAvailable()) return { mode: "plain", value };
  return { mode: "safeStorage", value: safeStorage.encryptString(value).toString("base64") };
}

function decrypt(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value.mode === "plain") return value.value || null;
  if (value.mode === "safeStorage" && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(value.value, "base64"));
  }
  return null;
}

class ConfigStore {
  load() {
    const base = defaults();
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
      delete raw.apiBaseUrl;
      return {
        ...base,
        ...raw,
        agentToken: decrypt(raw.agentToken),
        tallyPort: Number(raw.tallyPort || base.tallyPort),
        heartbeatSeconds: Number(raw.heartbeatSeconds || base.heartbeatSeconds),
        commandPollSeconds: Number(raw.commandPollSeconds || base.commandPollSeconds),
        syncIntervalMinutes: Number(raw.syncIntervalMinutes || base.syncIntervalMinutes),
        liveSyncEnabled: raw.liveSyncEnabled !== false,
        liveSyncProbeSeconds: Number(raw.liveSyncProbeSeconds || base.liveSyncProbeSeconds),
        liveSyncIncrementalSeconds: Number(raw.liveSyncIncrementalSeconds || base.liveSyncIncrementalSeconds),
        fullReconcileIntervalMinutes: Number(raw.fullReconcileIntervalMinutes || base.fullReconcileIntervalMinutes),
      };
    } catch {
      return base;
    }
  }

  save(next) {
    const previous = this.load();
    const merged = { ...previous, ...next };
    const disk = { ...merged, agentToken: encrypt(merged.agentToken) };
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(disk, null, 2));
    return merged;
  }

  clearActivation() {
    return this.save({
      agentId: null,
      agentToken: null,
      activatedAt: null,
      features: [],
    });
  }
}

module.exports = { ConfigStore };
