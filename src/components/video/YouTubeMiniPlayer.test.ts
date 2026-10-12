import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { YouTubeMiniPlayer } from "./YouTubeMiniPlayer";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
}));

describe("YouTubeMiniPlayer", () => {
  it("renders fetch transcript control", () => {
    const html = renderToStaticMarkup(
      createElement(YouTubeMiniPlayer, { videoId: "dQw4w9WgXcQ" }),
    );
    expect(html).toContain("dQw4w9WgXcQ");
  });
});
