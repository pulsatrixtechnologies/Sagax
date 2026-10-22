import { describe, expect, it } from "vitest";

import {
  capabilityRoutes,
  claudeAiConnectorCapabilities,
  connectorWriteKind,
  engineConnectorOffers,
  grokConnectorCapabilities,
} from "./engine-connectors.ts";
import { GROK_CLOUD_CONNECTORS } from "./grok-cloud-connectors.ts";

const M365 = "mcp__claude_ai_Microsoft_365__";

describe("what each engine's connectors reach", () => {
  it("reads the claude.ai connectors by name", () => {
    expect(claudeAiConnectorCapabilities("Microsoft 365")).toEqual(["mail", "calendar", "teams", "sharepoint", "files"]);
    expect(claudeAiConnectorCapabilities("Gmail")).toEqual(["mail"]);
    expect(claudeAiConnectorCapabilities("Google Calendar")).toEqual(["calendar"]);
    expect(claudeAiConnectorCapabilities("Google Drive")).toEqual(["files"]);
    expect(claudeAiConnectorCapabilities("GitHub")).toEqual([]);
  });

  it("reads every Grok cloud connector by id", () => {
    expect(grokConnectorCapabilities("outlook")).toEqual(["mail", "calendar"]);
    expect(grokConnectorCapabilities("microsoft-teams")).toEqual(["teams"]);
    expect(grokConnectorCapabilities("sharepoint")).toEqual(["sharepoint", "files"]);
    expect(grokConnectorCapabilities("x")).toEqual([]);
    // every catalog entry is known to the table (no silent gap)
    for (const connector of GROK_CLOUD_CONNECTORS) expect(grokConnectorCapabilities(connector.id)).toBeDefined();
  });

  it("lists, per capability, the engine and connector that reach it; a connector that needs sign-in still counts", () => {
    const offers = engineConnectorOffers({
      claude: [{ name: "Microsoft 365", status: "needs_auth" }, { name: "GitHub", status: "connected" }],
      grok: true,
    });
    expect(offers.map((offer) => `${offer.engine}:${offer.connector}`)).toEqual([
      "claude:Microsoft 365",
      "grok:Outlook (Exchange)",
      "grok:Microsoft Teams",
      "grok:Gmail",
      "grok:Google Drive",
      "grok:OneDrive",
      "grok:SharePoint",
    ]);
    const routes = capabilityRoutes(offers);
    expect(routes.teams.map((route) => `${route.engine}:${route.connector}`)).toEqual(["claude:Microsoft 365", "grok:Microsoft Teams"]);
    expect(routes.sharepoint.map((route) => route.engine)).toEqual(["claude", "grok"]);
  });

  it("offers nothing without a Claude connector or a Grok engine", () => {
    const routes = capabilityRoutes(engineConnectorOffers({ claude: [], grok: false }));
    expect(Object.values(routes).every((list) => list.length === 0)).toBe(true);
  });
});

describe("connector calls that act outside the app", () => {
  it.each([
    ["outlook_send_mail", "mail-send"],
    ["outlook_send_draft", "mail-send"],
    ["outlook_forward_mail", "mail-send"],
    ["outlook_set_vacation", "mail-auto-reply"],
    ["teams_send_chat_message", "teams-post"],
    ["teams_send_channel_message", "teams-post"],
    ["teams_reply_channel_message", "teams-post"],
    ["teams_create_chat", "teams-chat"],
    ["outlook_create_event", "calendar-invite"],
    ["outlook_update_event", "calendar-invite"],
    ["outlook_delete_event", "calendar-cancel"],
    ["outlook_respond_to_event", "calendar-respond"],
    ["sharepoint_upload_file", "files-write"],
    ["sharepoint_update_file", "files-write"],
    ["sharepoint_create_folder", "files-write"],
    ["sharepoint_move_item", "files-write"],
    ["sharepoint_rename_item", "files-write"],
    ["sharepoint_copy_item", "files-write"],
    ["sharepoint_delete_item", "files-write"],
  ])("Microsoft 365 %s is %s", (tool, kind) => {
    expect(connectorWriteKind(`${M365}${tool}`)).toBe(kind);
  });

  it.each([
    "outlook_email_search",
    "outlook_calendar_search",
    "outlook_find_available_time",
    "find_meeting_availability",
    "outlook_create_draft",
    "outlook_update_draft",
    "outlook_create_reply_draft",
    "teams_list_chats",
    "teams_list_channel_messages",
    "sharepoint_search",
    "sharepoint_folder_search",
    "read_resource",
  ])("Microsoft 365 %s only reads or drafts", (tool) => {
    expect(connectorWriteKind(`${M365}${tool}`)).toBeNull();
  });

  it("reads a Grok cloud connector's own names and Google Calendar the same way", () => {
    expect(connectorWriteKind("outlook__send_email")).toBe("mail-send");
    expect(connectorWriteKind("microsoft_teams__post_message")).toBe("teams-post");
    expect(connectorWriteKind("sharepoint__upload_file")).toBe("files-write");
    expect(connectorWriteKind("onedrive__delete_file")).toBe("files-write");
    expect(connectorWriteKind("mcp__claude_ai_Google_Calendar__create_event")).toBe("calendar-invite");
    expect(connectorWriteKind("mcp__claude_ai_Google_Calendar__list_events")).toBeNull();
  });

  it("leaves other servers' tools alone", () => {
    expect(connectorWriteKind("mcp__analytics__create_event")).toBeNull();
    expect(connectorWriteKind("mcp__files__upload_file")).toBeNull();
    expect(connectorWriteKind("Write")).toBeNull();
    expect(connectorWriteKind("")).toBeNull();
  });
});
