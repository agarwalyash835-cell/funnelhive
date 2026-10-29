const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const { APP_VERSION, FIXED_API_BASE_URL, SYNC_COMMAND_TYPES } = require("./constants");
const { describeBackendTarget } = require("./backend-target");
const { getMachineFingerprint, getMachineName } = require("./machine");

const SYNC_BATCH_SIZE = 500;

function entityReconciles(entity, syncType) {
  // Outstandings: a fully paid bill simply vanishes from Bills Receivable/Payable,
  // so without reconcile it stays PENDING in the mirror forever.
  if (entity === "ledgers" || entity === "stockItems" || entity === "outstandings") return true;
  if (entity === "vouchers") {
    return syncType === "SYNC_FULL" || syncType === "SYNC_VOUCHERS" || syncType === "SYNC_INVENTORY";
  }
  return false;
}

function batchUploadPlan(records, reconcileRun, chunkSize = SYNC_BATCH_SIZE) {
  const list = records || [];
  if (!list.length) return [{ records: [], reconcile: Boolean(reconcileRun) }];
  const chunks = [];
  for (let i = 0; i < list.length; i += chunkSize) {
    const last = i + chunkSize >= list.length;
    chunks.push({ records: list.slice(i, i + chunkSize), reconcile: Boolean(reconcileRun) && last });
  }
  return chunks;
}

// A command that never finishes used to stay "SENT" until the backend expired it 15 minutes later, with nothing recorded
// about why, and it blocked every command queued behind it (pollCommands runs one batch at a time). Give up after this
// long and report a failure instead. The change may or may not have been applied, so the message says to check first.
const COMMAND_TIMEOUT_MS = 180_000;

function withCommandTimeout(promise, commandType, timeoutMs = COMMAND_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `TallyPrime did not finish ${commandType} within ${Math.round(timeoutMs / 1000)}s. It may have been applied: check TallyPrime (and look for a dialog waiting for input) before retrying, to avoid a duplicate.`
      );
      err.code = "COMMAND_TIMEOUT";
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A command's result was lost whenever the backend was unreachable at that moment (a restart, a deploy, a network blip):
// the change was applied in TallyPrime but the command stayed "SENT" until it expired, or - worse - the failed report was
// turned into a FAILED result for something that had succeeded. Network errors and 5xx/429 are retried with backoff.
const RESULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function submitWithRetry(submit, delays = RESULT_RETRY_DELAYS_MS, wait = sleepMs, log = console.warn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await submit();
    } catch (error) {
      const status = error && error.status;
      const retriable = status === undefined || status === 429 || status >= 500;
      if (!retriable || attempt >= delays.length) throw error;
      log(`[AgentRuntime] Reporting a command result failed (${error.message}); retrying in ${delays[attempt] / 1000}s`);
      await wait(delays[attempt]);
    }
  }
}

class AgentRuntime extends EventEmitter {
  constructor({ store, backend, tally }) {
    super();
    this.store = store;
    this.backend = backend;
    this.tally = tally;
    this.heartbeatTimer = null;
    this.commandTimer = null;
    this.syncTimer = null;
    this.liveProbeTimer = null;
    this.fullReconcileTimer = null;
    this.busyCommands = false;
    this.busySync = false;
    this.autoSyncPaused = false;
    this.sawTallyOfflineSincePause = false;
    this.syncSignatures = new Map();
    this.state = {
      running: false,
      backend: "UNKNOWN",
      tally: "UNKNOWN",
      company: null,
      lastHeartbeatAt: null,
      lastCommandPollAt: null,
      lastSyncAt: null,
      lastError: null,
    };
  }

  snapshot() {
    const cfg = this.store.load();
    return {
      ...this.state,
      backendTarget: this.backendTarget(),
      config: {
        tallyHost: cfg.tallyHost,
        tallyPort: cfg.tallyPort,
        agentId: cfg.agentId,
        activated: Boolean(cfg.agentId && cfg.agentToken),
        features: cfg.features || [],
        heartbeatSeconds: cfg.heartbeatSeconds,
        commandPollSeconds: cfg.commandPollSeconds,
        syncIntervalMinutes: cfg.syncIntervalMinutes,
        liveSyncEnabled: cfg.liveSyncEnabled,
        liveSyncProbeSeconds: cfg.liveSyncProbeSeconds,
        liveSyncIncrementalSeconds: cfg.liveSyncIncrementalSeconds,
        fullReconcileIntervalMinutes: cfg.fullReconcileIntervalMinutes,
        autoStart: cfg.autoStart,
      },
    };
  }

