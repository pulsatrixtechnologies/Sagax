import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ModelSearchList, type ModelMenuSection } from "./ModelMenu";

const sections: ModelMenuSection[] = [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", detail: "best model per task", current: true }] },
  { key: "grok", label: "Grok", note: "Sign-in required", rows: [
    { key: "g", kind: "model", instanceId: "grok", modelId: "grok-4.5", label: "Grok 4.5", detail: "High", tags: ["Default"], current: false },
    { key: "l", kind: "model", instanceId: "grok", modelId: "desk::q", label: "Qwen", current: false, unavailable: "Grok cannot run it." },
  ] },
];

const html = (variant: "popover" | "window") => renderToStaticMarkup(createElement(ModelSearchList, { sections, onPick: () => {}, variant }));

beforeEach(() => setLocale("en"));

describe("ModelSearchList", () => {
  it("draws the search, the headings and each row as a name with its muted detail", () => {
    const markup = html("popover");
    expect(markup).toContain('placeholder="Search models"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain(">Grok<");
    expect(markup).toContain(">· Sign-in required<");
    expect(markup).toMatch(/>Grok 4\.5<\/span><span data-model-row-detail="true" class="[^"]*text-popover-ink-secondary">High<\/span>/);
    expect(markup).toContain(">Default<");
  });

  it("checks the current choice, starts on it and dims what cannot run", () => {
    const markup = html("popover");
    expect(markup).toMatch(/aria-selected="true" aria-current="true"[^>]*data-model-row-key="auto"/);
    expect(markup).toMatch(/aria-disabled="true"[^>]*data-model-option="desk::q"[^>]*title="Grok cannot run it\."/);
    // the active row is the one the combobox names
    const active = /aria-activedescendant="([^"]+)"/.exec(markup)?.[1];
    expect(markup).toContain(`id="${active}" role="option" aria-selected="true"`);
  });

  it("paints the popover from the popover tokens and the window from the page's", () => {
    expect(html("popover")).toContain("text-popover-ink");
    expect(html("window")).not.toContain("popover");
  });

  it("says when nothing matches", () => {
    const markup = renderToStaticMarkup(createElement(ModelSearchList, { sections: [], onPick: () => {}, variant: "window" }));
    expect(markup).toContain("No model matches.");
  });
});
