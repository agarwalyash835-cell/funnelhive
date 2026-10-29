const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, nativeImage } = require("electron");
const { ConfigStore } = require("./agent/config-store");
const { BackendClient } = require("./agent/backend-client");
const { TallyClient } = require("./agent/tally-client");
const { AgentRuntime } = require("./agent/runtime");

let mainWindow = null;
let tray = null;
let runtime = null;

// Logging is best-effort: a closed parent console (EPIPE) must not crash the agent mid-command.
for (const stream of [process.stdout, process.stderr]) stream?.on?.("error", () => {});

// Enforce single-instance so the installer's "run after finish" and any
// double-launch from Start Menu / autostart do not spawn duplicate trays.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Resolve a packed-or-unpacked icon path. In production the build resources
// directory is copied next to the executable; in dev it lives at ../build.
function resolveIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "build", "icon.ico"),
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.png"),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function appIcon() {
  const iconPath = resolveIconPath();
  if (iconPath) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  // Fallback: tiny indigo square so we never ship a blank tray icon.
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAKklEQVR42mNkoBAwUqifYdQABgbG/4eBgaGhgYGBgYGBkQGJAAAFSQH/wHh51wAAAABJRU5ErkJggg=="
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 780,
    minHeight: 560,
    title: "FunnelHive Tally Connector",
    backgroundColor: "#f7f8fb",
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(appIcon());
  tray.setToolTip("FunnelHive Tally Connector");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open setup", click: showMainWindow },
      { label: "Start agent", click: () => runtime.start() },
      { label: "Stop agent", click: () => runtime.stop() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuiting = true;
          runtime.stop();
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showMainWindow);
}

function setupIpc(store) {
  ipcMain.handle("agent:get-state", () => runtime.snapshot());
  ipcMain.handle("agent:activate", async (_event, input) => {
    const state = await runtime.activate(input);
    app.setLoginItemSettings({ openAtLogin: Boolean(state.config.autoStart) });
    return state;
  });
  ipcMain.handle("agent:save-settings", (_event, input) => {
    const cfg = runtime.saveSettings(input);
    app.setLoginItemSettings({ openAtLogin: Boolean(cfg.autoStart) });
    return runtime.snapshot();
  });
  ipcMain.handle("agent:start", () => {
    runtime.start();
    return runtime.snapshot();
  });
  ipcMain.handle("agent:stop", () => {
    runtime.stop();
    return runtime.snapshot();
  });
  ipcMain.handle("agent:reset", () => {
    runtime.resetActivation();
    return runtime.snapshot();
  });
  ipcMain.handle("agent:test-tally", () => runtime.testTally());
  ipcMain.handle("agent:sync-now", (_event, syncType) => runtime.sync(syncType || "SYNC_FULL"));
  ipcMain.handle("agent:open-logs", () => shell.openPath(app.getPath("userData")));
  ipcMain.handle("agent:get-config-file", () => path.join(app.getPath("userData"), "agent-config.json"));

  runtime.on("state", (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("agent:state", state);
    }
    if (tray) {
      tray.setToolTip(`FunnelHive Tally Connector\nFunnelHive: ${state.backend}\nTally: ${state.tally}`);
    }
  });

  const cfg = store.load();
  app.setLoginItemSettings({ openAtLogin: Boolean(cfg.autoStart) });
}

app.on("second-instance", () => {
  showMainWindow();
});

// User Model ID — required for Windows to group taskbar/notifications under
// the app rather than under generic "electron.exe".
if (process.platform === "win32") {
  app.setAppUserModelId("in.getaihive.tallyconnector");
}

app.whenReady().then(() => {
  const store = new ConfigStore();
  const backend = new BackendClient(() => store.load());
  const tally = new TallyClient(() => store.load());
  runtime = new AgentRuntime({ store, backend, tally });
  {
    const target = runtime.backendTarget();
    console.log(`[AgentRuntime] Backend: ${target.url} (${target.environment})`);
    if (target.warning) console.warn(`[AgentRuntime] WARNING: ${target.warning}`);
  }
  setupIpc(store);
  createTray();
  createMainWindow();
  if (store.load().agentToken) runtime.start();
});

app.on("activate", showMainWindow);

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
