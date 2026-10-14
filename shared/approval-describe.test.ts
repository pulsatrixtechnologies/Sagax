import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { allowKeyHolds, APPROVAL_EN, approvalPlain, describeAllowRule, mcpAllowKey, parseToolId } from "./approval-describe.ts";

const en = JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "locales", "en.json"), "utf8")) as Record<string, string>;
const flat = (obj: Record<string, unknown>, prefix = ""): Record<string, string> =>
  Object.entries(obj).reduce<Record<string, string>>((out, [key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flat(value as Record<string, unknown>, name));
    else out[name] = String(value);
    return out;
  }, {});
const catalog = flat(en);

describe("server approval words", () => {
  it("say exactly what the app catalog says (one generator, card and push)", () => {
    for (const [key, text] of Object.entries(APPROVAL_EN)) expect(catalog[key], key).toBe(text);
  });
});

describe("approvalPlain", () => {
  it("names the bot and the action, never the raw tool id", () => {
    const plain = approvalPlain({ botName: "Cryptic", tool: "sagax-environment__run_command", toolInput: '{"command":"echo hi"}', detail: 'sagax-environment__run_command {"command":"echo hi"}' });
    expect(plain.title).toMatch(/^Allow Cryptic to .+\?$/);
    expect(`${plain.title} ${plain.line}`).not.toMatch(/__|\{"/);
  });
  it("says 'run a command' for a run_command tool, not 'run the command action'", () => {
    const plain = approvalPlain({ botName: "Cryptic", tool: "sagax-environment__run_command", toolInput: '{"command":"echo hi"}', detail: 'sagax-environment__run_command {"command":"echo hi"}' });
    expect(plain.title).toBe("Allow Cryptic to run a command?");
    const isolate = approvalPlain({ botName: "Cryptic", tool: "s1__isolate_action", detail: "s1__isolate_action {}" });
    expect(isolate.title).not.toMatch(/run a command/);
  });
  it("reads an MCP tool behind Grok's mcp__ prefix", () => {
    expect(parseToolId("mcp__perspicax__cw_psa__query")).toMatchObject({ server: "perspicax" });
  });
  it("falls back to a plain line when there is nothing readable", () => {
    const plain = approvalPlain({ botName: "Nib", tool: "other", detail: "{}" });
    expect(plain.line).toBeTruthy();
    expect(plain.line).not.toBe("{}");
  });
});

describe("allow rules", () => {
  it("are one exact tool of one server, described in words", () => {
    expect(mcpAllowKey("mcp__agents__list_bots")).toBe("mcp:agents__list_bots");
    expect(mcpAllowKey("agents__workspace_write")).toBe("mcp:agents__workspace_write");
    expect(mcpAllowKey("Bash")).toBeUndefined();
    expect(describeAllowRule("mcp:agents__list_bots")).not.toMatch(/__/);
    expect(describeAllowRule("ask_bot:b1", undefined, () => "Dot")).toMatch(/Dot/);
    expect(describeAllowRule("post_to_room:g1", undefined, () => "Standup")).toMatch(/Standup/);
  });

  it("an MCP Allow rule is the tool of one server, any arguments", () => {
    expect(mcpAllowKey("agents__workspace_write")).toBe("mcp:agents__workspace_write");
    expect(mcpAllowKey("mcp__agents__workspace_write")).toBe("mcp:agents__workspace_write");
  });

  it("the bot's Always allow answers in every conversation, whoever is speaking", () => {
    const write = "mcp:agents__workspace_write";
    expect(allowKeyHolds([write], [], write)).toBe(true);
    expect(allowKeyHolds([write], undefined, write)).toBe(true);
    expect(allowKeyHolds(undefined, [write], write)).toBe(true);
    expect(allowKeyHolds(["mcp:agents__run_command"], ["mcp:agents__list_bots"], write)).toBe(false);
  });
});
