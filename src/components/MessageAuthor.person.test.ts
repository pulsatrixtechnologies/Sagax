import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { viewer: { principalId: "pr_me" } } }, dispatch: vi.fn() }) }));
const { OtherAuthorLabel, RoomPersonLabel } = await import("./MessageAuthor");

describe("person names open the person panel", () => {
  it("a group's person label is a button for a person of the directory", () => {
    const html = renderToStaticMarkup(createElement(RoomPersonLabel, { name: "Ada Example", initials: "AE", personId: "pr_ada", onOpen: () => {} }));
    expect(html).toContain('data-open-person="pr_ada"');
    expect(html).toContain("<button");
    expect(renderToStaticMarkup(createElement(RoomPersonLabel, { name: "Guest", initials: "G" }))).not.toContain("<button");
  });

  it("another person's name above their line in a bot chat opens them", () => {
    const html = renderToStaticMarkup(createElement(OtherAuthorLabel, { message: { role: "user", sender: { id: "pr_ada", name: "Ada Example" } } }));
    expect(html).toContain('data-open-person="pr_ada"');
  });
});
