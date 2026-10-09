import { describe, expect, it } from "vitest";
import { evaluateConnectorTools } from "./connector-verdict.ts";
import {
  CONNECTOR_DISABLED_SERVICES_MAX,
  CONNECTOR_DISABLED_TOOLS_MAX,
  connectorWorkspaceRefusalText,
  parseDisabledTools,
  readDisabledTools,
  withAppDisabledTools,
  workspaceDisabledTools,
} from "./connector-tool-switches.ts";

describe("workspace tool switches for connected apps", () => {
  it("accepts only the app's own tool names, sorted and once", () => {
    expect(parseDisabledTools("gmail", ["GMAIL_SEND_EMAIL", "GMAIL_DELETE_DRAFT", "GMAIL_SEND_EMAIL"]))
      .toEqual({ ok: true, tools: ["GMAIL_DELETE_DRAFT", "GMAIL_SEND_EMAIL"] });
    expect(parseDisabledTools("bland_ai", ["BLAND_AI_MAKE_CALL"])).toEqual({ ok: true, tools: ["BLAND_AI_MAKE_CALL"] });
    expect(parseDisabledTools("gmail", [])).toEqual({ ok: true, tools: [] });
    expect(parseDisabledTools("gmail", ["SLACK_SEND_MESSAGE"]).ok).toBe(false);
    expect(parseDisabledTools("gmail", ["gmail_send_email"]).ok).toBe(false);
    expect(parseDisabledTools("gmail", "GMAIL_SEND_EMAIL").ok).toBe(false);
    expect(parseDisabledTools("Gmail", []).ok).toBe(false);
    expect(parseDisabledTools("gmail", Array.from({ length: CONNECTOR_DISABLED_TOOLS_MAX + 1 }, (_, i) => `GMAIL_T${i}`)).ok).toBe(false);
  });

  it("replaces one app's list and drops an app with every tool on", () => {
    const current = { gmail: ["GMAIL_SEND_EMAIL"], slack: ["SLACK_SEND_MESSAGE"] };
    expect(withAppDisabledTools(current, "gmail", ["GMAIL_DELETE_DRAFT"]))
      .toEqual({ slack: ["SLACK_SEND_MESSAGE"], gmail: ["GMAIL_DELETE_DRAFT"] });
    expect(withAppDisabledTools(current, "gmail", [])).toEqual({ slack: ["SLACK_SEND_MESSAGE"] });
    expect(withAppDisabledTools(undefined, "gmail", [])).toEqual({});
    const full = Object.fromEntries(Array.from({ length: CONNECTOR_DISABLED_SERVICES_MAX }, (_, i) => [`app${i}`, [`APP${i}_X`]]));
    expect(withAppDisabledTools(full, "gmail", ["GMAIL_SEND_EMAIL"])).toHaveProperty("error");
    expect(withAppDisabledTools(full, "app0", ["APP0_Y"])).not.toHaveProperty("error");
  });

  it("reads a stored map, skipping only a malformed entry", () => {
    expect(readDisabledTools(undefined)).toEqual({});
    expect(readDisabledTools({ gmail: ["GMAIL_SEND_EMAIL", 4, "bad name"], "Bad Slug": ["X_Y"], slack: "SLACK_X" }))
      .toEqual({ gmail: ["GMAIL_SEND_EMAIL"] });
  });

  it("refuses a switched-off tool even for a bot granted every tool, and the grants still narrow the rest", () => {
    const disabled = { gmail: ["GMAIL_SEND_EMAIL"] };
    expect(workspaceDisabledTools(["GMAIL_SEND_EMAIL", "GMAIL_LIST_EMAILS"], disabled)).toEqual(["GMAIL_SEND_EMAIL"]);
    expect(workspaceDisabledTools(["GMAIL_LIST_EMAILS"], disabled)).toEqual([]);
    // a tool on for the workspace still needs the bot's grant
    const grants = { gmail: { tools: ["GMAIL_FETCH_EMAILS"] } };
    expect(workspaceDisabledTools(["GMAIL_LIST_EMAILS"], disabled)).toEqual([]);
    expect(evaluateConnectorTools(["GMAIL_LIST_EMAILS"], grants).allowed).toBe(false);
    expect(connectorWorkspaceRefusalText(["GMAIL_SEND_EMAIL"])).toContain('"GMAIL_SEND_EMAIL" is turned off for this workspace.');
  });
});
