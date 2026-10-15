// Rules: the explanation, the inheritance note, the rule sets with their
// switches and gauges, the starter template on first open, and the
// counters against the budgets per set and in all.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { RuleSetWire, RulesListing } from "@/lib/rule-sets";
import type { Bot } from "@/state/store";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { RulesSection, RULES_TEMPLATE } = await import("./RulesSection");

const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;
const ruleSet = (patch: Partial<RuleSetWire>): RuleSetWire => ({
  id: "rules", name: null, enabled: true, file: "RULES.md", text: "", hash: "h", exists: true, lines: 0, bytes: 0, over: false, loads: true, ...patch,
});
const listing = (sets: RuleSetWire[]): RulesListing => ({
  budgets: { set: { maxLines: 100, maxBytes: 12_000 }, total: { maxLines: 250, maxBytes: 24_000 } },
  maxSets: 20,
  maxNameLength: 60,
  template: RULES_TEMPLATE,
  sets,
  total: { lines: 0, bytes: 0, over: false },
});
const render = (initial: RulesListing) =>
  renderToStaticMarkup(createElement(RulesSection, { bot, active: false, initial })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

beforeEach(() => setLocale("en"));

describe("RulesSection", () => {
  it("explains what goes where and says team rules come from Perspicax", () => {
    const html = render(listing([ruleSet({ exists: false })]));
    expect(html).toContain("Hard constraints the bot checks every turn; identity goes in Personality, facts go in Memory.");
    expect(html).toContain("data-rules-inheritance");
    expect(html).toContain("Team and organization rules will come from the Perspicax memory tiers");
    expect(html).toContain("Sets that are on load in this order, right after the Personality.");
  });

  it("opens a bot without RULES.md on its first set, the starter template, saved only on Save", () => {
    const html = render(listing([ruleSet({ exists: false })]));
    expect(html).toContain('data-rule-set="rules"');
    expect(html).toMatch(/data-rule-set-name="">Rules</);
    expect(html).toContain("data-rules-starter");
    expect(html).toContain("Never send an email to a client without showing me the draft first.");
    expect(RULES_TEMPLATE.match(/^- /gm)).toHaveLength(3);
    // the examples sit in a comment: nothing of them counts against the budget
    expect(html).toContain("1 / 100 lines");
    expect(html).toMatch(/data-rules-save=""[^>]*>Save</);
  });

  it("lists every set in order with its switch, gauge and file, and the total of the sets that are on", () => {
    const html = render(listing([
      ruleSet({ text: "# Rules\n\n- Never quote a price.\n" }),
      ruleSet({ id: "emails", name: "Client emails", file: "rules/emails.md", text: "- Sign every email.\n" }),
      ruleSet({ id: "drafts", name: "Drafts", file: "rules/drafts.md", text: "- Off rule.\n", enabled: false }),
    ]));
    expect(html.indexOf('data-rule-set="rules"')).toBeLessThan(html.indexOf('data-rule-set="emails"'));
    expect(html.indexOf('data-rule-set="emails"')).toBeLessThan(html.indexOf('data-rule-set="drafts"'));
    expect(html).toContain("rules/emails.md · 1 / 100 lines");
    expect(html).toContain('aria-label="Load Client emails every turn"');
    expect(html).toContain('aria-label="Move Rules up" title="Move Rules up" disabled=""');
    expect(html).toContain('aria-label="Delete Drafts"');
    // 3 lines on in all; the off set does not count
    expect(html).toContain("Sets that are on, in all: 4 / 250 lines");
    expect(html).toContain('role="meter"');
    expect(html).toContain(">Off<");
    expect(html).toContain("Add a set");
    expect(html).not.toContain('role="alert"');
  });

  it("warns when a set would not load whole, and when the total is over", () => {
    const long = Array.from({ length: 110 }, (_, i) => `- rule ${i}`).join("\n");
    const html = render(listing([ruleSet({ text: long }), ruleSet({ id: "b", name: "B", file: "rules/b.md", text: long }), ruleSet({ id: "c", name: "C", file: "rules/c.md", text: long })]));
    expect(html).toContain("110 / 100 lines");
    expect(html).toContain("Over budget: only the first 100 lines");
    expect(html).toContain('data-rules-counter="" class="text-danger"');
    expect(html).toContain("Over the total budget");
  });

  it("speaks French with the vous form", () => {
    setLocale("fr");
    const html = render(listing([ruleSet({ text: "- Toujours demander.\n" })]));
    expect(html).toMatch(/data-rule-set-name="">Règles</);
    expect(html).toContain("Ajouter un jeu");
    expect(html).toContain("Jeux actifs, au total");
  });
});
