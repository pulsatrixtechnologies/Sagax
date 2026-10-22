import { describe, expect, it } from "vitest";

import {
  CLAUDE_AI_CONNECTORS_URL,
  chooseConnectorSetupRoute,
  claudeInventoryShowsConnected,
  connectorSetupEvidence,
  connectorSetupText,
  isConnectorSetupUrl,
  resolveConnectorSetupTarget,
  type ConnectorSetupView,
} from "./connector-setup.ts";
import { GROK_CONNECTORS_URL } from "./grok-cloud-connectors.ts";

describe("which connector the person named", () => {
  it("reads Teams in every usual spelling", () => {
    for (const name of ["Microsoft Teams", "teams", "MS Teams", "microsoft-teams", "  Teams  "]) {
      const target = resolveConnectorSetupTarget(name);
      expect(target?.id).toBe("microsoft-teams");
      expect(target?.label).toBe("Microsoft Teams");
      expect(target?.grok).toBe("microsoft-teams");
      expect(target?.composio).toBe("microsoft_teams");
    }
  });

  it("knows the Grok catalog and the usual Composio apps", () => {
    expect(resolveConnectorSetupTarget("Outlook")?.grok).toBe("outlook");
    expect(resolveConnectorSetupTarget("Exchange")?.id).toBe("outlook");
    expect(resolveConnectorSetupTarget("Gmail")?.composio).toBe("gmail");
    expect(resolveConnectorSetupTarget("Google Drive")?.grok).toBe("google-drive");
    expect(resolveConnectorSetupTarget("OneDrive")?.grok).toBe("onedrive");
    expect(resolveConnectorSetupTarget("SharePoint")?.grok).toBe("sharepoint");
    expect(resolveConnectorSetupTarget("Salesforce")?.grok).toBe("salesforce");
    expect(resolveConnectorSetupTarget("X")?.composio).toBe("twitter");
    expect(resolveConnectorSetupTarget("twitter")?.id).toBe("x");
    // not in Grok's catalog: Claude or Composio only
    const calendar = resolveConnectorSetupTarget("Google Calendar");
    expect(calendar?.grok).toBeUndefined();
    expect(calendar?.composio).toBe("googlecalendar");
  });

  it("keeps another app by its cleaned name, never an empty or a control-laden one", () => {
    expect(resolveConnectorSetupTarget("Notion")).toMatchObject({ id: "notion", label: "Notion", composio: "notion" });
    expect(resolveConnectorSetupTarget("")).toBeNull();
    expect(resolveConnectorSetupTarget("   ")).toBeNull();
    expect(resolveConnectorSetupTarget("5752d21c-e77c-4a83-84f0-66048216a5df")).toBeNull();
    expect(resolveConnectorSetupTarget("Teams 5752d21c-e77c-4a83-84f0-66048216a5df")).toBeNull();
    expect(resolveConnectorSetupTarget("a\u0000b")?.label).toBe("ab");
    expect(resolveConnectorSetupTarget("x".repeat(300))?.label.length).toBeLessThanOrEqual(60);
  });
});

describe("where the person signs in", () => {
  const teams = resolveConnectorSetupTarget("Teams")!;

  it("a Grok bot on the person's own xAI account: grok.com/connectors", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", composio: true })).toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
  });

  it("a Claude bot on the person's own subscription: claude.ai connectors", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "own", composio: true })).toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
  });

  it("an engine account that is someone else's is refused: no sign-in for another person's account", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "foreign", composio: true })).toEqual({ refusal: "foreign" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "foreign", composio: false })).toEqual({ refusal: "foreign" });
  });

  it("an engine with no connectors of its own falls back to Sagax's Connect apps when it knows the app", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "other", account: "none", composio: true })).toEqual({ route: "composio", slug: "microsoft_teams" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "none", composio: true })).toEqual({ route: "composio", slug: "microsoft_teams" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "other", account: "none", composio: false })).toEqual({ refusal: "no_route" });
  });

  it("a connector outside Grok's catalog on a Grok bot goes to Connect apps, or is refused", () => {
    const calendar = resolveConnectorSetupTarget("Google Calendar")!;
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "grok", account: "own", composio: true })).toEqual({ route: "composio", slug: "googlecalendar" });
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "grok", account: "own", composio: false })).toEqual({ refusal: "not_on_engine" });
  });

  it("a preferred route is honoured when it is possible", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", composio: true, prefer: "composio" })).toEqual({ route: "composio", slug: "microsoft_teams" });
    // a preference that cannot be met falls back to the engine's own
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", composio: false, prefer: "composio" })).toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
  });
});

