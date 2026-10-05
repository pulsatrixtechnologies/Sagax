import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmDialogCard } from "./ConfirmDialog";
import { connectionConfirmCopy, PersonConnectionsSection, revokeBody, type OrgPersonConnections } from "./PersonConnectionsSection";

const TOKEN = "t-secret-token-000";
const listing: OrgPersonConnections = {
  principalId: "pr_ada",
  paused: true,
  connections: [
    { kind: "github", state: "connected", login: "ada-gh", via: "device", createdAt: 1_700_000_000_000 },
    { kind: "mcp", name: "notes", mcpKind: "remote", detail: "mcp.example.test", createdAt: 1_700_000_100_000, enabled: true, auth: "token", lastUsedAt: 1_700_000_200_000 },
    { kind: "plugin", botId: "rex", botName: "Rex", key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", createdAt: 1_700_000_300_000, enabled: true },
  ],
};

describe("PersonConnectionsSection", () => {
  it("lists a person's connections for an admin and offers remove, with no secret", () => {
    const html = renderToStaticMarkup(createElement(PersonConnectionsSection, { principalId: "pr_ada", initial: listing }));
    expect(html).toContain('data-person-section="connections"');
    expect(html).toContain("Connections");
    expect(html).toContain("ada-gh");
    expect(html).toContain("notes");
    expect(html).toContain("mcp.example.test");
    expect(html).toContain("reviewer");
    expect(html).toContain("data-connections-paused");
    expect(html).toContain('data-connection-remove="notes"');
    expect(html).toContain('data-connection-remove="rex:reviewer@acme-tools"');
    expect(html).toContain("data-connection-remove-all");
    expect(html).toContain("Added");
    expect(html).toContain("Last used");
    expect(html).not.toContain(TOKEN);
  });

  it("says when there is nothing to remove", () => {
    const html = renderToStaticMarkup(createElement(PersonConnectionsSection, { principalId: "pr_ada", initial: { principalId: "pr_ada", paused: false, connections: [] } }));
    expect(html).toContain("No connections.");
    expect(html).not.toContain("data-connection-remove-all");
  });

  it("asks before removing one connection or all of them", () => {
    const one = connectionConfirmCopy({ kind: "mcp", name: "notes", label: "notes" });
    const html = renderToStaticMarkup(createElement(ConfirmDialogCard, { ...one, open: true, tone: "danger", onCancel: () => {}, onConfirm: () => {} }));
    expect(html).toContain("Remove this connection?");
    expect(html).toContain("notes will be disconnected.");
    expect(html).toContain("Remove");
    const all = connectionConfirmCopy({ all: true, label: "Remove all" });
    expect(all.title).toBe("Remove every connection?");
    expect(all.body).toContain("GitHub");
    expect(revokeBody({ all: true, label: "Remove all" })).toEqual({ all: true });
    expect(revokeBody({ kind: "plugin", botId: "rex", key: "reviewer@acme-tools", label: "reviewer" })).toEqual({ kind: "plugin", botId: "rex", key: "reviewer@acme-tools" });
    expect(revokeBody({ kind: "github", label: "ada-gh" })).toEqual({ kind: "github" });
  });
});
