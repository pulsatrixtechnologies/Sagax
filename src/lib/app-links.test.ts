import { afterEach, describe, expect, it, vi } from "vitest";

import { GROK_CONNECTORS_URL } from "../../shared/grok-cloud-connectors";
import { openExternalLink } from "./app-links";

afterEach(() => vi.unstubAllGlobals());

describe("openExternalLink (Manage on Grok, Connect cards)", () => {
  it("desktop: hands the link to the default browser through the bridge", async () => {
    const openExternal = vi.fn(async () => true);
    const open = vi.fn();
    vi.stubGlobal("window", { ogb: { openExternal }, open });
    await openExternalLink(GROK_CONNECTORS_URL);
    expect(openExternal).toHaveBeenCalledWith(GROK_CONNECTORS_URL);
    expect(open).not.toHaveBeenCalled();
  });

  it("web: a new tab, without opener", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    await openExternalLink(GROK_CONNECTORS_URL);
    expect(open).toHaveBeenCalledWith(GROK_CONNECTORS_URL, "_blank", "noopener,noreferrer");
  });

  it("desktop bridge refused (a page the main process does not trust for it): falls back to the window's own link path", async () => {
    const openExternal = vi.fn(async () => { throw new Error("desktop:open-external is only available in this app's own window"); });
    const open = vi.fn();
    vi.stubGlobal("window", { ogb: { openExternal }, open });
    await openExternalLink(GROK_CONNECTORS_URL);
    expect(open).toHaveBeenCalledWith(GROK_CONNECTORS_URL, "_blank", "noopener,noreferrer");
  });
});
