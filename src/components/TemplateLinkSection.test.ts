// Share preset > Share the link: the request never asks for starter notes,
// and Import recognizes a template link.
import { describe, expect, it } from "vitest";

import { isTemplateLink } from "./bot-catalog/TemplateTools";
import { templateLinkBody } from "./TemplateLinkSection";

describe("template link", () => {
  it("sends the name, description and picture, never starter notes", () => {
    expect(templateLinkBody({ name: " Support ", description: "", picture: "data:image/png;base64,AA" }))
      .toEqual({ name: "Support", picture: "data:image/png;base64,AA" });
    expect(Object.keys(templateLinkBody({ name: "x", description: "y" }))).not.toContain("includeMemory");
  });

  it("tells a template link from a GitHub link", () => {
    const token = `${"a".repeat(22)}.${"b".repeat(32)}`;
    expect(isTemplateLink(`https://sagax.example.com/share/template/${token}`)).toBe(true);
    expect(isTemplateLink(`https://sagax.example.com/share/template/${token}.json`)).toBe(true);
    expect(isTemplateLink("https://github.com/owner/repo")).toBe(false);
    expect(isTemplateLink(`https://x/share/template/short.${"b".repeat(32)}`)).toBe(false);
  });
});
