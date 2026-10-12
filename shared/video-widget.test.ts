import { describe, expect, it } from "vitest";
import { glitchoVideosFromTool, sagaxVideosFromJson, videosFromToolOutput, youtubeIdsInText, youtubeVideoId } from "./video-widget.ts";

describe("youtubeVideoId", () => {
  it("reads watch, youtu.be, embed and shorts URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(null);
    expect(youtubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
});

describe("youtubeIdsInText", () => {
  it("dedupes ids from links and bare URLs", () => {
    const text = "Voir https://youtu.be/abc12345678 et [clip](https://www.youtube.com/watch?v=abc12345678)";
    expect(youtubeIdsInText(text)).toEqual(["abc12345678"]);
  });
});

describe("sagaxVideosFromJson", () => {
  it("reads sagaxVideos and sagaxVideo", () => {
    expect(sagaxVideosFromJson({ sagaxVideo: { url: "https://x.test/a.m3u8", kind: "live", title: "Live" } })).toEqual([
      { kind: "live", url: "https://x.test/a.m3u8", title: "Live", streamer: undefined, source: undefined, posterUrl: undefined, durationMs: undefined },
    ]);
    expect(sagaxVideosFromJson({ sagaxVideos: [{ playback_url: "https://x.test/v.mp4", duration: 120 }] })[0]).toMatchObject({
      kind: "vod",
      url: "https://x.test/v.mp4",
      durationMs: 120_000,
    });
  });
});

describe("glitchoVideosFromTool", () => {
  it("maps list_followed live rows", () => {
    const output = JSON.stringify({
      items: [{ login: "ninja", title: "Ranked", hls_url: "https://cdn.example/live.m3u8", isLive: true }],
    });
    const rows = glitchoVideosFromTool("mcp__glitcho__list_followed", output);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "live", url: "https://cdn.example/live.m3u8", streamer: "ninja", source: "Glitcho" });
  });

  it("maps list_recordings as vod", () => {
    const output = JSON.stringify({
      recordings: [{ id: 3, title: "Hier", url: "https://glitcho.local/rec/3.mp4", durationMs: 90_000 }],
    });
    const rows = glitchoVideosFromTool("mcp__glitcho__list_recordings", output);
    expect(rows[0]).toMatchObject({ kind: "vod", durationMs: 90_000, source: "Glitcho" });
  });
});

describe("videosFromToolOutput", () => {
  it("prefers sagax envelope over glitcho heuristics", () => {
    const output = JSON.stringify({ sagaxVideos: [{ url: "https://a.test/x.m3u8" }] });
    expect(videosFromToolOutput("mcp__glitcho__list_followed", output)).toHaveLength(1);
  });
});
