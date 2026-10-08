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
  it("stacks 16px avatars, overlapping, with every reader in the tooltip", () => {
    const markup = renderToStaticMarkup(createElement(SeenByRow, { faces: [face("pr_a", "Alice", 2), face("bot:c", "Cryptic", 3)], end: false, time }));
    expect(markup).toContain('title="Seen by Alice at 14:02, Cryptic at 14:03"');
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

describe("SeenCaption", () => {
  it("is one quiet line", () => {
    const markup = renderToStaticMarkup(createElement(SeenCaption, { text: "Seen at 14:03", title: "Seen by Cryptic at 14:03" }));
    expect(markup).toContain(">Seen at 14:03<");
    expect(markup).toContain('data-testid="seen-caption"');
  });
});
