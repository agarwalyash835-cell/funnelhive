const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tallyAgent", {
  getState: () => ipcRenderer.invoke("agent:get-state"),
  activate: (input) => ipcRenderer.invoke("agent:activate", input),
  saveSettings: (input) => ipcRenderer.invoke("agent:save-settings", input),
  start: () => ipcRenderer.invoke("agent:start"),
  stop: () => ipcRenderer.invoke("agent:stop"),
  reset: () => ipcRenderer.invoke("agent:reset"),
  testTally: () => ipcRenderer.invoke("agent:test-tally"),
  syncNow: (syncType) => ipcRenderer.invoke("agent:sync-now", syncType),
  openLogs: () => ipcRenderer.invoke("agent:open-logs"),
  getConfigFile: () => ipcRenderer.invoke("agent:get-config-file"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("agent:state", listener);
    return () => ipcRenderer.removeListener("agent:state", listener);
  },
});