describe("outbound links", () => {
  it("allows only grok.com and claude.ai over https", () => {
    expect(isConnectorSetupUrl(GROK_CONNECTORS_URL)).toBe(true);
    expect(isConnectorSetupUrl(CLAUDE_AI_CONNECTORS_URL)).toBe(true);
    expect(isConnectorSetupUrl("http://grok.com/connectors")).toBe(false);
    expect(isConnectorSetupUrl("https://grok.com.evil.example/connectors")).toBe(false);
    expect(isConnectorSetupUrl("https://user:pw@grok.com/connectors")).toBe(false);
    expect(isConnectorSetupUrl("javascript:alert(1)")).toBe(false);
    expect(isConnectorSetupUrl("not a url")).toBe(false);
  });
});

const view = (over: Partial<ConnectorSetupView> = {}): ConnectorSetupView => ({
  id: "cs_0123456789abcdef01",
  connector: "microsoft-teams",
  label: "Microsoft Teams",
  provider: "grok",
  url: GROK_CONNECTORS_URL,
  status: "waiting",
  owner: "0123456789abcdef",
  createdAt: 1_000,
  ...over,
});

describe("evidence that the connector works", () => {
  const call = (name: string, ok: boolean | undefined, at: number, input?: string) => ({ kind: "activity", at, tool: { name, ok, ...(input ? { input } : {}) } });

  it("a successful Grok call to that connector after the card is evidence", () => {
    expect(connectorSetupEvidence([call("microsoft_teams__list_chats", true, 2_000)], view())).toBe(true);
    expect(connectorSetupEvidence([call("use_tool", true, 2_000, JSON.stringify({ tool_name: "microsoft_teams__list_chats" }))], view())).toBe(true);
  });

  it("a failed call, an older call, or another connector is not", () => {
    expect(connectorSetupEvidence([call("microsoft_teams__list_chats", false, 2_000)], view())).toBe(false);
    expect(connectorSetupEvidence([call("microsoft_teams__list_chats", true, 500)], view())).toBe(false);
    expect(connectorSetupEvidence([call("outlook__list_mail", true, 2_000)], view())).toBe(false);
    expect(connectorSetupEvidence([], view())).toBe(false);
  });

  it("a Claude connector call reaching Teams is evidence for a Claude card", () => {
    const claude = view({ provider: "claude", url: CLAUDE_AI_CONNECTORS_URL });
    expect(connectorSetupEvidence([call("mcp__claude_ai_Microsoft_365__teams_list_chats", true, 2_000)], claude)).toBe(true);
    expect(connectorSetupEvidence([call("mcp__claude_ai_Gmail__search", true, 2_000)], claude)).toBe(false);
  });

  it("reads the claude.ai inventory: connected only, by the service it reaches", () => {
    const teams = resolveConnectorSetupTarget("Teams")!;
    expect(claudeInventoryShowsConnected([{ name: "Microsoft 365", status: "connected" }], teams)).toBe(true);
    expect(claudeInventoryShowsConnected([{ name: "Microsoft 365", status: "needs_auth" }], teams)).toBe(false);
    expect(claudeInventoryShowsConnected([{ name: "Gmail", status: "connected" }], teams)).toBe(false);
    expect(claudeInventoryShowsConnected([{ name: "Notion", status: "connected" }], resolveConnectorSetupTarget("notion")!)).toBe(true);
  });
});

describe("the card's own text", () => {
  it("says where to sign in, in the person's language, with the link for clients without the card", () => {
    expect(connectorSetupText(view(), "fr")).toBe("Connectez Microsoft Teams sur [grok.com](https://grok.com/connectors).");
    expect(connectorSetupText(view({ provider: "claude", url: CLAUDE_AI_CONNECTORS_URL }), "en")).toBe("Connect Microsoft Teams on [claude.ai](https://claude.ai/customize/connectors).");
  });

});
