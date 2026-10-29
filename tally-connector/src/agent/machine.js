const crypto = require("node:crypto");
const os = require("node:os");

function getMachineName() {
  return os.hostname() || "WINDOWS-TALLY-PC";
}

function getMachineFingerprint() {
  const primaryCpu = os.cpus()[0]?.model || "unknown-cpu";
  const user = os.userInfo().username || "unknown-user";
  const raw = [
    os.platform(),
    os.arch(),
    os.hostname(),
    user,
    primaryCpu,
    os.totalmem(),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

module.exports = { getMachineFingerprint, getMachineName };
