// A person who lacks a permission sees no control for it. A disabled option
// that still looks choosable is the same failure.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GrantEditor } from "./GrantEditor";
import { InlineEditableText } from "./InlineEditableText";

// The pill menu shows only its current value until opened: draw its
// choices as a plain list so the markup shows which levels are offered.
vi.mock("../SettingsPrimitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SettingsPrimitives")>();
  const { createElement: h } = await import("react");
  return {
    ...actual,
    PillSelect: (props: { ariaLabel: string; value: string; options: ReadonlyArray<{ value: string; label: string }> }) =>
      h("ul", { "aria-label": props.ariaLabel, "data-value": props.value }, props.options.map((option) => h("li", { key: option.value }, option.label))),
  };
});


describe("controls a person cannot use", () => {
  it("shows a bot name as text, with no pencil and no field", () => {
    const html = renderToStaticMarkup(createElement(InlineEditableText, {
      value: "Pepper",
      ariaLabel: "Edit name",
    }));
    expect(html).toContain("Pepper");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("omits grant levels above what the caller may give", () => {
    const html = renderToStaticMarkup(createElement(GrantEditor, {
      botId: "bot-1",
      initialGrants: [{ target: "pr_ada", level: "use", by: "pr_me", at: 1, label: "Ada", kind: "user" }],
      initialAdminister: { any: false, teamIds: [], maxLevel: "edit", canAdd: false },
      directory: { people: [], teams: [] },
    }));
    expect(html).toContain(">Talk<");
    expect(html).toContain(">Run routines<");
    expect(html).toContain(">Edit<");
    expect(html).not.toContain("Manage sharing");
    expect(html).not.toContain("disabled=");
  });
});
