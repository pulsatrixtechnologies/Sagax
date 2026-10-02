import { describe, expect, it } from "vitest";

import {
  AUTO_COMPUTER_MCP_NAME,
  COMPUTER_SELECT_TOOL,
  autoComputerGuidance,
  autoComputerReason,
  autoComputerToolRefusal,
  parseAutoComputerTarget,
  selectAutoComputer,
  type AutoComputerState,
} from "./auto-computer.ts";
import { AUTO_COMPUTER_SERVER, computerSelectTarget } from "../shared/execution-target.ts";
import { PROXIED_TOOL_SERVERS } from "./user-sandbox-proxy.ts";

const auto = (over: Partial<AutoComputerState> = {}): AutoComputerState => ({
  auto: true, selected: "cloud", routine: false, sandboxConfigured: true, desktopMounted: true, routinesAllowed: false, ...over,
});

describe("computer_select availability", () => {
  it("is served by its own proxied tool server, named like the UI reads it", () => {
    expect(AUTO_COMPUTER_MCP_NAME).toBe(AUTO_COMPUTER_SERVER);
    expect(PROXIED_TOOL_SERVERS[AUTO_COMPUTER_MCP_NAME].endpoint).toBe("/api/internal/workplace/mcp");
    expect(COMPUTER_SELECT_TOOL.inputSchema.properties.target.enum).toEqual(["cloud", "this_computer", "local_vm"]);
  });

  it("lists what is available when called without a target", () => {
    const answer = selectAutoComputer(auto(), {}, true);
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("cloud, this_computer, local_vm");
    expect(answer.changed).toBeUndefined();
  });

  it("refuses to switch a fixed Works on and names the setting", () => {
    for (const [fixed, label] of [["cloud", "Cloud (server environment)"], ["vm", "Local VM"], ["local", "This computer"], ["browser", "Browser"], ["off", "Off"]] as const) {
      const answer = selectAutoComputer(auto({ auto: false, fixed, selected: null }), { target: "this_computer" }, true);
      expect(answer.ok).toBe(false);
      expect(answer.text).toContain(`fixed to ${label}`);
      expect(answer.target).toBeUndefined();
    }
  });

  it("refuses this_computer and local_vm when the desktop app is not connected", () => {
    for (const target of ["this_computer", "local_vm"]) {
      const notMounted = selectAutoComputer(auto({ desktopMounted: false }), { target }, false);
      expect(notMounted.ok).toBe(false);
      expect(notMounted.text).toContain("not connected");
      expect(notMounted.text).toContain("You still work on the cloud");
      // mounted at turn start, then the app closed
      expect(selectAutoComputer(auto(), { target }, false).ok).toBe(false);
    }
  });

  it("refuses cloud when the server environment is not enabled", () => {
    const answer = selectAutoComputer(auto({ sandboxConfigured: false, selected: null }), { target: "cloud" }, true);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("not enabled");
  });

  it("routines use the owner's computer only when allowed and connected", () => {
    expect(selectAutoComputer(auto({ routine: true, routinesAllowed: false }), { target: "this_computer" }, true).text).toContain("routine");
    expect(selectAutoComputer(auto({ routine: true, routinesAllowed: true }), { target: "this_computer" }, true)).toMatchObject({ ok: true, target: "this_computer", changed: true });
    expect(selectAutoComputer(auto({ routine: true, routinesAllowed: true, desktopMounted: false }), { target: "this_computer" }, false).ok).toBe(false);
  });

  it("rejects unknown targets and accepts common spellings", () => {
    expect(selectAutoComputer(auto(), { target: "mars" }, true).ok).toBe(false);
    expect(parseAutoComputerTarget("Local VM")).toBe("local_vm");
    expect(parseAutoComputerTarget("this-computer")).toBe("this_computer");
    expect(parseAutoComputerTarget("server")).toBe("cloud");
  });

  it("reports a change only when the place changes, with the previous one", () => {
    expect(selectAutoComputer(auto(), { target: "this_computer" }, true)).toMatchObject({ ok: true, target: "this_computer", from: "cloud", changed: true });
    expect(selectAutoComputer(auto({ selected: "this_computer" }), { target: "this_computer" }, true)).toMatchObject({ ok: true, changed: false });
  });

  it("keeps the audit reason to one short line", () => {
    expect(autoComputerReason("  files\n on her   Mac ")).toBe("files on her Mac");
    expect(autoComputerReason("x".repeat(500))).toHaveLength(200);
    expect(autoComputerReason(42)).toBe("");
  });
});

