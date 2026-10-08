import { createRoot } from "react-dom/client";
import { PluginsPanel } from "../../src/components/PluginsPanel";
import { StoreProvider } from "../../src/state/store";
import { applySkin, readSkin } from "../../src/lib/skins";
import "../../src/styles.css";

// The Plugins panel (MCP servers live in its Manage and detail pages).
applySkin(readSkin());
createRoot(document.getElementById("root")!).render(
  <StoreProvider><PluginsPanel /></StoreProvider>,
);
