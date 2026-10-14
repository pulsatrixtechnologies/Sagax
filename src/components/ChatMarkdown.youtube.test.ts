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

describe("ChatMarkdown YouTube artifact and invalid cw", () => {
  const render = (text: string) =>
    renderToStaticMarkup(
      createElement(
        StoreProvider,
        null,
        createElement(ThreadRefsContext.Provider, { value: { threads: [], currentBotId: undefined } }, createElement(ChatMarkdown, { text })),
      ),
    );

  it("plays an ```artifact whose url is YouTube instead of showing a page card", () => {
    const html = render('```artifact\n{"title":"Rick","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}\n```');
    expect(html).toContain("dQw4w9WgXcQ");
    expect(html).not.toContain("youtube.com/watch");
    expect(html).not.toContain('aria-label="Page: Rick"');
  });

  it("keeps a non-YouTube artifact as a page card", () => {
    const html = render('```artifact\n{"title":"Report","url":"https://example.com/page"}\n```');
    expect(html).toContain("example.com/page");
  });

  it("shows an invalid ```cw as its source plus the reason", () => {
    const html = render('```cw\n{"family":"widget","view":"custom","records":[{"id":1}]}\n```');
    expect(html).toContain("Invalid ConnectWise widget: unknown family &quot;widget&quot;");
    expect(html).toContain("custom");
  });
});
