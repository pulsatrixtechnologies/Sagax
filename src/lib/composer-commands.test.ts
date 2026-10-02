import { describe, expect, it } from "vitest";
import type { HarnessCommand } from "../../shared/harness-commands";
import {
  composerCommandMenu,
  composerSlashTrigger,
  engineCommandInsertion,
  goalTextFromComposer,
  replaceComposerSlashTrigger,
  type ComposerSlashCommand,
  type ComposerSlashCommandId,
} from "./composer-commands";

describe("composer slash commands", () => {
  it("opens command search only for the first unfinished token", () => {
    expect(composerSlashTrigger("/", 1)).toEqual({ query: "", start: 0, end: 1 });
    expect(composerSlashTrigger("/go", 3)).toEqual({ query: "go", start: 0, end: 3 });
    expect(composerSlashTrigger("hello /go", 9)).toBeNull();
    expect(composerSlashTrigger("/goal write", 11)).toBeNull();
  });

  it("replaces the active token without losing text after the caret", () => {
    expect(
      replaceComposerSlashTrigger("/go later", { query: "go", start: 0, end: 3 }, ""),
    ).toEqual({ text: " later", caret: 0 });
    expect(
      replaceComposerSlashTrigger("/le", { query: "le", start: 0, end: 3 }, "/learn "),
    ).toEqual({ text: "/learn ", caret: 7 });
  });

  it("turns a manually typed goal command into a goal request", () => {
    expect(goalTextFromComposer("/goal ship the release")).toBe("ship the release");
    expect(goalTextFromComposer("/GOAL\n  investigate the failure")).toBe(
      "investigate the failure",
    );
    expect(goalTextFromComposer("/goalie says hello")).toBeNull();
    expect(goalTextFromComposer("discuss /goal later")).toBeNull();
  });

  it("offers setup as a slash command id and keeps the typed token", () => {
    const id: ComposerSlashCommandId = "setup";
    expect(id).toBe("setup");
    expect(
      replaceComposerSlashTrigger("/se", { query: "se", start: 0, end: 3 }, "/setup "),
    ).toEqual({ text: "/setup ", caret: 7 });
  });
});

describe("composer command menu (Sagax and the engine)", () => {
  const sagax: ComposerSlashCommand[] = [
    { id: "goal", label: "/goal", description: "Keep a team working" },
    { id: "setup", label: "/setup", description: "Set this bot up" },
  ];
  const engine: HarnessCommand[] = [
    { name: "compact", description: "Free up context", group: "engine", argumentHint: "<instructions>" },
    { name: "goal", description: "Engine goal", group: "engine" },
    { name: "model", description: "Set the model", group: "engine", unavailable: "managed" },
    { name: "context", description: "Show context usage", group: "engine" },
    { name: "pulsatrix-flow:using-px-flow", description: "Flow entry", group: "plugins", aliases: ["using-px-flow"] },
    { name: "mcp__github__review_pr", description: "Review a PR", group: "mcp", argumentHint: "<pr>" },
  ];

  it("lists every command grouped Sagax, Engine, Plugins, MCP for a bare slash", () => {
    const menu = composerCommandMenu(sagax, engine, "");
    expect(menu.map((item) => [item.group, item.label])).toEqual([
      ["sagax", "/goal"], ["sagax", "/setup"],
      ["engine", "/compact"], ["engine", "/engine:goal"], ["engine", "/context"], ["engine", "/model"],
      ["plugins", "/pulsatrix-flow:using-px-flow"],
      ["mcp", "/mcp__github__review_pr"],
    ]);
    const model = menu.find((item) => item.label === "/model");
    expect(model?.kind === "engine" && model.unavailable).toBe("managed");
  });

  it("filters by name, a plugin command's short name, an alias and the description", () => {
    expect(composerCommandMenu(sagax, engine, "co").map((item) => item.label)).toEqual(["/compact", "/context"]);
    expect(composerCommandMenu(sagax, engine, "using").map((item) => item.label)).toEqual(["/pulsatrix-flow:using-px-flow"]);
    expect(composerCommandMenu(sagax, engine, "engine:g").map((item) => item.label)).toEqual(["/engine:goal"]);
    expect(composerCommandMenu(sagax, engine, "go").map((item) => item.label)).toEqual(["/goal", "/engine:goal"]);
    expect(composerCommandMenu(sagax, engine, "review").map((item) => item.label)).toEqual(["/mcp__github__review_pr"]);
  });

  it("opens on names with colons and underscores, and inserts the label with a space", () => {
    expect(composerSlashTrigger("/pulsatrix-flow:us", 18)).toEqual({ query: "pulsatrix-flow:us", start: 0, end: 18 });
    expect(composerSlashTrigger("/mcp__git", 9)?.query).toBe("mcp__git");
    const item = composerCommandMenu(sagax, engine, "engine:goal")[0];
    expect(item?.kind === "engine" && engineCommandInsertion(item)).toBe("/engine:goal ");
  });
});
