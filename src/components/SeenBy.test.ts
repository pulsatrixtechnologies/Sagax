import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SeenByRow, SeenCaption } from "./SeenBy";

const face = (participantId: string, name: string, at: number) => ({
  participantId,
  name,
  at,
  avatar: createElement("i", { "data-face": name }),
});
const time = (at: number) => `14:0${at}`;

describe("SeenByRow", () => {
  it("says Seen by, then stacks 16px avatars, overlapping, with every reader in the group's label", () => {
    const markup = renderToStaticMarkup(createElement(SeenByRow, { faces: [face("pr_a", "Alice", 2), face("bot:c", "Cryptic", 3)], end: false, time }));
    expect(markup).toContain('aria-label="Seen by Alice at 14:02, Cryptic at 14:03"');
    expect(markup).toMatch(/data-seen-label[^>]*>Seen by</);
    expect(markup.match(/data-seen-by=/g)).toHaveLength(2);
    expect(markup).toContain("width:16px;height:16px");
    // the second face tucks under the first
    expect(markup.match(/-ms-1/g)).toHaveLength(1);
    expect(markup).toContain("justify-start");
  });

  it("sits on the viewer's side under their own line, and draws nothing without readers", () => {
    expect(renderToStaticMarkup(createElement(SeenByRow, { faces: [face("pr_a", "Alice", 2)], end: true, time }))).toContain("justify-end");
    expect(renderToStaticMarkup(createElement(SeenByRow, { faces: [], end: true, time }))).toBe("");
  });
});

describe("SeenByRow: each reader", () => {
  it("is focusable, and its tooltip and aria-label say who and when", () => {
    const markup = renderToStaticMarkup(createElement(SeenByRow, { faces: [face("pr_z", "Zachary Sellam", 6)], end: true, time: () => "2:46 PM" }));
    expect(markup).toMatch(/data-seen-by="pr_z" role="img" tabindex="0" aria-label="Zachary Sellam · 2:46 PM"/);
    expect(markup).toMatch(/data-seen-tip[^>]*>Zachary Sellam · 2:46 PM</);
  });

  it("draws five avatars, then +N with the others in its label", () => {
    const faces = ["A", "B", "C", "D", "E", "F", "G"].map((name, index) => face(`pr_${name}`, name, index));
    const markup = renderToStaticMarkup(createElement(SeenByRow, { faces, end: false, time }));
    expect(markup.match(/data-seen-by=/g)).toHaveLength(5);
    expect(markup).toMatch(/data-seen-more="true" role="img" tabindex="0" aria-label="F · 14:05, G · 14:06"[^>]*>\+(?:<!-- -->)?2/);
    // the group still names everyone
    expect(markup).toContain("Seen by A at 14:00, B at 14:01, C at 14:02, D at 14:03, E at 14:04, F at 14:05, G at 14:06");
  });

  it("speaks French", async () => {
    const { setLocale } = await import("@/lib/i18n");
    setLocale("fr");
    try {
      const markup = renderToStaticMarkup(createElement(SeenByRow, { faces: [face("pr_z", "Zachary", 6)], end: true, time: () => "14 h 46" }));
      expect(markup).toMatch(/data-seen-label[^>]*>Vu par</);
      expect(markup).toContain('aria-label="Zachary · 14 h 46"');
    } finally {
      setLocale("en");
    }
  });
});

describe("SeenCaption", () => {
  it("is one quiet line", () => {
    const markup = renderToStaticMarkup(createElement(SeenCaption, { text: "Seen at 14:03", title: "Seen by Cryptic at 14:03" }));
    expect(markup).toContain(">Seen at 14:03<");
    expect(markup).toContain('data-testid="seen-caption"');
  });
});
