// Preload for the detached Hibou 98 assistant window (retro-assistant-window.mjs).
// Sandboxed and context-isolated: the page sees only this narrow surface to
// move its own window, size it to the balloon, let clicks through where it is
// transparent, and trade plain messages with the main app window through
// main. Nothing here reaches files, the network, or other windows directly.
const { contextBridge, ipcRenderer } = require("electron");

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

contextBridge.exposeInMainWorld("retroAssistantWindow", {
  moveBy: (dx, dy) => ipcRenderer.invoke("retro-assistant:move-by", { dx: finite(dx), dy: finite(dy) }),
  moved: () => ipcRenderer.send("retro-assistant:moved"),
  getPosition: () => ipcRenderer.invoke("retro-assistant:get-position"),
  resize: (width, height) => ipcRenderer.invoke("retro-assistant:resize", { width: finite(width), height: finite(height) }),
  setInteractive: (on) => ipcRenderer.send("retro-assistant:set-interactive", on === true),
  setFocusable: (on) => ipcRenderer.send("retro-assistant:set-focusable", on === true),
  send: (event) => ipcRenderer.send("retro-assistant:event", event),
  ready: () => ipcRenderer.send("retro-assistant:ready"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("retro-assistant:state", handler);
    return () => ipcRenderer.removeListener("retro-assistant:state", handler);
  },
});
