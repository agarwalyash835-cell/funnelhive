const { FIXED_API_BASE_URL } = require("./constants");

class BackendClient {
  constructor(getConfig) {
    this.getConfig = getConfig;
  }

  baseUrl() {
    const url = FIXED_API_BASE_URL;
    if (url.startsWith("https://")) return url;
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1") || url.startsWith("http://10.0.2.2")) {
      return url;
    }
    throw new Error("Tally backend must use HTTPS for remote hosts.");
  }

  async request(path, init = {}) {
    const cfg = this.getConfig();
    const headers = {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cfg.agentToken ? { Authorization: `Bearer ${cfg.agentToken}` } : {}),
      ...(init.headers || {}),
    };
    const res = await fetch(`${this.baseUrl()}${path}`, { ...init, headers });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text || `${res.status} ${res.statusText}` };
    }
    if (!res.ok) {
      const message = body.error || body.message || `${res.status} ${res.statusText}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  activate(payload) {
    return this.request("/api/v1/agent/tally/activate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  heartbeat(payload) {
    return this.request("/api/v1/agent/tally/heartbeat", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  pendingCommands(limit = 10) {
    return this.request(`/api/v1/agent/tally/commands/pending?limit=${encodeURIComponent(limit)}`);
  }

  submitCommandResult(commandId, payload) {
    return this.request(`/api/v1/agent/tally/commands/${encodeURIComponent(commandId)}/result`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  syncCompanies(records, syncRunId) {
    return this.request("/api/v1/agent/tally/sync/companies", {
      method: "POST",
      body: JSON.stringify({ sync_run_id: syncRunId, records }),
    });
  }

  syncLedgers(companyGuid, records, opts = {}) {
    return this.request("/api/v1/agent/tally/sync/ledgers", {
      method: "POST",
      body: JSON.stringify(this.syncBody(companyGuid, records, opts)),
    });
  }

  syncVouchers(companyGuid, records, opts = {}) {
    return this.request("/api/v1/agent/tally/sync/vouchers", {
      method: "POST",
      body: JSON.stringify(this.syncBody(companyGuid, records, opts)),
    });
  }

  syncOutstandings(companyGuid, records, opts = {}) {
    return this.request("/api/v1/agent/tally/sync/outstandings", {
      method: "POST",
      body: JSON.stringify(this.syncBody(companyGuid, records, opts)),
    });
  }

  syncUnits(companyGuid, records, syncRunId) {
    return this.request("/api/v1/agent/tally/sync/units", {
      method: "POST",
      // reconcile: complete list, so units missing here were deleted in Tally (the server ignores it for an empty list)
      body: JSON.stringify({ sync_run_id: syncRunId, company_guid: companyGuid, records, reconcile: true }),
    });
  }

  syncGodowns(companyGuid, records, syncRunId) {
    return this.request("/api/v1/agent/tally/sync/godowns", {
      method: "POST",
      body: JSON.stringify({ sync_run_id: syncRunId, company_guid: companyGuid, records, reconcile: true }),
    });
  }

  syncStockItems(companyGuid, records, opts = {}) {
    return this.request("/api/v1/agent/tally/sync/stock-items", {
      method: "POST",
      body: JSON.stringify(this.syncBody(companyGuid, records, opts)),
    });
  }

  syncBody(companyGuid, records, opts = {}) {
    const body = {
      sync_run_id: opts.syncRunId,
      company_guid: companyGuid,
      records,
      reconcile: opts.reconcile === true,
    };
    if (opts.reconcileBefore) body.reconcile_before = opts.reconcileBefore;
    return body;
  }
}

module.exports = { BackendClient };
