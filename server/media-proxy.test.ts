import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initMediaProxy, mintMediaProxyToken, needsMediaProxy, verifyMediaProxyToken, wireVideoFromEmit } from "./media-proxy.ts";

describe("media proxy", () => {
  beforeEach(() => {
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-media-")));
  });

  it("mints and verifies tokens", () => {
    const token = mintMediaProxyToken("https://glitcho.example/live.m3u8", "thread-1", 1_000_000);
    expect(verifyMediaProxyToken(token, 1_000_000)).toEqual({
      u: "https://glitcho.example/live.m3u8",
      e: 1_000_000 + 4 * 60 * 60_000,
      t: "thread-1",
    });
    expect(verifyMediaProxyToken(token, 1_000_000 + 5 * 60 * 60_000)).toBeNull();
  });

  it("proxies glitcho and local URLs", () => {
    expect(needsMediaProxy("https://cdn.example/v.mp4")).toBe(false);
    expect(needsMediaProxy("https://cdn.example/v.mp4", "Glitcho")).toBe(true);
    expect(needsMediaProxy("http://127.0.0.1/x.m3u8")).toBe(true);
  });

  it("rewrites playback URLs for private sources", () => {
    const wire = wireVideoFromEmit({ url: "https://glitcho.example/a.m3u8", kind: "live", source: "Glitcho" }, "t1", 5_000);
    expect(wire.playbackUrl).toMatch(/^\/api\/media\/proxy\//);
    expect(wire.kind).toBe("live");
  });
});
