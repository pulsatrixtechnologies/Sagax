import { describe, expect, it, vi } from "vitest";
import { inboxDeepLinkFromLocation, normalizeInboxDeepLink, parseInboxHash, parseInboxViewParam } from "./inbox-deep-link";

describe("inbox deep link", () => {
  it("accepts view=inbox and the todo alias", () => {
    expect(parseInboxViewParam("?view=inbox")).toEqual({ view: "inbox" });
    expect(parseInboxViewParam("?view=todo")).toEqual({ view: "inbox" });
    expect(parseInboxViewParam("?view=other")).toBeNull();
  });

  it("accepts #inbox and the #todo alias", () => {
    expect(parseInboxHash("#inbox")).toEqual({ view: "inbox" });
    expect(parseInboxHash("#todo")).toEqual({ view: "inbox" });
    expect(parseInboxHash("#thread=1")).toBeNull();
  });

  it("rewrites legacy todo routes to inbox", () => {
    const replaceState = vi.fn();
    const target = normalizeInboxDeepLink(
      { pathname: "/", search: "?view=todo", hash: "" },
      { replaceState },
    );
    expect(target).toEqual({ view: "inbox" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?view=inbox");
  });

  it("reads from hash or search", () => {
    expect(inboxDeepLinkFromLocation({ hash: "#todo", search: "" })).toEqual({ view: "inbox" });
    expect(inboxDeepLinkFromLocation({ hash: "", search: "?view=inbox" })).toEqual({ view: "inbox" });
  });
});
