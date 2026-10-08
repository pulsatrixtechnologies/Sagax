import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// How long the loading screen spins before it admits startup is stuck and
// offers "Open logs" and "Retry". Startup continues underneath.
export const STARTUP_STALL_MS = 90_000;
export const STALL_MESSAGE =
  "Sagax is taking longer than usual to start its local server. The logs say what it is waiting for. Retry restarts Sagax.";

export function startupScreenHtml(iconPath) {
  const icon = fs.readFileSync(iconPath).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Sagax</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Segoe UI,system-ui,sans-serif;color:#f5f5f5;background:transparent}
  main{height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #ffffff16;border-radius:20px;background:radial-gradient(ellipse at 50% 22%,#242529 0,#161719 54%,#111214 100%);-webkit-app-region:drag}
  img{width:74px;height:74px;object-fit:contain;margin-bottom:18px;user-select:none;-webkit-user-drag:none}
  h1{font-size:25px;line-height:1.25;font-weight:600;letter-spacing:-.6px;margin:0 0 26px}
  .status{display:flex;align-items:center;gap:9px;color:#999da5;font-size:12px;line-height:18px}
  .spinner{width:13px;height:13px;border-radius:50%;border:1.5px solid #ffffff21;border-top-color:#a6c9ff;animation:spin .9s linear infinite}
  button{position:absolute;right:13px;top:13px;width:30px;height:30px;display:grid;place-items:center;padding:0;color:#999da5;border:0;border-radius:7px;background:transparent;cursor:pointer;-webkit-app-region:no-drag}
  button:hover{color:#fff;background:#ffffff10}button:focus-visible{outline:2px solid #1686ff;outline-offset:2px}button svg{pointer-events:none}
  .problem{display:none;flex-direction:column;align-items:center;gap:12px;max-width:340px;text-align:center;-webkit-app-region:no-drag}
  .problem p{margin:0;color:#c9ccd2;font-size:12px;line-height:18px}
  .actions{display:flex;gap:8px}.actions button{position:static;width:auto;height:auto;padding:6px 12px;color:#f5f5f5;border:1px solid #ffffff26;background:#ffffff0d;font:inherit;font-size:12px}
  main.failed .status{display:none}main.failed .problem{display:flex}
  @keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none;border-color:#a6c9ff}}
  </style></head><body><main><button aria-label="Close" onclick="window.startupScreen.close()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><img src="data:image/png;base64,${icon}" alt=""><h1>Sagax</h1><div class="status" role="status"><span class="spinner" aria-hidden="true"></span><span id="status-text">Opening your workspace…</span></div><div class="problem" role="alert"><p id="problem-text"></p><div class="actions"><button type="button" id="open-logs" onclick="window.startupScreen.openLogs()">Open logs</button><button type="button" id="retry" onclick="window.startupScreen.retry()">Retry</button></div></div></main><script>
  window.startupScreen.onState(state => {
    const main = document.querySelector('main');
    if (state.status) document.getElementById('status-text').textContent = state.status;
    if (state.problem) { document.getElementById('problem-text').textContent = state.problem; main.classList.add('failed'); }
  });
  </script></body></html>`;
}

export function createStartupScreen({
  BrowserWindow, iconPath, platform = process.platform, isQuitting, onQuit,
  onHide, isHidden = () => false, onShow, onFinished,
  onOpenLogs, onRetry, stallAfterMs = STARTUP_STALL_MS,
}) {
  let disposed = false, revealed = false, fallback, stall, resolveReady;
  let state = { status: null, problem: null };
  const publish = () => {
    if (disposed || splash.isDestroyed() || splash.webContents.isDestroyed?.()) return;
    try { splash.webContents.send("startup-screen:state", state); } catch {}
  };
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const splash = new BrowserWindow({
    width: 440, height: 300, resizable: false, maximizable: false,
    fullscreenable: false, frame: false, transparent: true,
    backgroundColor: "#00000000", show: false, icon: iconPath,
    title: "Sagax", autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: fileURLToPath(new URL("./startup-screen-preload.cjs", import.meta.url)),
    },
  });
  splash.setMenu(null);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fallback);
    clearTimeout(stall);
    resolveReady();
    if (!splash.isDestroyed()) splash.destroy();
    onFinished?.();
  };
  splash.on("close", event => {
    if (disposed || isQuitting()) return;
    event.preventDefault();
    if (platform === "win32" && onHide) onHide(splash);
    else onQuit();
  });
  // Renderer window.close() bypasses BrowserWindow's cancellable close path.
  // This dedicated, unprivileged bridge requests the native path instead.
  splash.webContents.on("ipc-message", (_event, channel) => {
    if (disposed) return;
    if (channel === "startup-screen:close") splash.close();
    else if (channel === "startup-screen:open-logs") onOpenLogs?.();
    else if (channel === "startup-screen:retry") onRetry?.();
  });
  // The page may load after main already reported a phase or a failure.
  splash.webContents.on("did-finish-load", publish);
  let shown = false;
  const showSplash = () => {
    if (shown || disposed || isQuitting()) return;
    shown = true; splash.show(); resolveReady();
    // A spinner is never the only thing a person sees for long: if no
    // workspace window takes over in time, say so and offer a way out,
    // while startup keeps going underneath (it may still succeed).
    stall = setTimeout(() => fail(STALL_MESSAGE), stallAfterMs);
    stall.unref?.();
  };
  splash.once("ready-to-show", showSplash);
  // Some Wayland compositors (COSMIC) never paint a hidden window, so
  // ready-to-show never comes. Show the loaded page after a short grace.
  splash.webContents.once("did-finish-load", () => {
    const grace = setTimeout(showSplash, 500);
    grace.unref?.();
  });
  splash.on("show", () => onShow?.(splash));
  splash.once("closed", resolveReady);
  // Server startup waits on ready. A failed loading renderer must not keep
  // it from ever reaching the main window's own bounded recovery path. The
  // splash stays until that window replaces it: it can be the app's only
  // window, and destroying it then quits the app (window-all-closed).
  splash.webContents.once("render-process-gone", resolveReady);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml(iconPath)))
    .catch(resolveReady);
  const setStatus = (status) => { state = { ...state, status: String(status) }; publish(); };
  const fail = (problem) => {
    if (disposed) return;
    clearTimeout(stall);
    state = { ...state, problem: String(problem) };
    publish();
  };
  const attach = (win, { maximized = false } = {}) => {
    clearTimeout(stall);
    const reveal = () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      revealed = true;
      const minimized = !splash.isDestroyed() && splash.isMinimized();
      if (isHidden()) {
        win.setSkipTaskbar(true);
        win.hide();
        if (maximized) win.once("show", () => win.maximize());
      } else {
        if (maximized) win.maximize();
        if (minimized) { win.showInactive(); win.minimize(); }
        else { win.show(); win.focus(); }
      }
      dispose();
    };
    // React must mount before the loading window gives way to the workspace.
    // Error pages have no React root and can be shown immediately.
    win.webContents.on("did-finish-load", () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      void win.webContents.executeJavaScript(`new Promise(resolve => {
        const root = document.getElementById('root');
        if (!root || root.childElementCount) { resolve(); return; }
        const observer = new MutationObserver(() => {
          if (root.childElementCount) { observer.disconnect(); resolve(); }
        });
        observer.observe(root, { childList: true });
      })`).then(reveal).catch(reveal);
    });
    win.webContents.once("render-process-gone", reveal);
    win.once("show", () => { if (!revealed) { revealed = true; dispose(); } });
    win.once("closed", dispose);
    // Preserve a bounded recovery path if the renderer fails to mount.
    fallback = setTimeout(reveal, 10_000);
    fallback.unref?.();
  };
  return { ready, attach, dispose, setStatus, fail, window: splash };
}
