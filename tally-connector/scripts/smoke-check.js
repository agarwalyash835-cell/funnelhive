const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "package.json",
  "src/main.js",
  "src/preload.js",
  "src/agent/backend-client.js",
  "src/agent/config-store.js",
  "src/agent/constants.js",
  "src/agent/machine.js",
  "src/agent/runtime.js",
  "src/agent/tally-client.js",
  "src/agent/xml.js",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/styles.css",
];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing ${file}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const constants = fs.readFileSync(path.join(root, "src", "agent", "constants.js"), "utf8");
const rendererHtml = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const rendererJs = fs.readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const runtimeJs = fs.readFileSync(path.join(root, "src", "agent", "runtime.js"), "utf8");
const tallyClientJs = fs.readFileSync(path.join(root, "src", "agent", "tally-client.js"), "utf8");

if (!constants.includes('process.env.TALLY_BACKEND_URL || "https://app.getaihive.in"')) {
  throw new Error("Agent backend URL must be fixed to https://app.getaihive.in.");
}
for (const [name, content] of Object.entries({ rendererHtml, rendererJs, runtimeJs })) {
  if (content.includes("apiBaseUrl") || content.includes("Backend API URL") || content.includes("api.your-domain.com")) {
    throw new Error(`${name} must not expose or configure the backend URL.`);
  }
}
// a voucher lookup may return the raw block it found; what must never happen is running XML a command sent in
if (/payload\??\.raw_xml|payload\[["']raw_xml["']\]/.test(tallyClientJs)) throw new Error("Agent must not execute raw_xml commands.");

// Build target validation — must be an NSIS installer locked to x64.
// ARM64 targets are explicitly disallowed: most customer Windows machines
// are Intel/AMD and will refuse to launch an ARM64 binary with the
// "This app can't run on your PC" error.
const winTargets = pkg.build?.win?.target;
if (!winTargets) throw new Error("Missing build.win.target.");
const normalized = (Array.isArray(winTargets) ? winTargets : [winTargets]).map((t) =>
  typeof t === "string" ? { target: t, arch: ["x64"] } : t
);
const hasNsisX64 = normalized.some(
  (t) => t.target === "nsis" && Array.isArray(t.arch) && t.arch.includes("x64")
);
if (!hasNsisX64) throw new Error("build.win.target must include nsis on x64.");
const hasArm64 = normalized.some((t) => Array.isArray(t.arch) && t.arch.includes("arm64"));
if (hasArm64) throw new Error("build.win.target must NOT ship arm64 — customers on Intel will get 'not supported on your PC'.");

if (!pkg.scripts?.["dist:win"]) throw new Error("Missing dist:win build script.");
if (!pkg.build?.win?.icon) throw new Error("Missing build.win.icon — installer will use generic icon.");
if (!pkg.build?.win?.signtoolOptions?.publisherName) throw new Error("Missing build.win.signtoolOptions.publisherName — required for Windows Properties metadata.");
if (!pkg.build?.nsis?.include) throw new Error("Missing build.nsis.include — Windows version gate not wired.");

// Required build resources must actually exist on disk.
const iconIco = path.join(root, "build", "icon.ico");
const installerNsh = path.join(root, "build", "installer.nsh");
if (!fs.existsSync(iconIco)) throw new Error("build/icon.ico missing — run `npm run icon`.");
if (!fs.existsSync(installerNsh)) throw new Error("build/installer.nsh missing — Windows version gate not present.");

console.log("Windows Tally agent smoke check passed.");
