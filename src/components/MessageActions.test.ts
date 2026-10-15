import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageActions, type MessageMenuItem } from "./MessageActions";

type Props = Parameters<typeof MessageActions>[0];

const pin: MessageMenuItem = { key: "pin", icon: null, label: "Pin message", onSelect: () => {} };

const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(MessageActions, {
      side: "bot",
      onReply: () => {},
      copy: "an answer",
      react: { mine: [], onPick: () => {} },
      ...props,
    }),
  );

const labels = (html: string) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);

describe("MessageActions", () => {
  it("shows react, reply and …, hidden until the message is hovered or focused", () => {
    const html = render({ menu: [pin] });
    expect(labels(html)).toEqual(["Add reaction", "Reply to message", "Message actions"]);
    expect(html).toContain("opacity-0");
    expect(html).toContain("pointer-events-none");
    expect(html).not.toContain('data-shown="true"');
  });

  it("keeps copy and the moved actions behind a closed … menu", () => {
    const html = render({ menu: [pin] });
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Pin message");
    expect(html).not.toContain(">Copy<");
  });

  it("stays out while a control must remain reachable", () => {
    const html = render({ forceOpen: true });
    expect(html).toContain('data-shown="true"');
    expect(html).not.toContain("opacity-0");
  });

  it("mirrors the row on the user side so it starts at the bubble", () => {
    expect(render({ side: "user" })).toContain("flex-row-reverse");
    expect(render({ side: "bot" })).not.toContain("flex-row-reverse");
  });
});
