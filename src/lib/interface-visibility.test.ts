import { describe, expect, it } from "vitest";
import {
  simpleHidesBotSection,
  simpleHidesPanelTab,
  simpleHidesSettingsSection,
} from "./interface-visibility";

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
    for (const id of ["access", "worksOn", "perspicax", "usage", "history", "skills"] as const) {
      expect(simpleHidesBotSection(id), id).toBe(true);
    }
    for (const id of ["overview", "soul", "memory", "routines", "model", "permissions", "voice", "visibility", "sharing", "slack", "details"] as const) {
      expect(simpleHidesBotSection(id), id).toBe(false);
    }
    expect(simpleHidesPanelTab("computer")).toBe(true);
    expect(simpleHidesPanelTab("details")).toBe(false);
  });
});