describe("switching routes the next tool calls", () => {
  it("follows each selection in turn, mid-task", () => {
    let state = auto();
    const run = (server: "sagax-environment" | "sagax-desktop", tool = "run_command") => autoComputerToolRefusal(state.selected, server, tool);
    // starts in the cloud
    expect(run("sagax-environment")).toBeNull();
    expect(run("sagax-desktop")).toContain("computer_select");
    // the person said "sur mon Mac"
    const toMac = selectAutoComputer(state, { target: "this_computer", reason: "files on her Mac" }, true);
    state = { ...state, selected: toMac.target! };
    expect(run("sagax-desktop")).toBeNull();
    expect(run("sagax-desktop", "local_vm")).toBeNull();
    expect(run("sagax-environment")).toContain("target cloud");
    // isolated work: only the Local VM tool
    state = { ...state, selected: selectAutoComputer(state, { target: "local_vm" }, true).target! };
    expect(run("sagax-desktop", "local_vm")).toBeNull();
    expect(run("sagax-desktop", "run_command")).toContain("local_vm tool");
    expect(run("sagax-desktop", "computer_use")).toContain("local_vm tool");
    expect(run("sagax-environment")).not.toBeNull();
    // back to the cloud for the scraping
    state = { ...state, selected: selectAutoComputer(state, { target: "cloud" }, true).target! };
    expect(run("sagax-environment")).toBeNull();
    expect(run("sagax-desktop")).not.toBeNull();
  });

  it("refuses everything before a first choice when nothing was selected", () => {
    expect(autoComputerToolRefusal(null, "sagax-environment", "run_command")).toContain("computer_select");
    expect(autoComputerToolRefusal(null, "sagax-desktop", "run_command")).toContain("computer_select");
  });
});

describe("Auto guidance (prompt fixture)", () => {
  const text = autoComputerGuidance(auto(), true);

  it("names the tool, the start place and what is available", () => {
    expect(text).toMatch(/^<workplace>This bot's Works on is Auto/);
    expect(text).toContain("computer_select");
    expect(text).toContain("This turn starts on the cloud (their server environment); available now: cloud, this_computer, local_vm.");
    expect(text).toContain("switch again mid-task");
    expect(text.endsWith("</workplace>")).toBe(true);
  });

  it("routes the person's own machine, isolated work and heavy work", () => {
    expect(text).toMatch(/this_computer: .*files.*apps.*local network.*USB.*camera.*Docker.*localhost/);
    expect(text).toMatch(/local_vm: isolated/);
    expect(text).toMatch(/cloud: heavy or long tasks, internet browsing and scraping, .*laptop is closed.*not connected/);
  });

  it("lets the person's explicit words win, in French and English", () => {
    for (const phrase of ["\"sur mon Mac\"", "\"localement\"", "\"on my computer\"", "\"locally\""]) {
      expect(text).toMatch(new RegExp(`${phrase}[^;]*mean this_computer`));
    }
    expect(text).toMatch(/"dans une VM", "in a VM" mean local_vm/);
    expect(text).toMatch(/"dans le cloud", "in the cloud", "sur le serveur", "on the server" mean cloud/);
    expect(text).toContain("say why (the tool's answer) instead of quietly working elsewhere");
  });

  it("lists only what can be reached", () => {
    expect(autoComputerGuidance(auto({ desktopMounted: false }), false)).toContain("available now: cloud.");
    expect(autoComputerGuidance(auto({ sandboxConfigured: false, selected: null }), true)).toContain("This turn starts on no computer; available now: this_computer, local_vm.");
  });

  it("has no long dashes", () => {
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("the transcript chip", () => {
  it("reads the chosen place from a computer_select call", () => {
    expect(computerSelectTarget("mcp__sagax-computer__computer_select", JSON.stringify({ target: "this_computer", reason: "x" }))).toBe("this_computer");
    expect(computerSelectTarget("sagax-computer__computer_select", "{\"target\": \"cloud\"}")).toBe("cloud");
    expect(computerSelectTarget("mcp__sagax-computer__computer_select", "{}")).toBeNull();
    expect(computerSelectTarget("mcp__sagax-desktop__run_command", "{\"target\":\"cloud\"}")).toBeNull();
  });
});
