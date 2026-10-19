import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APPROVAL_EN, approvalPlain, describeAllowRule, mcpAllowKey, parseToolId } from "./approval-describe.ts";

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
  it("reads the prod 0.5.27 Grok card (kind other, no arguments, the tool id as subtitle) in plain words", () => {
    const plain = approvalPlain({ botName: "Sunny", tool: "sagax-computer__computer_select", toolInput: undefined, detail: "sagax-computer__computer_select" });
    expect(plain.title).toBe("Allow Sunny to choose which of your computers it works on?");
  });
  it.each([
    [{ target: "cloud", reason: "Lancer le script" }, "Allow Moss to use your cloud computer?"],
    [{ target: "this_computer" }, "Allow Moss to use your computer?"],
    [{ target: "local_vm" }, "Allow Moss to use the Local VM on your computer?"],
    [{ target: "browser" }, "Allow Moss to use the built-in browser?"],
    [{}, "Allow Moss to choose which of your computers it works on?"],
  ])("reads computer_select %j as the place it picks, never 'computer select in Sagax Computer'", (args, title) => {
    for (const tool of ["mcp__sagax-computer__computer_select", "sagax-computer__computer_select"]) {
      const plain = approvalPlain({ botName: "Moss", tool, toolInput: JSON.stringify(args) });
      expect(plain.title).toBe(title);
      expect(plain.title).not.toMatch(/computer select|Sagax Computer/i);
    }
  });
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
    expect(mcpAllowKey("Bash")).toBeUndefined();
    expect(describeAllowRule("mcp:agents__list_bots")).not.toMatch(/__/);
    expect(describeAllowRule("ask_bot:b1", undefined, () => "Dot")).toMatch(/Dot/);
  });
});
