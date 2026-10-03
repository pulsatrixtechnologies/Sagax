// Injected before the renderer's first script (Page.addScriptToEvaluateOnNewDocument).
//
// The desktop app's own window gets the full `window.ogb` bridge from
// electron/preload.cjs. A plain browser tab gets none, and the renderer then
// behaves as a served page (another first-run flow, fewer Settings sections,
// "Browser" capabilities). To draw what the Electron window draws, this stub
// provides only the members that decide *which* UI is drawn, with the values
// a packaged macOS app reports:
//
//   platform            "darwin"                         (keyboard hints, dictation)
//   getCapabilities     electron/capabilities.cjs shape   (windowChrome "mac-inset")
//   onCapabilitiesChanged / remoteClient {active:false}  (the local desktop page)
//   setUnreadCount / applySkin                         no-ops (dock badge, Windows caption colour)
//
// Everything else stays absent, so each feature behind the bridge takes its
// "bridge unavailable" path exactly as on an older desktop build: nothing in
// this file paints anything. The macOS traffic lights are native and are not
// drawn here either; the renderer reserves their strip (the masks cover it).
//
// With `__PARITY_PRESET__.served` the bridge is the subset the desktop app
// gives a page another server serves (electron/preload.cjs REMOTE_SAFE: no
// remoteClient), which is how it draws an organization server; the renderer
// then takes its served-page paths (src/lib/desktop.ts servedPage).
//
// It also exposes `window.__parity` for the capture script: access to the
// renderer's store (found through React's fiber on the shell element) and
// localStorage presets (skin, sidebar density) passed in `__PARITY_PRESET__`.
(() => {
  const preset = window.__PARITY_PRESET__ || {};
  try {
    // Every capture starts from a clean device: nothing a previous capture
    // clicked (a panel width, a collapsed section) leaks into the next.
    if (preset.clear !== false) { localStorage.clear(); sessionStorage.clear(); }
    for (const [key, value] of Object.entries(preset.localStorage || {})) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  } catch { /* storage blocked: defaults apply */ }

  const capabilities = {
    remote: false,
    host: { platform: "darwin", label: "macOS", session: "aqua", packaged: true, homeDir: "/Users/parity" },
    windowChrome: "mac-inset",
    screenPreview: { available: false, interaction: "none", reasonCode: "permission-required" },
    dictation: { available: true, engine: "apple-speech", onDevice: true },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable", reasonCode: "unsupported-platform" },
  };
  const noop = () => {};
  window.ogb = {
    platform: "darwin",
    getCapabilities: () => Promise.resolve(capabilities),
    onCapabilitiesChanged: () => noop,
    remoteClient: {
      active: false,
      state: () => Promise.resolve({ active: false, endpoint: null }),
      pair: () => Promise.reject(new Error("parity stub")),
      disconnect: () => Promise.resolve(),
    },
    setUnreadCount: noop,
    applySkin: () => Promise.resolve(),
  };
  if (preset.served) delete window.ogb.remoteClient;

  // ── store access for the capture script ────────────────────────────────
  function fiberOf(el) {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return key ? el[key] : null;
  }
  function findStore() {
    let fiber = fiberOf(document.querySelector("[data-app-shell]"));
    while (fiber) {
      const value = fiber.memoizedProps && fiber.memoizedProps.value;
      if (value && typeof value === "object" && typeof value.dispatch === "function" && value.state && Array.isArray(value.state.bots)) {
        return value;
      }
      fiber = fiber.return;
    }
    return null;
  }
  window.__parity = {
    store: findStore,
    state: () => (findStore() || {}).state,
    dispatch: (action) => {
      const store = findStore();
      if (!store) throw new Error("store not mounted");
      store.dispatch(action);
      return true;
    },
  };
})();
