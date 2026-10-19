import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setEmailGateDone } from "../../src/lib/analytics";
import { applySkin, readSkin } from "../../src/lib/skins";
import { installOverlayScrollbars } from "../../src/lib/overlay-scrollbars";
import "../../src/styles.css";

// This entry point is served only by the disposable verification launcher.
// Analytics are a no-op since PostHog was removed.
if (!new URLSearchParams(location.search).has("onboarding")) setEmailGateDone("skipped");
applySkin(readSkin());
// Same overlay scrollbars as src/main.tsx.
installOverlayScrollbars();
createRoot(document.getElementById("root")!).render(<App />);
