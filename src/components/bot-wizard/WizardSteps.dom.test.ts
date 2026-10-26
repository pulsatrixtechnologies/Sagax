// @vitest-environment happy-dom
// The steps over the real bot: the role fills the bot's empty fields, the
// soul answers save to the draft and "Write it for me" writes the soul, the
// rules tick into custom rules, the tools show only the role's rows, the
// routines tick into the draft.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newWizardDraft } from "../../../shared/bot-wizard";
import { wizardSuggestions } from "@/lib/bot-wizard";

const fixture = vi.hoisted(() => ({ patchBot: vi.fn(), dispatch: vi.fn(), api: vi.fn(), writeSoul: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { bots: [], config: null }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/bot-wizard", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/bot-wizard")>(), writeSoulForMe: fixture.writeSoul }));
vi.mock("../bot-settings/useBotSettingsDerived", () => ({ useBotSettingsDerived: () => ({ patch: fixture.patchBot, activeState: "idle", mascotMotion: null, currentChief: undefined }) }));
vi.mock("../bot-settings/IdentitySection", () => ({ IdentitySection: () => createElement("div", { "data-stub": "identity" }) }));
vi.mock("../bot-settings/SoulSection", () => ({ SoulSection: () => createElement("div", { "data-stub": "soul" }) }));
vi.mock("../bot-settings/PermissionsSection", () => ({ PermissionsSection: ({ part }: { part: string }) => createElement("div", { "data-stub": `permissions:${part}` }) }));
vi.mock("../bot-settings/AccessSection", () => ({ AccessSection: ({ part }: { part: string }) => createElement("div", { "data-stub": `access:${part}` }) }));
vi.mock("../computer/WorksOnSetting", () => ({ WorksOnSetting: () => createElement("div", { "data-stub": "works-on" }) }));

const { StepBody } = await import("./WizardSteps");

const bot = { id: "bot-1", name: "Tri", title: "", description: "", soul: "", color: "green", messages: [], threadId: "t", modelSelection: { instanceId: "", model: "" } } as never;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  for (const fn of Object.values(fixture)) fn.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const props = (roleId: string, extra: Record<string, unknown> = {}) => {
  const patch = vi.fn(async () => {});
  const draft = { ...newWizardDraft({ botId: "bot-1", owner: "pr_me", origin: "new", mode: "manual", roleId, now: 1 }), ...extra };
  return { patch, value: { bot, draft, suggestions: wizardSuggestions(roleId, "en"), patch, language: "en" } };
};

describe("wizard steps", () => {
  it("Identity: a role fills the bot's empty title, description and soul, and the draft's role", async () => {
    const { patch, value } = props("");
    act(() => root.render(createElement(StepBody, { ...value, step: "identity" })));
    expect(container.querySelector('[data-stub="identity"]')).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-wizard-role="coder"]')!.click(); });
    expect(patch).toHaveBeenCalledWith({ roleId: "coder" });
    expect(fixture.patchBot).toHaveBeenCalledWith(expect.objectContaining({ title: "Coding partner", soul: expect.stringContaining("careful engineer") }));
  });

  it("Soul: a suggestion fills an answer, and Write it for me writes the soul from the answers", async () => {
    const { patch, value } = props("inbox");
    fixture.writeSoul.mockResolvedValue({ soul: "You are Tri.", source: "model" });
    act(() => root.render(createElement(StepBody, { ...value, step: "soul" })));
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-wizard-suggest="tone"]')!.click(); });
    expect(patch).toHaveBeenCalledWith({ answers: { tone: "Calm and professional" } });
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-wizard-write-soul]")!.click(); });
    expect(patch).toHaveBeenLastCalledWith({ answers: expect.objectContaining({ tone: "Calm and professional" }) });
    expect(fixture.writeSoul).toHaveBeenCalledWith("bot-1", "en");
    expect(fixture.patchBot).toHaveBeenCalledWith({ soul: "You are Tri." });
    expect(container.querySelector('[data-stub="soul"]')).not.toBeNull();
  });

  it("Rules: the one approval level, and a ticked suggestion saved as a custom rule", async () => {
    const { patch, value } = props("inbox");
    fixture.api.mockResolvedValue({ rule: { id: "rule-1" } });
    act(() => root.render(createElement(StepBody, { ...value, step: "rules" })));
    expect(container.querySelector('[data-stub="permissions:approval"]')).not.toBeNull();
    expect([...container.querySelectorAll("[data-wizard-rule]")].map((row) => row.getAttribute("data-wizard-rule"))).toEqual(["ask-send-mail", "deny-delete-mail", "deny-payment"]);
    await act(async () => { container.querySelector<HTMLInputElement>('[data-wizard-rule="ask-send-mail"] input')!.click(); });
    expect(fixture.api).toHaveBeenCalledWith("/api/custom-rules", expect.objectContaining({ method: "POST" }));
    expect(patch).toHaveBeenCalledWith({ rules: { "ask-send-mail": "rule-1" } });
  });

  it("Tools: only what the role uses, every tool one click away", async () => {
    const { value } = props("inbox");
    act(() => root.render(createElement(StepBody, { ...value, step: "tools" })));
    expect([...container.querySelectorAll("[data-wizard-tool]")].map((row) => row.getAttribute("data-wizard-tool"))).toEqual(["apps", "mcp"]);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-wizard-connect-apps]")!.click(); });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true, surface: "apps", botId: "bot-1", focusApps: ["gmail", "outlook"] });
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-wizard-all-tools]")!.click(); });
    expect(container.querySelectorAll("[data-wizard-tool]")).toHaveLength(4);
  });

  it("Routines: two or three suggestions of the role, ticked into the draft", async () => {
    const { patch, value } = props("ops");
    act(() => root.render(createElement(StepBody, { ...value, step: "routines" })));
    expect(container.querySelectorAll("[data-wizard-routine]")).toHaveLength(3);
    await act(async () => { container.querySelector<HTMLInputElement>('[data-wizard-routine="ops-day-plan"] input')!.click(); });
    expect(patch).toHaveBeenCalledWith({ routines: ["ops-day-plan"] });
  });
});
