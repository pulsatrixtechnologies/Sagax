import { afterEach, describe, expect, it, vi } from "vitest";

import { createYoutubePlayer } from "./youtube-embed";

describe("createYoutubePlayer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills its mount and keeps YouTube's own controls (play, scrub bar, fullscreen)", async () => {
    let options: Record<string, unknown> | undefined;
    class Player {
      constructor(_el: unknown, opts: Record<string, unknown> & { events: { onReady: (e: unknown) => void } }) {
        options = opts;
        opts.events.onReady({ target: { seekTo() {}, getCurrentTime: () => 0, playVideo() {}, pauseVideo() {}, destroy() {} } });
      }
    }
    vi.stubGlobal("window", { YT: { Player }, location: { origin: "http://127.0.0.1:5173" } });
    expect(await createYoutubePlayer({} as HTMLElement, "jNQXAC9IVRw")).not.toBeNull();
    // Without 100%, the IFrame API writes a fixed 640x390 iframe.
    expect(options).toMatchObject({
      width: "100%",
      height: "100%",
      videoId: "jNQXAC9IVRw",
      host: "https://www.youtube-nocookie.com",
      playerVars: { controls: 1, fs: 1, playsinline: 1, rel: 0, origin: "http://127.0.0.1:5173" },
    });
  });
});
