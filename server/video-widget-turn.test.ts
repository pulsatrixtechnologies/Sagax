import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initMediaProxy } from "./media-proxy.ts";
import { videoMessagesFromTool } from "./video-widget-turn.ts";

describe("videoMessagesFromTool", () => {
  it("maps Glitcho list_followed output to video messages", () => {
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-vid-")));
    const output = JSON.stringify({
      items: [{ title: "Ranked", hls_url: "https://cdn.example/live.m3u8", login: "ninja" }],
    });
    const msgs = videoMessagesFromTool("mcp__glitcho__list_followed", output, "thread-1", 1_700_000_000_000);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.kind).toBe("video");
    expect(msgs[0]?.video?.kind).toBe("live");
    expect(msgs[0]?.video?.playbackUrl).toMatch(/^\/api\/media\/proxy\//);
    expect(msgs[0]?.video?.streamer).toBe("ninja");
  });

  it("ignores unrelated tools", () => {
    expect(videoMessagesFromTool("bash", "ok", "t")).toEqual([]);
  });
});
