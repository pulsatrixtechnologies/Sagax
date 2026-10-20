// What a bot's engine may ask of the person's own Chrome over DevTools (My
// Chrome). Pure: server/browser/my-chrome/gate.ts applies it to every message.
//
// The engine (agent-browser) speaks to the gate as if it were Chrome. The gate
// lets through what driving a tab needs (pages, the DOM, input, the
// accessibility tree, screenshots) and refuses what reads outside the tab's
// own site: every cookie call, storage of any origin, the browser's other
// tabs, contexts, downloads, file uploads, permissions, autofill and the
// browser itself. Unknown methods are refused: a new Chrome method is closed
// until someone reviews it.

/** Methods with no session (the browser target). Target calls are further
 * checked by the gate against the tabs the bot opened. */
const BROWSER_METHODS: ReadonlySet<string> = new Set([
  "Browser.getVersion",
  "Schema.getDomains",
  "Target.setDiscoverTargets",
  "Target.getTargets",
  "Target.getTargetInfo",
  "Target.attachToTarget",
  "Target.detachFromTarget",
  "Target.createTarget",
  "Target.closeTarget",
  "Target.activateTarget",
]);

/** Domains a tab's session may use whole. */
const SESSION_DOMAINS: ReadonlySet<string> = new Set([
  "Accessibility", "Animation", "Console", "CSS", "DOM", "DOMDebugger", "DOMSnapshot", "Emulation", "Input",
  "Inspector", "IO", "LayerTree", "Log", "Media", "Overlay", "Page", "Performance", "PerformanceTimeline",
  "Runtime", "Schema",
]);

/** Methods of an allowed domain that read or write outside the tab, or reach
 * the person's files. */
const SESSION_DENIED: ReadonlySet<string> = new Set([
  "Page.getCookies", "Page.getResourceContent", "Page.searchInResource", "Page.crash", "Page.setDownloadBehavior",
  "Page.getAppManifest", "Page.getInstallabilityErrors", "Page.setSPCTransactionMode", "Page.setRPHRegistrationMode",
  "Page.generateTestReport", "Page.setWebLifecycleState", "Page.produceCompilationCache",
  "DOM.setFileInputFiles", "DOM.getFileInfo",
  "Emulation.setAutoDarkModeOverride", "Emulation.setDisabledImageTypes",
  "Input.dispatchDragEvent",
]);

/** The Network calls a tab may make: switching events on and shaping its own
 * requests. Every cookie, body and interception call stays closed. */
const NETWORK_ALLOWED: ReadonlySet<string> = new Set([
  "Network.enable", "Network.disable", "Network.setExtraHTTPHeaders", "Network.setUserAgentOverride",
  "Network.setBlockedURLs", "Network.emulateNetworkConditions", "Network.setCacheDisabled",
  "Network.setBypassServiceWorker", "Network.setAttachDebugStack",
]);

/** Target calls inside a tab's session: auto-attaching its frames and workers
 * (which the gate then filters by site) and letting a held one run. */
const SESSION_TARGET: ReadonlySet<string> = new Set(["Target.setAutoAttach", "Target.detachFromTarget"]);

export type CdpVerdict = { allow: true } | { allow: false; reason: string };

const REFUSED = (method: string): CdpVerdict => ({ allow: false, reason: `Sagax refuses ${method} in My Chrome.` });

/** Whether a method may reach Chrome, before the gate checks targets and URLs. */
export function cdpMethodVerdict(method: string, inSession: boolean): CdpVerdict {
  if (typeof method !== "string" || !/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) return REFUSED(String(method));
  if (!inSession) return BROWSER_METHODS.has(method) ? { allow: true } : REFUSED(method);
  const domain = method.slice(0, method.indexOf("."));
  if (domain === "Network") return NETWORK_ALLOWED.has(method) ? { allow: true } : REFUSED(method);
  if (domain === "Target") return SESSION_TARGET.has(method) ? { allow: true } : REFUSED(method);
  if (!SESSION_DOMAINS.has(domain) || SESSION_DENIED.has(method)) return REFUSED(method);
  return { allow: true };
}

/** Network events a tab's session may see, with every header, cookie and
 * body taken out. Null: the event is dropped. Cookies of another site travel
 * in request and response headers (the ExtraInfo events carry them raw), so
 * those never reach the engine. */
export function sanitizeNetworkEvent(method: string, params: Record<string, unknown>): Record<string, unknown> | null {
  if (!["Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished", "Network.loadingFailed",
    "Network.dataReceived", "Network.requestServedFromCache"].includes(method)) return null;
  const copy: Record<string, unknown> = { ...params };
  if (copy.request && typeof copy.request === "object") {
    const { headers: _h, postData: _p, postDataEntries: _e, hasPostData: _hp, ...request } = copy.request as Record<string, unknown>;
    copy.request = { ...request, headers: {} };
  }
  for (const key of ["response", "redirectResponse"]) {
    if (copy[key] && typeof copy[key] === "object") {
      const { headers: _h, headersText: _t, requestHeaders: _r, requestHeadersText: _rt, securityDetails: _s, ...response } = copy[key] as Record<string, unknown>;
      copy[key] = { ...response, headers: {} };
    }
  }
  delete copy.associatedCookies;
  return copy;
}

/** An event of a tab's session the engine may see (Network goes through
 * sanitizeNetworkEvent; Fetch belongs to the gate). */
export function sessionEventAllowed(method: string): boolean {
  const domain = method.slice(0, method.indexOf("."));
  if (domain === "Fetch" || domain === "Storage" || domain === "Audits" || domain === "Security") return false;
  return true;
}
