import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerWait } from "./OwnerWait";

describe("OwnerWait", () => {
  it("shows the wait without an approve button", () => {
    const html = renderToStaticMarkup(createElement(OwnerWait, { ownerName: "Jean-Christophe" }));
    expect(html).toContain("En attente de Jean-Christophe");
    expect(html).not.toContain("Approuver");
  });
});
