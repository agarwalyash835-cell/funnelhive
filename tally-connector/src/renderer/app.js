const $ = (id) => document.getElementById(id);

function text(id, value) {
  $(id).textContent = value || "—";
}

function fmt(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function setBadge(el, label, status) {
  const shown = status === "PORT_CLOSED" ? "OPEN" : status || "UNKNOWN";
  el.textContent = `${label} ${shown}`;
  el.className = `badge ${status === "ONLINE" ? "ok" : status === "PORT_CLOSED" ? "warn" : status === "ERROR" || status === "OFFLINE" ? "bad" : ""}`;
}

function applyState(state) {
  $("tallyHost").value = state.config.tallyHost || "localhost";
  $("tallyPort").value = state.config.tallyPort || 9000;
  $("autoStart").checked = Boolean(state.config.autoStart);
  text("agentId", state.config.agentId ? `Agent ${state.config.agentId}` : "Not activated");
  text("running", state.running ? "Yes" : "No");
  text("company", state.company);
  text("lastHeartbeat", fmt(state.lastHeartbeatAt));
  text("lastPoll", fmt(state.lastCommandPollAt));
  text("lastSync", fmt(state.lastSyncAt));
  text("lastError", state.lastError);
  const target = state.backendTarget;
  if (target) {
    $("backendTarget").textContent = `${target.environment === "production" ? "Production" : target.environment === "local" ? "Local" : "Custom"}: ${target.url}`;
    $("backendTarget").className = `backend-target ${target.environment}`;
    $("backendWarning").textContent = target.warning || "";
    $("backendWarning").hidden = !target.warning;
  }
  setBadge($("backendBadge"), "FunnelHive", state.backend);
  setBadge($("tallyBadge"), "Tally", state.tally);
}

async function refresh() {
  applyState(await window.tallyAgent.getState());
}

async function withMessage(fn) {
  $("setupMessage").textContent = "";
  try {
    const result = await fn();
    $("setupMessage").textContent = "Done.";
    await refresh();
    return result;
  } catch (error) {
    $("setupMessage").textContent = error.message || String(error);
    throw error;
  }
}

$("setupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  $("activateBtn").disabled = true;
  withMessage(() =>
    window.tallyAgent.activate({
      licenseKey: $("licenseKey").value.trim(),
      tallyHost: $("tallyHost").value.trim() || "localhost",
      tallyPort: Number($("tallyPort").value || 9000),
      autoStart: $("autoStart").checked,
    })
  ).finally(() => {
    $("activateBtn").disabled = false;
    $("licenseKey").value = "";
  });
});

$("startBtn").addEventListener("click", () => withMessage(() => window.tallyAgent.start()));
$("stopBtn").addEventListener("click", () => withMessage(() => window.tallyAgent.stop()));
$("testBtn").addEventListener("click", () => withMessage(() => window.tallyAgent.testTally()));
$("syncBtn").addEventListener("click", () => withMessage(() => window.tallyAgent.syncNow("SYNC_FULL")));
$("openLogsBtn").addEventListener("click", () => window.tallyAgent.openLogs());
$("resetBtn").addEventListener("click", () => {
  if (window.confirm("Disconnect this PC? To connect it again, copy a new code from FunnelHive (Tally → Connect a PC).")) {
    withMessage(() => window.tallyAgent.reset());
  }
});

for (const id of ["tallyHost", "tallyPort", "autoStart"]) {
  $(id).addEventListener("change", () => {
    window.tallyAgent.saveSettings({
      tallyHost: $("tallyHost").value.trim() || "localhost",
      tallyPort: Number($("tallyPort").value || 9000),
      autoStart: $("autoStart").checked,
    });
  });
}

window.tallyAgent.onState(applyState);
void refresh();
