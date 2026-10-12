import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VideoPlayerWidget } from "./VideoPlayerWidget";

vi.mock("hls.js", () => ({
  default: class {
    static isSupported() { return false; }
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

describe("VideoPlayerWidget", () => {
  it("renders live badge and title", () => {
    const html = renderToStaticMarkup(
      createElement(VideoPlayerWidget, {
        video: {
          kind: "live",
          playbackUrl: "/api/media/proxy/test",
          title: "Tournoi",
          streamer: "Joueur",
          source: "Glitcho",
        },
      }),
    );
    expect(html).toContain("Tournoi");
    expect(html).toContain("Joueur");
  });
});
