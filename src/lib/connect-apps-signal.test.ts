// When the Connect apps pill shows (src/lib/connect-apps-signal.ts): only
// when the latest turn needed an app that is not connected.
import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { mainSections, type PluginItem } from "@/lib/plugins-model";
import { neededApps } from "./connect-apps-signal";

let seq = 0;
const ask = (text = "Send the report by mail"): Message => ({ id: `m${++seq}`, role: "user", kind: "text", text, at: seq });
const said = (text: string): Message => ({ id: `m${++seq}`, role: "bot", kind: "text", text, at: seq });
const call = (name: string, ok: boolean | undefined, output = "", input = ""): Message =>
  ({ id: `m${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name, ok, output, input } });
const card = (slug: string, label: string, status: "required" | "authorizing" | "connected" | "failed", dismissed = false): Message =>
  ({ id: `m${++seq}`, role: "bot", kind: "connector", at: seq, connector: { slug, label, description: "", status, resumeKey: "k", ...(dismissed ? { dismissed } : {}) } });

describe("the Connect apps signal", () => {
  it("names the app of a connected-app call refused for a missing connection", () => {
    const messages = [ask(), call("mcp__connectors__GMAIL_SEND_EMAIL", false, "Error: No connected account found for toolkit gmail"), said("I can't reach Gmail.")];
    expect(neededApps(messages)).toEqual([{ slug: "gmail" }]);
  });

  it("reads the apps an executor call named", () => {
    const input = JSON.stringify({ tools: [{ tool_slug: "NOTION_CREATE_PAGE" }, { tool_slug: "GOOGLEDRIVE_UPLOAD_FILE" }] });
    const messages = [ask(), call("COMPOSIO_MULTI_EXECUTE_TOOL", false, "connection required for notion, googledrive", input)];
    expect(neededApps(messages).map((app) => app.slug)).toEqual(["notion", "googledrive"]);
  });

  it("stays quiet for a call that failed for another reason, a call that worked, or a waiting card", () => {
    expect(neededApps([ask(), call("GMAIL_SEND_EMAIL", false, "Rate limit exceeded")])).toEqual([]);
    expect(neededApps([ask(), call("GMAIL_SEND_EMAIL", true, "not connected? no, sent")])).toEqual([]);
    expect(neededApps([ask(), call("shell", false, "not connected to the network")])).toEqual([]);
    expect(neededApps([ask(), card("gmail", "Gmail", "required")])).toEqual([]);
  });

  it("names a connection card that failed or was set aside, with its label", () => {
    expect(neededApps([ask(), card("notion", "Notion", "failed"), card("gmail", "Gmail", "required", true)]))
      .toEqual([{ slug: "notion", label: "Notion" }, { slug: "gmail", label: "Gmail" }]);
  });

  it("only reads the latest turn, never while it runs, and drops connected apps", () => {
    const earlier = [ask(), call("GMAIL_SEND_EMAIL", false, "not connected")];
    expect(neededApps([...earlier, ask("thanks")])).toEqual([]);
    expect(neededApps(earlier, { busy: true })).toEqual([]);
    expect(neededApps(earlier, { connected: (slug) => slug === "gmail" })).toEqual([]);
    expect(neededApps([...earlier, card("gmail", "Gmail", "connected")])).toEqual([]);
    expect(neededApps([])).toEqual([]);
  });
});

describe("Connect apps opened on the apps a conversation needs", () => {
  const item = (id: string, name: string, extra: Partial<PluginItem> = {}): PluginItem => ({
    key: `app:${id}`, kind: "app", id, name, description: "", category: "communication", installed: false,
    status: "available", action: "connect", source: "composio", ...extra,
  });
  const items = [item("gmail", "Gmail"), item("notion", "Notion", { category: "productivity" }), item("slack", "Slack", { recommended: true })];

  it("shows them first, in the order the pill named them", () => {
    const sections = mainSections(items, "", "all", "any", [], ["notion", "gmail"]);
    expect(sections[0]).toMatchObject({ id: "needed" });
    expect(sections[0].items.map((entry) => entry.id)).toEqual(["notion", "gmail"]);
  });

  it("adds no section without them, or with a search", () => {
    expect(mainSections(items, "", "all").some((section) => section.id === "needed")).toBe(false);
    expect(mainSections(items, "gm", "all", "any", [], ["gmail"]).map((section) => section.id)).toEqual(["results"]);
  });
});
