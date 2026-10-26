import { describe, expect, it } from "vitest";

import { OUTBOUND_DEFAULT_CAP, isOutboundTool, normalizeOutboundPolicy } from "./outbound.ts";

describe("isOutboundTool", () => {
  it("flags tools that send, reply, post, publish, invite, share, or move money", () => {
    for (const name of [
      "GMAIL_SEND_EMAIL",
      "GMAIL_SEND_DRAFT",
      "GMAIL_REPLY_TO_THREAD",
      "SLACK_SEND_MESSAGE",
      "SLACK_CHAT_POST_MESSAGE",
      "TWITTER_CREATION_OF_A_POST",
      "LINKEDIN_CREATE_LINKED_IN_POST",
      "STRIPE_CREATE_REFUND",
      "GITHUB_CREATE_AN_ISSUE_COMMENT",
      "HUBSPOT_SEND_EMAIL",
      "GOOGLECALENDAR_INVITE_ATTENDEES",
      "mcp__composio__WHATSAPP_SEND_MESSAGE",
      "mcp__claude_ai_Gmail__send_message",
      "mcp__claude_ai_Gmail__reply",
      "mcp__claude_ai_Gmail__forward",
      "mcp__claude_ai_Slack__slack_send_message",
    ]) {
      expect(isOutboundTool(name), name).toBe(true);
    }
  });

  it("leaves reading, searching, drafting, and internal record-keeping alone", () => {
    for (const name of [
      "GMAIL_FETCH_EMAILS",
      "GMAIL_LIST_THREADS",
      "GMAIL_CREATE_EMAIL_DRAFT",
      "SLACK_SEARCH_MESSAGES",
      "REDDIT_GET_POST",
      "STRIPE_LIST_CHARGES",
      "GITHUB_GET_A_PULL_REQUEST",
      "GITHUB_CREATE_AN_ISSUE",
      "LINEAR_CREATE_ISSUE",
      "NOTION_CREATE_PAGE",
      "GOOGLESHEETS_BATCH_UPDATE",
      "mcp__claude_ai_Gmail__search_threads",
      // a reply draft sends nothing until it is sent (review of #943)
      "mcp__claude_ai_Microsoft_365__outlook_create_reply_draft",
      "mcp__claude_ai_Microsoft_365__outlook_create_reply_all_draft",
      "GMAIL_CREATE_REPLY_DRAFT",
      "mcp__claude_ai_Linear__save_issue",
      "mcp__computer__click",
      "Bash",
      "Read",
      "Edit",
    ]) {
      expect(isOutboundTool(name), name).toBe(false);
    }
  });
});

describe("isOutboundTool, the engines' mail, Teams, calendar and SharePoint connectors", () => {
  it("keeps the card for every send or write through them", () => {
    for (const tool of [
      "outlook_send_mail",
      "outlook_set_vacation",
      "teams_send_chat_message",
      "teams_create_chat",
      "outlook_create_event",
      "outlook_update_event",
      "outlook_delete_event",
      "outlook_respond_to_event",
      "sharepoint_upload_file",
      "sharepoint_update_file",
      "sharepoint_create_folder",
      "sharepoint_move_item",
      "sharepoint_rename_item",
      "sharepoint_delete_item",
    ]) {
      expect(isOutboundTool(`mcp__claude_ai_Microsoft_365__${tool}`), tool).toBe(true);
    }
    expect(isOutboundTool("sharepoint__upload_file")).toBe(true);
    // fail closed on an engine connector's unknown tool, and the same
    // reading on the Composio path (review of #943)
    expect(isOutboundTool("mcp__claude_ai_Microsoft_365__set_out_of_office")).toBe(true);
    expect(isOutboundTool("onedrive__set_permissions")).toBe(true);
    for (const slug of ["GOOGLECALENDAR_CREATE_EVENT", "OUTLOOK_CALENDAR_CREATE_EVENT", "SHAREPOINT_UPLOAD_FILE"]) expect(isOutboundTool(slug), slug).toBe(true);
    expect(isOutboundTool("outlook__create_event")).toBe(true);
  });

  it("lets reads and drafts through them run", () => {
    for (const tool of ["outlook_email_search", "outlook_calendar_search", "find_meeting_availability", "outlook_create_draft", "teams_list_chats", "sharepoint_search", "sharepoint_folder_search"]) {
      expect(isOutboundTool(`mcp__claude_ai_Microsoft_365__${tool}`), tool).toBe(false);
    }
  });
});

describe("normalizeOutboundPolicy", () => {
  it("accepts ask and allow with a whole-number daily cap", () => {
    expect(normalizeOutboundPolicy({ policy: "ask" })).toEqual({ policy: "ask", dailyCap: OUTBOUND_DEFAULT_CAP });
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 10 })).toEqual({ policy: "allow", dailyCap: 10 });
  });

  it("refuses anything else", () => {
    expect(normalizeOutboundPolicy({ policy: "yes" })).toBeNull();
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 0 })).toBeNull();
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 2.5 })).toBeNull();
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 100_000 })).toBeNull();
    expect(normalizeOutboundPolicy("allow")).toBeNull();
    expect(normalizeOutboundPolicy(null)).toBeNull();
  });
});
