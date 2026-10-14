// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireVideoWidget } from "../../../shared/video-widget.ts";

const hlsCalls = vi.hoisted(() => ({ loadSource: [] as string[], attached: 0 }));

vi.mock("hls.js", () => ({
  default: class {
    static Events = { ERROR: "hlsError" };
    static isSupported() { return true; }
    loadSource(src: string) { hlsCalls.loadSource.push(src); }
    attachMedia() { hlsCalls.attached += 1; }
    on() {}
    destroy() {}
  },
}));

const { VideoPlayerWidget } = await import("./VideoPlayerWidget");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(video: WireVideoWidget, nativeHls: boolean): Promise<HTMLVideoElement> {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((type: string) =>
    nativeHls && type === "application/vnd.apple.mpegurl" ? "maybe" : "",
  );
  await act(async () => {
    root.render(createElement(VideoPlayerWidget, { video }));
  });
  // Let the dynamic import of hls.js settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return host.querySelector("video")!;
}

describe("VideoPlayerWidget playback path", () => {
  beforeEach(() => {
    hlsCalls.loadSource.length = 0;
    hlsCalls.attached = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("loads a proxied HLS source (Glitcho live) with hls.js on Chrome/Firefox", async () => {
    const video = await mount(
      { kind: "live", format: "hls", playbackUrl: "/api/media/proxy/eyJ1IjoiaHR0cHM6Ly9nIn0.mac", source: "Glitcho" },
      false,
    );
    expect(hlsCalls.loadSource).toEqual(["/api/media/proxy/eyJ1IjoiaHR0cHM6Ly9nIn0.mac"]);
    expect(hlsCalls.attached).toBe(1);
    expect(video.getAttribute("src")).toBeNull();
  });

  it("loads a proxied HLS recording (Glitcho vod) with hls.js", async () => {
    await mount({ kind: "vod", format: "hls", playbackUrl: "/api/media/proxy/rec.mac", durationMs: 5_400_000 }, false);
    expect(hlsCalls.loadSource).toEqual(["/api/media/proxy/rec.mac"]);
  });

  it("lets Safari play HLS natively", async () => {
    const video = await mount({ kind: "live", format: "hls", playbackUrl: "/api/media/proxy/live.mac" }, true);
    expect(hlsCalls.loadSource).toEqual([]);
    expect(video.src).toContain("/api/media/proxy/live.mac");
  });

  it("plays a proxied MP4 directly", async () => {
    const video = await mount({ kind: "vod", format: "mp4", playbackUrl: "/api/media/proxy/clip.mac" }, false);
    expect(hlsCalls.loadSource).toEqual([]);
    expect(video.src).toContain("/api/media/proxy/clip.mac");
  });

  it("still sniffs .m3u8 on older messages without format", async () => {
    await mount({ kind: "live", playbackUrl: "https://cdn.example/live.m3u8" }, false);
    expect(hlsCalls.loadSource).toEqual(["https://cdn.example/live.m3u8"]);
  });
});
