import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  BROWSER_SIGN_IN_FAILED, previewBrowserSignIn, readSessionState, SERVICE_TRUST_REASON, takeBrowserSignInFromLocation, takePairingFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { bootstrapBrand } from "./lib/brand";
import { applySkin, readSkin } from "./lib/skins";
import { applyFont, readFont } from "./lib/fonts";
import { retireLegacyInterfaceMode } from "./lib/interface-mode";
import { BrowserSignInPage } from "./pair/BrowserSignInPage";
import { PairPage } from "./pair/PairPage";
import { rememberOpenThreadHash } from "./lib/open-thread-hash";
import { syncUserPreferences } from "./lib/user-preferences-sync";
import { installAnimationPause } from "./lib/animation-pause";
import { JoinPage, takeInviteTokenFromLocation } from "./pair/JoinPage";
import "katex/dist/katex.min.css";
import "./styles.css";

// Before the first paint, not inside a component: stamping the skin during
// render would show one frame of the default palette first. The brand (window
// title, accent) is fetched the same way so a white-labelled deployment never
// flashes the default name; it waits at most a moment and falls back silently.
// The detached Hibou 98 assistant window loads this bundle too, on its own
// query; it draws only the assistant (electron/retro-assistant-window.mjs).
const detachedAssistant = new URLSearchParams(location.search).get("omb-retro-assistant") === "1";
if (detachedAssistant) document.documentElement.dataset.retroDetached = "";
// A floating bot's desktop window loads it too, on its own query: it draws
// one bot and its balloon (electron/floating-bot-window.mjs).
const floatingBot = new URLSearchParams(location.search).get("omb-floating-bot") === "1";
if (floatingBot) document.documentElement.dataset.floatingBot = "";
// After the window flags, so a floating mascot or Hibou 98 is not paused
// just because its window is never the focused one.
installAnimationPause();

// Slice 7: an "Open in Sagax" link survives the sign-in (/pair, Perspicax).
rememberOpenThreadHash();

// The old always-on key is not a choice. Drop it before the first paint.
retireLegacyInterfaceMode();
applySkin(readSkin());
applyFont(readFont());

/** A pairing link lands on /pair. A remote browser without a session lands
 * there too, because every API call would otherwise fail with "pair this
 * device"; on the owner's own machine the server trusts loopback and this
 * check is a single fast request. */
async function chooseRoot(): Promise<React.ReactNode> {
  if (detachedAssistant) {
    const { DetachedAssistant } = await import("./components/retro-assistant/DetachedAssistant");
    return <DetachedAssistant />;
  }
  if (floatingBot) {
    const { FloatingBotWindow } = await import("./components/floating-bots/FloatingBotWindow");
    return <FloatingBotWindow />;
  }
  // An invite link works without a session: redeeming it is the sign-in.
  if (location.pathname === "/join") return <JoinPage initialToken={takeInviteTokenFromLocation()} />;
  if (location.pathname === "/pair") {
    // A browser sign-in link carries a one-time credential: whose server it is, then one Continue.
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const preview = await previewBrowserSignIn(signIn);
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={BROWSER_SIGN_IN_FAILED} />;
    }
    const pairing = takePairingFromLocation();
    return <PairPage initialCode={pairing.code} autoSubmit={pairing.auto} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  const session = await readSessionState();
  if (session.kind === "unauthenticated") return <PairPage initialCode={null} reason={session.error} />;
  // A service-trust server answers this machine's requests without a session
  // but refuses to let it manage anything: sign in first, as a remote browser would.
  if (session.kind === "loopback" && session.trust === "service") return <PairPage initialCode={null} reason={SERVICE_TRUST_REASON} />;
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  // A signed-in person on an organization server: their preferences come
  // from the server before the app draws (src/lib/user-preferences-sync.ts).
  if (session.kind === "session") {
    await syncUserPreferences();
    applySkin(readSkin());
    applyFont(readFont());
  }
  return <App />;
}

// A floating bot's window makes no request of its own: its texts arrive translated from the main page.
void Promise.all([floatingBot ? undefined : bootstrapBrand(), chooseRoot()]).then(([, root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode>{root}</StrictMode>);
});