  backendTarget() {
    let isPackaged = false;
    try {
      isPackaged = Boolean(require("electron").app?.isPackaged);
    } catch {
      /* not running under electron */
    }
    return describeBackendTarget(FIXED_API_BASE_URL, { envUrlSet: Boolean(process.env.TALLY_BACKEND_URL), isPackaged });
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.snapshot());
  }

  async activate({ licenseKey, tallyHost, tallyPort, autoStart = true }) {
    const cfg = this.store.save({
      tallyHost,
      tallyPort: Number(tallyPort || 9000),
      autoStart: Boolean(autoStart),
    });
    const result = await this.backend.activate({
      license_key: licenseKey,
      machine_fingerprint: getMachineFingerprint(),
      machine_name: getMachineName(),
      app_version: APP_VERSION,
      tally_host: cfg.tallyHost,
      tally_port: cfg.tallyPort,
    });
    this.store.save({
      agentId: result.agent_id,
      agentToken: result.agent_token,
      heartbeatSeconds: Number(result.poll_interval_seconds || cfg.heartbeatSeconds),
      commandPollSeconds: Number(result.poll_interval_seconds || cfg.commandPollSeconds),
      syncIntervalMinutes: Number(result.sync_interval_minutes || cfg.syncIntervalMinutes),
      liveSyncEnabled: result.live_sync_enabled !== false,
      liveSyncProbeSeconds: Number(result.live_sync_probe_seconds || cfg.liveSyncProbeSeconds),
      liveSyncIncrementalSeconds: Number(result.live_sync_incremental_seconds || cfg.liveSyncIncrementalSeconds),
      fullReconcileIntervalMinutes: Number(result.full_reconcile_interval_minutes || cfg.fullReconcileIntervalMinutes),
      features: result.features || [],
      activatedAt: new Date().toISOString(),
    });
    this.start();
    return this.snapshot();
  }

  saveSettings(input) {
    const cfg = this.store.save({
      tallyHost: input.tallyHost,
      tallyPort: Number(input.tallyPort || 9000),
      autoStart: Boolean(input.autoStart),
    });
    return cfg;
  }

  start() {
    const cfg = this.store.load();
    if (!cfg.agentId || !cfg.agentToken) {
      this.update({ running: false, lastError: "Activate the agent before starting." });
      return;
    }
    this.stopTimers();
    this.update({ running: true, lastError: null });
    void this.sendHeartbeat();
    void this.pollCommands();
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), Math.max(1, cfg.heartbeatSeconds) * 1000);
    this.commandTimer = setInterval(() => void this.pollCommands(), Math.max(1, cfg.commandPollSeconds) * 1000);
    if (cfg.liveSyncEnabled !== false) {
      // ponytail: 5s probe does a full XML export per entity and skips upload via SHA signature;
      // busySync prevents overlap. Upgrade path: Tally company ALTERID watermark probe.
      this.liveProbeTimer = setInterval(
        () => this.catchSync(this.runAutomaticSync("SYNC_INCREMENTAL")),
        Math.max(5, cfg.liveSyncIncrementalSeconds || 5) * 1000
      );
    } else {
      this.syncTimer = setInterval(
        () => this.catchSync(this.runAutomaticSync("SYNC_FULL")),
        Math.max(1, cfg.syncIntervalMinutes) * 60_000
      );
    }
    this.fullReconcileTimer = setInterval(
      () => this.catchSync(this.runAutomaticSync("SYNC_FULL")),
      Math.max(30, cfg.fullReconcileIntervalMinutes || 360) * 60_000
    );
  }

  catchSync(promise) {
    void Promise.resolve(promise).catch((error) => {
      this.update({ lastError: error?.message || String(error) });
    });
  }

  pauseAutomaticSync() {
    this.autoSyncPaused = true;
    this.sawTallyOfflineSincePause = false;
  }

  async runAutomaticSync(syncType) {
    if (typeof this.tally.detect !== "function") return this.sync(syncType);
    const status = await this.tally.detect();
    if (status.tally_status !== "ONLINE") {
      this.autoSyncPaused = true;
      this.sawTallyOfflineSincePause = true;
      const message =
        status.error ||
        (status.tally_status === "COMPANY_NOT_LOADED"
          ? "No company is open in Tally."
          : "Tally is offline and can't be synced now.");
      this.update({ tally: status.tally_status, company: status.company_name || null, lastError: message });
      return { skipped: true, reason: "tally offline" };
    }
    if (this.autoSyncPaused && !this.sawTallyOfflineSincePause) {
      return { skipped: true, reason: "automatic sync paused" };
    }
    this.autoSyncPaused = false;
    this.sawTallyOfflineSincePause = false;
    try {
      const result = await this.sync(syncType);
      if (this.state.lastError) this.pauseAutomaticSync();
      return result;
    } catch (error) {
      this.pauseAutomaticSync();
      throw error;
    }
  }

  stop() {
    this.stopTimers();
    this.update({ running: false });
  }

  stopTimers() {
    for (const timer of [this.heartbeatTimer, this.commandTimer, this.syncTimer, this.liveProbeTimer, this.fullReconcileTimer]) {
      if (timer) clearInterval(timer);
    }
    this.heartbeatTimer = null;
    this.commandTimer = null;
    this.syncTimer = null;
    this.liveProbeTimer = null;
    this.fullReconcileTimer = null;
  }

  resetActivation() {
    this.stop();
    this.store.clearActivation();
    this.update({ backend: "UNKNOWN", tally: "UNKNOWN", company: null, lastError: null });
  }

  async testTally() {
    const status = await this.tally.detect();
    this.update({
      tally: status.tally_status,
      company: status.company_name || null,
      lastError: status.error || null,
    });
    return status;
  }

  async sendHeartbeat() {
    const cfg = this.store.load();
    if (!cfg.agentId || !cfg.agentToken) return;
    // A blocked TallyPrime makes each probe last its full timeout; never let them pile up.
    if (this.busyHeartbeat) return;
    this.busyHeartbeat = true;
    try {
      const tallyStatus = await this.tally.detect();
      const tallyReachable = ["ONLINE", "COMPANY_NOT_LOADED"].includes(tallyStatus.tally_status);
      const tallyVersion = tallyReachable ? await this.tally.productVersion().catch(() => null) : null;
      const response = await this.backend.heartbeat({
        agent_id: cfg.agentId,
        tally_status: tallyStatus.tally_status,
        company_loaded: Boolean(tallyStatus.company_loaded),
        company_name: tallyStatus.company_name,
        company_guid: tallyStatus.company_guid,
        tally_version: tallyVersion || undefined,
        app_version: APP_VERSION,
        timestamp: new Date().toISOString(),
      });
      this.update({
        backend: "ONLINE",
        tally: tallyStatus.tally_status,
        company: tallyStatus.company_name || null,
        lastHeartbeatAt: new Date().toISOString(),
        lastError: tallyStatus.error || null,
      });
      this.applyIntervals(response && response.intervals);
    } catch (error) {
      this.update({ backend: "ERROR", lastError: error.message });
    } finally {
      this.busyHeartbeat = false;
    }
  }

  // Backend settings win over local config; restart timers only when something changed.
  applyIntervals(intervals) {
    if (!intervals) return;
    const cfg = this.store.load();
    const next = {
      heartbeatSeconds: Number(intervals.poll_interval_seconds || cfg.heartbeatSeconds),
      commandPollSeconds: Number(intervals.poll_interval_seconds || cfg.commandPollSeconds),
      syncIntervalMinutes: Number(intervals.sync_interval_minutes || cfg.syncIntervalMinutes),
      liveSyncEnabled: intervals.live_sync_enabled !== false,
      liveSyncProbeSeconds: Number(intervals.live_sync_probe_seconds || cfg.liveSyncProbeSeconds),
      liveSyncIncrementalSeconds: Number(intervals.live_sync_incremental_seconds || cfg.liveSyncIncrementalSeconds),
      fullReconcileIntervalMinutes: Number(intervals.full_reconcile_interval_minutes || cfg.fullReconcileIntervalMinutes),
    };
    const changed = Object.keys(next).some((key) => next[key] !== cfg[key]);
    if (!changed) return;
    this.store.save(next);
    if (this.state.running) this.start();
  }

  async pollCommands() {
    if (this.busyCommands) return;
    this.busyCommands = true;
    try {
      const commands = await this.backend.pendingCommands(10);
      this.update({ lastCommandPollAt: new Date().toISOString() });
      for (const command of commands) {
        await this.executeBackendCommand(command);
      }
    } catch (error) {
      this.update({ lastError: error.message });
    } finally {
      this.busyCommands = false;
    }
  }

  async executeBackendCommand(command) {
    let executed = false;
    try {
      let result;
      if (command.command_type === "REFRESH_LEDGER") {
        result = await this.refreshOneLedger(command);
      } else if (SYNC_COMMAND_TYPES.has(command.command_type)) {
        this.autoSyncPaused = false;
        this.sawTallyOfflineSincePause = false;
        result = await this.sync(command.command_type);
        if (this.state.lastError) {
          this.pauseAutomaticSync();
          throw new Error(this.state.lastError);
        }
      } else {
        result = await withCommandTimeout(this.tally.executeCommand(command), command.command_type);
      }
      executed = true;
      await submitWithRetry(() =>
        this.backend.submitCommandResult(command.command_id || command.id, {
          status: "SUCCESS",
          result,
          error_message: null,
        })
      );
      // Writes change Tally data — sync immediately so the backend reflects it
      // without waiting for the next 5s probe.
      if (/^(CREATE_|ALTER_|DELETE_|CANCEL_|POST_)/.test(command.command_type)) {
        this.catchSync(
          this.sync("SYNC_INCREMENTAL")
            .then(() => {
              if (this.state.lastError) this.pauseAutomaticSync();
            })
            .catch((error) => {
              this.pauseAutomaticSync();
              throw error;
            })
        );
      }
    } catch (error) {
      if (executed) {
        // TallyPrime applied the command but the backend could not be told, even after retries. Reporting FAILED here would
        // be wrong; the backend will expire the command and the next sync shows the real state.
        console.error(`[AgentRuntime] Command ${command.command_type} (${command.command_id || command.id}) was applied but its result could not be reported: ${error.message}`);
        this.update({ lastError: `Result of ${command.command_type} could not be reported: ${error.message}` });
        return;
      }
      // Preserve Tally's raw response with the failure so the backend stores
      // it (result_json) — LINEERROR alone rarely explains a mismatch.
      const tallyResponse = typeof error?.tally_response === "string" ? error.tally_response.slice(0, 4000) : null;
      console.error(
        `[AgentRuntime] Command ${command.command_type} (${command.command_id || command.id}) FAILED: ${error.message}`,
        tallyResponse ? `\nTally Response:\n${tallyResponse}` : ""
      );
      const failResult = {
        code: error.code || undefined,
        requiresManualAction: error.requiresManualAction || undefined,
        requiresSync: error.requiresSync || undefined,
        voucher: error.voucher || undefined,
        tally_response: tallyResponse || undefined,
      };
      for (const k of Object.keys(failResult)) {
        if (failResult[k] === undefined) delete failResult[k];
      }
      await submitWithRetry(() =>
        this.backend.submitCommandResult(command.command_id || command.id, {
          status: "FAILED",
          result: failResult,
          error_message: error.message,
        })
      );
    }
  }

  async refreshOneLedger(command) {
    const payload = command.payload || command.payload_json || {};
    const companyGuid = payload.company_guid;
    const companyName = payload.company_name;
    if (!companyGuid && !companyName) throw new Error("Ledger refresh needs a Tally company");
    const records = await this.tally.ledgers(companyGuid, companyName);
    const wantGuid = String(payload.tally_guid || "").trim().toLowerCase();
    const wantName = String(payload.name || "").trim().toLowerCase();
    const match = (records || []).find((row) => {
      const guid = String(row.tally_guid || "").trim().toLowerCase();
      const name = String(row.name || "").trim().toLowerCase();
      if (wantGuid && guid === wantGuid) return true;
      return Boolean(wantName && name === wantName);
    });
    if (!match) throw new Error(`Ledger "${payload.name || payload.tally_guid || "unknown"}" was not in the Tally export`);
    return this.backend.syncLedgers(companyGuid || match.company_guid, [{ ...match, refresh: true }], { reconcile: false });
  }

  async sync(syncType = "SYNC_FULL") {
    if (this.busySync) {
      if (syncType === "SYNC_INCREMENTAL") {
        return { skipped: true, reason: "sync already running" };
      }
      const waitStart = Date.now();
      while (this.busySync && Date.now() - waitStart < 15000) {
        await new Promise((r) => setTimeout(r, 250));
      }
      if (this.busySync) return { skipped: true, reason: "sync busy timeout" };
    }
    this.busySync = true;
    let entityError = null;
    try {
      const companies = (await this.tally.companies()).map((company) => ({
        ...company,
        tally_guid: company.tally_guid || company.name,
      }));
      const uploaded = { companies: 0, ledgers: 0, vouchers: 0, outstandings: 0 };
      let halted = false;
      const note = (error) => {
        entityError = error?.message || String(error);
        this.update({ lastError: entityError });
        if (/aborted/i.test(entityError)) halted = true;
      };

      if (this.shouldSync(syncType, "companies")) {
        try {
          const companyResult = await this.uploadIfChanged(syncType, "global", "companies", companies, () =>
            this.uploadInBatches(syncType, "companies", companies, (slice) => this.backend.syncCompanies(slice))
          );
          uploaded.companies = companyResult.records_created + companyResult.records_updated;
        } catch (error) {
          note(error);
        }
      }

      if (!companies.length) throw new Error("No Tally company is loaded. Open a company in TallyPrime and retry.");

      for (const company of companies) {
        if (halted) break;
        const companyGuid = company.tally_guid || company.name;
        const companyName = company.name;
        const syncEntity = async (entity, fetchRecords, send) => {
          if (halted || !this.shouldSync(syncType, entity)) return;
          let records;
          try {
            records = await fetchRecords();
          } catch (error) {
            note(error);
            return;
          }
          try {
            const result = await this.uploadIfChanged(syncType, companyGuid, entity, records, () =>
              this.uploadInBatches(syncType, entity, records, send)
            );
            uploaded[entity] = (uploaded[entity] || 0) + result.records_created + result.records_updated;
          } catch (error) {
            note(error);
          }
        };
        await syncEntity("ledgers", () => this.tally.ledgers(companyGuid, companyName), (slice, opts) =>
          this.backend.syncLedgers(companyGuid, slice, opts)
        );
        await syncEntity("units", () => this.tally.units(companyGuid, companyName), (slice) =>
          this.backend.syncUnits(companyGuid, slice)
        );
        await syncEntity("godowns", () => this.tally.godowns(companyGuid, companyName), (slice) =>
          this.backend.syncGodowns(companyGuid, slice)
        );
        await syncEntity("stockItems", () => this.tally.stockItems(companyGuid, companyName), (slice, opts) =>
          this.backend.syncStockItems(companyGuid, slice, opts)
        );
        await syncEntity(
          "vouchers",
          () =>
            this.tally.vouchers(companyGuid, companyName, {
              from: company.financial_year_from,
              to: company.financial_year_to,
            }),
          (slice, opts) => this.backend.syncVouchers(companyGuid, slice, opts)
        );
        await syncEntity("outstandings", () => this.tally.outstandings(companyGuid, companyName), (slice, opts) =>
          this.backend.syncOutstandings(companyGuid, slice, opts)
        );
      }

      this.update({ lastSyncAt: new Date().toISOString(), lastError: entityError });
      return uploaded;
    } finally {
      this.busySync = false;
    }
  }

  shouldSync(syncType, entity) {
    if (syncType === "SYNC_FULL" || syncType === "SYNC_INCREMENTAL") return true;
    return (
      (syncType === "SYNC_COMPANIES" && entity === "companies") ||
      (syncType === "SYNC_LEDGERS" && entity === "ledgers") ||
      (syncType === "SYNC_VOUCHERS" && entity === "vouchers") ||
      (syncType === "SYNC_OUTSTANDINGS" && entity === "outstandings") ||
      (syncType === "SYNC_UNITS" && entity === "units") ||
      (syncType === "SYNC_STOCK_ITEMS" && entity === "stockItems") ||
      (syncType === "SYNC_GODOWNS" && entity === "godowns") ||
      (syncType === "SYNC_INVENTORY" && (entity === "stockItems" || entity === "units" || entity === "godowns" || entity === "vouchers"))
    );
  }

  async uploadInBatches(syncType, entity, records, send) {
    const plan = batchUploadPlan(records, entityReconciles(entity, syncType) && !records?.partial);
    const multi = plan.length > 1;
    let created = 0;
    let updated = 0;
    let watermark = null;
    for (const part of plan) {
      if (!part.records.length && !part.reconcile) continue;
      if (part.reconcile && multi && !watermark) {
        throw new Error("Missing reconcile_before from the first sync batch");
      }
      const result = await send(part.records, {
        reconcile: part.reconcile,
        reconcileBefore: part.reconcile && multi ? watermark : undefined,
      });
      if (!watermark && result && result.reconcile_before) watermark = result.reconcile_before;
      created += result.records_created || 0;
      updated += result.records_updated || 0;
    }
    return { records_created: created, records_updated: updated };
  }

  signature(records) {
    return crypto.createHash("sha256").update(JSON.stringify(records || [])).digest("hex");
  }

  async uploadIfChanged(syncType, companyGuid, entity, records, upload) {
    const sigKey = `${companyGuid}:${entity}`;
    const sig = this.signature(records);
    if (syncType === "SYNC_INCREMENTAL" && this.syncSignatures.get(sigKey) === sig) {
      return { records_created: 0, records_updated: 0, skipped: true };
    }
    const result = await upload();
    this.syncSignatures.set(sigKey, sig);
    return result;
  }
}

module.exports = { submitWithRetry, RESULT_RETRY_DELAYS_MS, AgentRuntime, batchUploadPlan, SYNC_BATCH_SIZE, entityReconciles, withCommandTimeout, COMMAND_TIMEOUT_MS };
