// The foot's logos with the data an organization server really answers
// (2026-10-26, read on a live installation): its own MCP servers sit on MCP
// hosts with header auth (no sign-in state, so "connected"), one of them
// twice (once from a marketplace plugin), and the person's own apps (Gmail,
// Google Drive, Google Calendar) are connectors of their Claude account,
// a name and a status only. #1125 only lent catalog marks, and none of
// these apps is in the catalog: the foot drew three generic globes.
import { describe, expect, it } from "vitest";

import { connectedAppItems } from "./connected-apps";
import { buildPluginItems, providerMark } from "./plugins-model";

const servers = [
  { name: "twilio-docs", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio" },
  { name: "github", url: "https://api.githubcopilot.com/mcp/", enabled: true },
  { name: "github-github", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official" },
];
const account = [
  { name: "Docs", status: "connected" },
  { name: "Google Drive", status: "connected" },
  { name: "Gmail", status: "connected" },
  { name: "Google Calendar", status: "connected" },
  { name: "Canva", status: "needs_auth" },
];
const GENERIC = /s2\/favicons\?domain=(?:[a-z]+\.)*(?:googleapis|githubcopilot)\.com|mcp\.twilio\.com/;

describe("connected apps, real data shape", () => {
  const apps = connectedAppItems({ servers, featured: [], account });

  it("the person's own account apps come first, then the server's, one row per app", () => {
    expect(apps.map((app) => app.name)).toEqual(["Google Drive", "Gmail", "Google Calendar", "twilio-docs", "github", "Docs"]);
  });

  it("every app with a known mark draws it: the product logo or the provider's site, never the MCP host", () => {
    const byName = Object.fromEntries(apps.map((app) => [app.name, app]));
    expect(byName.Gmail!.logo).toMatch(/^https:\/\/ssl\.gstatic\.com\/images\/branding\/product\/2x\/gmail_/);
    expect(byName["Google Drive"]!.logo).toMatch(/\/drive_/);
    expect(byName["Google Calendar"]!.logo).toMatch(/\/calendar_/);
    expect(byName["twilio-docs"]!.domain).toBe("twilio.com");
    expect(byName.github!.domain).toBe("github.com");
    for (const app of apps) expect(`${app.logo ?? ""} ${app.domain ?? ""}`).not.toMatch(GENERIC);
  });

  it("an app with no mark at all keeps the generic fallback, after the ones that have one", () => {
    const last = apps.at(-1)!;
    expect(last.name).toBe("Docs");
    expect(last.logo ?? null).toBeNull();
    expect(last.domain ?? null).toBeNull();
  });

  it("a connector that needs a sign-in is not a connected app", () => {
    expect(apps.some((app) => app.name === "Canva")).toBe(false);
  });

  it("without the account's answer (not loaded yet, or an API key), the servers still show their logos", () => {
    const only = connectedAppItems({ servers, featured: [] });
    expect(only.map((app) => app.domain)).toEqual(["twilio.com", "github.com"]);
  });

  it("a catalog listing of the same app still lends its own logo first", () => {
    const withCatalog = connectedAppItems({
      servers: [],
      featured: [{ id: "canva", name: "Canva", description: "", url: "https://mcp.canva.com/mcp", domain: "mcp.canva.com", site: "canva.com", auth: "oauth", iconUrl: "https://cdn.example/canva.svg" }],
      account: [{ name: "Canva", status: "connected" }],
    });
    expect(withCatalog[0]!.logo).toBe("https://cdn.example/canva.svg");
  });
});

describe("providerMark", () => {
  it("maps MCP hosts to the provider's site", () => {
    expect(providerMark("anything", "https://mcp.linear.app/mcp").site).toBe("linear.app");
    expect(providerMark("anything", "https://docs.mcp.cloudflare.com/mcp").site).toBe("cloudflare.com");
    expect(providerMark("anything", "https://api.githubcopilot.com/mcp/").site).toBe("github.com");
    expect(providerMark("Gmail", "https://gmailmcp.googleapis.com/mcp").logo).toMatch(/gmail_/);
    expect(providerMark("custom", "https://tools.example.org/mcp").site).toBe("tools.example.org");
    expect(providerMark("Unknown app").site).toBeNull();
  });

  it("the panel's server rows carry the same mark (one resolution for both)", () => {
    const rows = buildPluginItems({ servers });
    expect(rows.find((row) => row.id === "twilio-docs")!.domain).toBe("twilio.com");
    expect(rows.find((row) => row.id === "github")!.domain).toBe("github.com");
  });
});
