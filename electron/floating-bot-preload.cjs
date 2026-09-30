// Preload for a floating bot window (floating-bot-window.mjs). Sandboxed and
// context-isolated: the page sees only this narrow surface to move its own
// window, size it to the balloon, let clicks through where it is transparent,
// and trade plain messages with the main app window through main. It holds no
// token and reaches no file, no network and no other window directly. It does
// not even know which bot it draws: main answers for that.
const { contextBridge, ipcRenderer } = require("electron");

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

contextBridge.exposeInMainWorld("floatingBotWindow", {
  moveBy: (dx, dy) => ipcRenderer.invoke("floating-bots:move-by", { dx: finite(dx), dy: finite(dy) }),
  moved: () => ipcRenderer.send("floating-bots:moved"),
  resize: (width, height) => ipcRenderer.invoke("floating-bots:resize", { width: finite(width), height: finite(height) }),
  setInteractive: (on) => ipcRenderer.send("floating-bots:set-interactive", on === true),
  setFocusable: (on) => ipcRenderer.send("floating-bots:set-focusable", on === true),
  send: (event) => ipcRenderer.send("floating-bots:event", event),
  ready: () => ipcRenderer.send("floating-bots:ready"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("floating-bot:state", handler);
    return () => ipcRenderer.removeListener("floating-bot:state", handler);
  },
});
