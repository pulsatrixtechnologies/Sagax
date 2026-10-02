const { contextBridge, ipcRenderer } = require("electron");

// This loading page has no app bridge, credentials or file access. It can
// only ask main to close, open the log folder, or restart the app, and
// receive the startup phase or failure text to display.
contextBridge.exposeInMainWorld("startupScreen", {
  close: () => ipcRenderer.send("startup-screen:close"),
  openLogs: () => ipcRenderer.send("startup-screen:open-logs"),
  retry: () => ipcRenderer.send("startup-screen:retry"),
  onState: (listener) => {
    ipcRenderer.on("startup-screen:state", (_event, state) => listener({
      status: typeof state?.status === "string" ? state.status : null,
      problem: typeof state?.problem === "string" ? state.problem : null,
    }));
  },
});
