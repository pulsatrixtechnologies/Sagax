// A person who lacks a permission sees no control for it. A disabled option
// that still looks choosable is the same failure.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GrantEditor } from "./GrantEditor";
import { InlineEditableText } from "./InlineEditableText";

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
