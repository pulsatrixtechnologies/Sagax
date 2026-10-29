// The wrapper's side of a page's shared state (src/page-reader/state.ts).
import { describe, expect, it } from "vitest";

import { READER_ID } from "../../shared/page-state";
import { browserReaderId, viewToken } from "./state";
import { stateValueLine } from "./ReaderState";

describe("viewToken", () => {
  it("is the reading link's token only", () => {
    expect(viewToken("/pages/view/abc.def")).toBe("abc.def");
    expect(viewToken("/pages/preview/abc/1")).toBeNull();
    expect(viewToken("/pages/view/a/b")).toBeNull();
  });
});

describe("browserReaderId (2026-10-29)", () => {
  it("is random, kept by the browser, and still works when storage refuses", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
    const first = browserReaderId(storage);
    expect(first).toMatch(READER_ID);
    expect(browserReaderId(storage)).toBe(first);
    const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const once = browserReaderId(refusing);
    expect(once).toMatch(READER_ID);
    expect(once).not.toBe(first);
  });
});

describe("stateValueLine", () => {
  it("one short line", () => {
    expect(stateValueLine("yes")).toBe("yes");
    expect(stateValueLine({ taken: true })).toBe('{"taken":true}');
    expect(stateValueLine("x".repeat(200))).toHaveLength(80);
  });
});
