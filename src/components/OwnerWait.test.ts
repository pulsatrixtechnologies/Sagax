import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerSettled, OwnerWait } from "./OwnerWait";

describe("OwnerWait", () => {
  it("shows the wait without an approve button", () => {
    const html = renderToStaticMarkup(createElement(OwnerWait, { ownerName: "Jean-Christophe" }));
    expect(html).toContain("En attente de Jean-Christophe");
    expect(html).not.toContain("Approuver");
  });
});

describe("OwnerSettled (S7-7)", () => {
  it("says who answered a card another person settled, never the request", () => {
    const html = renderToStaticMarkup(createElement(OwnerSettled, {
      message: { ownerName: "alice", card: { title: "", subtitle: "", options: [], answered: "allow", answeredBy: { kind: "session", name: "alice (console)" } } },
    }));
    expect(html).toContain("alice (console) allowed this request.");
    const denied = renderToStaticMarkup(createElement(OwnerSettled, {
      message: { ownerName: "alice", card: { title: "", subtitle: "", options: [], answered: "deny", answeredBy: { kind: "worker" } } },
    }));
    expect(denied).toContain("alice declined this request.");
    expect(renderToStaticMarkup(createElement(OwnerSettled, { message: { ownerName: "alice", card: { title: "", subtitle: "", options: [], dismissed: true } } }))).toBe("");
  });
});
