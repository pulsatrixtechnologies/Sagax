import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { OrgMemoryBridge, OrgMemoryState } from "@/lib/org-memory";

vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => null }));
import { OrgMemoryPanel, OrgMemorySettings } from "./OrgMemorySettings";

const state = (over: Partial<OrgMemoryState> = {}): OrgMemoryState => ({
  connected: true,
  server: "https://px.example.com",
  vault: "/Users/jc/Library/Application Support/sagax/org-memory/vault",
  cloned: true,
  obsidianConfigured: false,
  obsidianUrl: "obsidian://open?path=%2Fvault",
  cloudFolder: null,
  busy: false,
  tiers: [
    { name: "me", label: "Moi", push: "direct", status: "pushed", messages: [] },
    { name: "org", label: "Organisation", push: "review", status: "refused", messages: ["notes.txt is not a memory path"] },
  ],
  pending: [{ id: "01k9", tier: "org", title: "Onboarding", state: "pending", path: "org/_pending/01k9.md", edit_of: "01k8" }],
  pendingCount: 1,
  lastSyncAt: 1_760_000_000_000,
  lastError: null,
  ...over,
});

const bridge = (): OrgMemoryBridge => ({
  state: vi.fn(async () => state()),
  connect: vi.fn(async () => state()),
  sync: vi.fn(async () => state()),
  erase: vi.fn(async () => state({ connected: false, cloned: false, tiers: [], pending: [], pendingCount: 0 })),
  writeObsidianConfig: vi.fn(async () => state({ obsidianConfigured: true })),
  openInObsidian: vi.fn(async () => true),
});

describe("Settings > Memory", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the address and the token while disconnected", () => {
    const html = renderToStaticMarkup(createElement(OrgMemoryPanel, { bridge: bridge(), issuer: "https://px.example.com/", initial: state({ connected: false, cloned: false, tiers: [], pending: [], pendingCount: 0 }) }));
    expect(html).toContain("Perspicax address");
    expect(html).toContain("Memory sync token");
    expect(html).toContain("https://px.example.com");
    expect(html).toContain("type=\"password\"");
    expect(html).not.toContain("Open in Obsidian");
  });

  it("shows the sync, the pending items, the tiers and the Obsidian actions once synced", () => {
    const html = renderToStaticMarkup(createElement(OrgMemoryPanel, { bridge: bridge(), issuer: null, initial: state() }));
    expect(html).toContain("Sync now");
    expect(html).toContain("1 pending");
    expect(html).toContain("Onboarding");
    expect(html).toContain("refused by Perspicax");
    expect(html).toContain("notes.txt is not a memory path");
    expect(html).toContain("Add the recommended settings");
    expect(html).toContain("Open in Obsidian");
    expect(html).toContain("Erase the local copy");
    expect(html).toContain("Application Support");
  });

  it("warns when the vault sits in a cloud folder and after an access ended", () => {
    const html = renderToStaticMarkup(createElement(OrgMemoryPanel, { bridge: bridge(), issuer: null, initial: state({ connected: false, cloudFolder: "iCloud Drive", lastError: "Perspicax refused the memory sync token" }) }));
    expect(html).toContain("iCloud Drive");
    expect(html).toContain("Perspicax refused the memory sync token");
  });

  it("says the cache is the desktop app's outside it", () => {
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(OrgMemorySettings));
    expect(html).toContain("desktop app");
  });
});
