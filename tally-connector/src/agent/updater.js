// Self-update: the connector asks FunnelHive which version is current (a public endpoint — it works even when the
// server refuses an outdated connector), downloads the installer, checks its SHA-256 against what the server said and
// runs it silently ("/S --force-run": per-user NSIS install over this one, then starts the new version). This app quits
// so the installer can replace it. Never mid-change: it waits until no Tally command is running.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { APP_VERSION, FIXED_API_BASE_URL } = require("./constants");

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000; // and at start, and when the server says this version is too old
const IDLE_WAIT_MS = 5000;

const newer = (a, b) => {
  const x = String(a || "0").split(".").map(Number), y = String(b || "0").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

class Updater {
  // isBusy: true while a Tally change is running; quit: closes the app for the installer
  constructor({ isBusy = () => false, quit = () => {}, log = console, apiBase = FIXED_API_BASE_URL, current = APP_VERSION, platform = process.platform } = {}) {
    Object.assign(this, { isBusy, quit, log, apiBase, current, platform });
    this.timer = null;
    this.running = false;
    this.status = { state: "idle", latest: null, error: null };
  }

  start() {
    if (this.platform !== "win32" || this.timer) return;
    setTimeout(() => void this.check(), 60 * 1000); // after start-up settles
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // → the release when one newer than this build is published, else null
  async latest() {
    const res = await fetch(`${this.apiBase}/api/v1/agent/tally/update?version=${encodeURIComponent(this.current)}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`update check failed (${res.status})`);
    const r = await res.json();
    if (!r || !r.version || !r.url || !/^[a-f0-9]{64}$/.test(String(r.sha256 || ""))) return null;
    return newer(r.version, this.current) ? r : null;
  }

  // the installer into the temp folder, refused unless its size and SHA-256 match the release
  async download(release) {
    const res = await fetch(new URL(release.url, this.apiBase).toString());
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (release.size && buf.length !== Number(release.size)) throw new Error("download incomplete");
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha !== release.sha256) throw new Error("download didn't match its checksum");
    const file = path.join(os.tmpdir(), `funnelhive-tally-connector-${release.version}-setup.exe`);
    fs.writeFileSync(file, buf);
    return file;
  }

  async check() {
    if (this.running || this.platform !== "win32") return;
    this.running = true;
    try {
      const release = await this.latest();
      if (!release) { this.status = { state: "current", latest: this.current, error: null }; return; }
      this.status = { state: "downloading", latest: release.version, error: null };
      this.log.log(`[Updater] ${this.current} → ${release.version}: downloading`);
      const file = await this.download(release);
      for (let i = 0; i < 120 && this.isBusy(); i++) await new Promise((r) => setTimeout(r, IDLE_WAIT_MS));
      this.status = { state: "installing", latest: release.version, error: null };
      this.log.log(`[Updater] installing ${release.version}`);
      spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      this.quit();
    } catch (error) {
      this.status = { state: "error", latest: this.status.latest, error: error.message };
      this.log.warn(`[Updater] ${error.message}`);
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Updater, newer };
