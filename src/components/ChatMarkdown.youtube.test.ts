import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatMarkdown } from "./ChatMarkdown";
import { StoreProvider } from "@/state/store";
import { ThreadRefsContext } from "./ThreadRefs";

vi.mock("@/state/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/state/store")>();
  return { ...mod, api: vi.fn() };
});

vi.mock("hls.js", () => ({
  default: class {
    static isSupported() { return false; }
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

describe("ChatMarkdown YouTube", () => {
  it("replaces a YouTube link with the mini player", () => {
    const html = renderToStaticMarkup(
      createElement(
        StoreProvider,
        null,
        createElement(
          ThreadRefsContext.Provider,
          { value: { threads: [], currentBotId: undefined } },
          createElement(ChatMarkdown, {
            text: "Regarde https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          }),
        ),
      ),
    );
    expect(html).toContain("dQw4w9WgXcQ");
    expect(html).not.toContain("youtube.com/watch");
  });
});
