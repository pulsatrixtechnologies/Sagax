// @vitest-environment happy-dom
// A member can change their own shared capability from a bot they can read.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { capabilityFixture } from "@/lib/capabilities.fixture";
import { setLocale } from "@/lib/i18n";

const botSkills = { skills: [{ name: "my-writing", enabled: true }], working: false, reviewing: null, error: null, toggle: vi.fn() };
const api = vi.fn(async (path: string) => {
  if (path.endsWith("/capabilities")) return capabilityFixture({ items: [
    { key: "plugin:me:notes@personal", form: "plugin", name: "My Notes", source: { kind: "marketplace", label: "personal" }, scope: "me", state: "on", enabled: true, canToggle: true, engine: { skills: "native", nothing: false } },
    { key: "skill:me:my-writing", form: "skill", name: "my-writing", source: { kind: "file", label: "Me" }, scope: "me", state: "on", enabled: true, canToggle: true, engine: { skills: "prompt", nothing: false } },
  ] });
  return {};
});
vi.mock("@/state/store", () => ({ api: (...args: Parameters<typeof api>) => api(...args), useStore: () => ({ dispatch: vi.fn(), flushBotPatches: vi.fn() }) }));
vi.mock("./SkillsSection", () => ({ useManagedSkills: () => botSkills, SkillReviewDialog: () => null }));

const { CapabilitiesTab } = await import("./CapabilitiesTab");
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  setLocale("en");
  api.mockClear();
  botSkills.toggle.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(CapabilitiesTab, { bot: { id: "shared-bot", name: "Planner" } as Bot })); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("routes personal plugin and skill switches to Me, including a skill with the same name on the bot", async () => {
  for (const row of ["plugin", "skill"]) {
    const toggle = host.querySelector<HTMLButtonElement>(`[data-capability="${row}"][data-capability-scope="me"] [role="switch"]`);
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
  }
  expect(api).toHaveBeenCalledWith("/api/me/plugins/notes%40personal", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  expect(api).toHaveBeenCalledWith("/api/me/skills-library/my-writing", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  expect(botSkills.toggle).not.toHaveBeenCalled();
  expect(api.mock.calls.some(([path]) => path.startsWith("/api/bots/shared-bot/plugins"))).toBe(false);
});
