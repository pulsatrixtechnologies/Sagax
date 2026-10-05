import { describe, expect, it } from "vitest";
import type { HarnessCommand } from "../../shared/harness-commands";
import { composerCommandMenu, type ComposerSlashCommand } from "./composer-commands";
import {
  simpleHidesBotSection,
  simpleHidesPanelTab,
  simpleHidesSettingsSection,
  simpleKeepsComposerItem,
} from "./interface-visibility";

const sagax: ComposerSlashCommand[] = [
  { id: "goal", label: "/goal", description: "Keep a team working" },
  { id: "learn", label: "/learn", description: "Learn a skill" },
  { id: "setup", label: "/setup", description: "Set this bot up" },
];
const engine: HarnessCommand[] = [
  { name: "compact", description: "Free up context", group: "engine" },
  { name: "pulsatrix-flow:using-px-flow", description: "Flow entry", group: "plugins" },
  { name: "mcp__github__review_pr", description: "Review a PR", group: "mcp" },
];

describe("simple visibility", () => {
  it("hides technical settings sections and keeps the ones a person needs", () => {
    for (const id of ["experimental", "connections", "myConnections", "decisionModel", "engines", "computer", "usage", "mail", "activity", "backups", "workspaces", "people"] as const) {
      expect(simpleHidesSettingsSection(id), id).toBe(true);
    }
    for (const id of ["general", "appearance", "achievements", "organization", "companion"] as const) {
      expect(simpleHidesSettingsSection(id), id).toBe(false);
    }
  });

  it("hides engine plumbing in the bot panel and keeps the everyday sections", () => {
    for (const id of ["access", "perspicax", "usage", "history", "skills"] as const) {
      expect(simpleHidesBotSection(id), id).toBe(true);
    }
    for (const id of ["overview", "soul", "memory", "routines", "model", "permissions", "voice", "visibility", "sharing", "slack", "details"] as const) {
      expect(simpleHidesBotSection(id), id).toBe(false);
    }
    expect(simpleHidesPanelTab("computer")).toBe(true);
    expect(simpleHidesPanelTab("details")).toBe(false);
  });

  it("keeps /goal and drops engine, plugin, MCP, /learn and /setup", () => {
    const menu = composerCommandMenu(sagax, engine, "");
    expect(menu.filter(simpleKeepsComposerItem).map((item) => item.kind === "sagax" ? item.command.id : item.group)).toEqual(["goal"]);
    expect(menu.filter((item) => !simpleKeepsComposerItem(item)).length).toBe(menu.length - 1);
  });
});
