import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { StoreProvider, type Bot, type ConfigStatus } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: fixture.config, instances: [] }, dispatch: vi.fn() }) };
});
vi.mock("../ModelPicker", () => ({
  ModelPicker: () => createElement("div", null, "Default model"),
  EffortRow: () => createElement("div", null, "Effort"),
}));

const { ModelSection } = await import("./ModelSection");

function bot(): Bot {
  return {
    id: "bot-1", threadId: "thread-1", name: "Scout", title: "Scout", description: "",
    notifications: false, color: "green", unread: false,
    modelSelection: { instanceId: "local", model: "test-model" }, messages: [],
    ownerUserId: "pr_zara",
  } as Bot;
}

const member = { viewer: { operator: false, principalId: "pr_zara", email: "zara@example.test", name: "zara", role: "member", canCreateBots: true } } as ConfigStatus;

describe("ModelSection", () => {
  it("shows backup models only while automatic recovery is on, and never to an organization member", () => {
    const html = () => renderToStaticMarkup(createElement(StoreProvider, null, createElement(ModelSection, { bot: bot() })));
    fixture.config = member;
    expect(html()).toContain("Default model");
    expect(html()).not.toContain("Backup models for this bot");
    fixture.config = { automaticRecovery: { enabled: false } } as ConfigStatus;
    expect(html()).not.toContain("Backup models for this bot");
    expect(html()).not.toContain("Automatic recovery is off");
    fixture.config = null;
    expect(html()).not.toContain("Backup models for this bot");
    fixture.config = { automaticRecovery: { enabled: true, backup: { instanceId: "backup", model: "m" } } } as ConfigStatus;
    expect(html()).toContain("Backup models for this bot");
  });
});
