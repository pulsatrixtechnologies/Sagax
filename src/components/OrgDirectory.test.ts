import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrgDirectory } from "./OrgDirectory";

// renderToStaticMarkup HTML-escapes apostrophes as &#x27;. Decode before
// comparing against the UI label.
function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element).replace(/&#x27;/g, "'");
}

describe("OrgDirectory", () => {
  it("offers creation when there is no organization", () => {
    const html = render(createElement(OrgDirectory, { org: null, people: [], onCreate() {}, onInvite() {} }));
    expect(html).toContain("Créer l'organisation");
  });
  it("lists members once the organization exists", () => {
    const html = render(createElement(OrgDirectory, {
      org: { name: "GOX" },
      people: [{ id: "zachary@example.test", role: "member" }],
      onCreate() {},
      onInvite() {},
    }));
    expect(html).toContain("GOX");
    expect(html).toContain("zachary@example.test");
    expect(html).not.toContain("Créer l'organisation");
  });
});
