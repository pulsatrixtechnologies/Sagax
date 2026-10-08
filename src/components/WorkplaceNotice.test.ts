import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerNoticeBand } from "./WorkplaceNotice";

describe("composer-slot notices", () => {
  const html = renderToStaticMarkup(createElement(ComposerNoticeBand, null, createElement("div", { role: "status" }, "Bots work on your computer.")));

  it("sit in normal flow (no absolute or fixed positioning on the block)", () => {
    const root = html.match(/^<div[^>]*>/)![0];
    expect(root).toContain("data-composer-notice-band");
    expect(root).toContain("relative");
    expect(root).not.toMatch(/\b(absolute|fixed|sticky)\b/);
    expect(root).toContain("pb-2");
  });

  it("carry an opaque full-bleed app ground behind the text so messages never show through", () => {
    expect(html).toMatch(/aria-hidden="true"[^>]*class="[^"]*bg-app/);
    expect(html).toContain("-left-[50vw]");
    expect(html).toContain("inset-y-0");
    expect(html).toContain("Bots work on your computer.");
  });
});
