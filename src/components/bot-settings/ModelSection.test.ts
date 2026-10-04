import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
  it("hides backup models from an organization member and keeps them otherwise", () => {
    fixture.config = member;
    const hidden = renderToStaticMarkup(createElement(StoreProvider, null, createElement(ModelSection, { bot: bot() })));
    expect(hidden).toContain("Default model");
    expect(hidden).not.toContain("Backup models for this bot");
    fixture.config = null;
    const shown = renderToStaticMarkup(createElement(StoreProvider, null, createElement(ModelSection, { bot: bot() })));
    expect(shown).toContain("Backup models for this bot");
  });
});
