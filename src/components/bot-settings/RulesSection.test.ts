// Rules: the explanation, the inheritance note, the starter template on
// first open, and the counter against the budget.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { RulesSection, RULES_TEMPLATE } = await import("./RulesSection");

const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;
const render = (initial: { text: string; hash: string; exists: boolean }) =>
  renderToStaticMarkup(createElement(RulesSection, { bot, active: false, initial })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

beforeEach(() => setLocale("en"));

describe("RulesSection", () => {
  it("explains what goes where and says team rules come from Perspicax", () => {
    const html = render({ text: "", hash: "h", exists: false });
    expect(html).toContain("Hard constraints the bot checks every turn; identity goes in Soul, facts go in Memory.");
    expect(html).toContain("data-rules-inheritance");
    expect(html).toContain("Team and organization rules will come from the Perspicax memory tiers");
    expect(html).toContain("Only rules specific to this bot belong here.");
  });

  it("opens a bot without RULES.md on the starter template, saved only on Save", () => {
    const html = render({ text: "", hash: "h", exists: false });
    expect(html).toContain("data-rules-starter");
    expect(html).toContain("Never send an email to a client without showing me the draft first.");
    expect(RULES_TEMPLATE.match(/^- /gm)).toHaveLength(3);
    // the examples sit in a comment: nothing of them counts against the budget
    expect(html).toContain("1 of 60 lines");
    // Save is enabled for the template: saving it creates the file
    expect(html).toMatch(/data-rules-save=""[^>]*>Save</);
  });

  it("shows an existing file and counts it against 60 lines / 8 KB", () => {
    const html = render({ text: "# Rules\n\n- Never quote a price.\n", hash: "h", exists: true });
    expect(html).not.toContain("data-rules-starter");
    expect(html).toContain("3 of 60 lines");
    expect(html).toContain("7.8 KB load each turn");
    expect(html).not.toContain('role="alert"');
  });

  it("warns when the rules would not load whole", () => {
    const text = Array.from({ length: 70 }, (_, i) => `- rule ${i}`).join("\n");
    const html = render({ text, hash: "h", exists: true });
    expect(html).toContain("70 of 60 lines");
    expect(html).toContain("Over budget: only the first 60 lines");
    expect(html).toContain('data-rules-counter="" class="text-danger"');
  });
});
