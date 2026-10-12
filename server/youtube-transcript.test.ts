import { describe, expect, it } from "vitest";
import { fetchYoutubeTranscript } from "./youtube-transcript.ts";

describe("fetchYoutubeTranscript", () => {
  it("parses caption tracks from a watch page", async () => {
    const html = `
      "captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=fr","languageCode":"fr"}]
    `;
    const fetchImpl = async (url: string) => {
      if (url.includes("watch?v=")) {
        return { ok: true, text: async () => html };
      }
      if (url.includes("timedtext")) {
        return {
          ok: true,
          text: async () => '<text start="1.5">Bonjour</text><text start="3">le monde</text>',
        };
      }
      throw new Error(`unexpected ${url}`);
    };
    const cues = await fetchYoutubeTranscript("abc12345678", fetchImpl as typeof fetch);
    expect(cues).toEqual([
      { startMs: 1500, text: "Bonjour" },
      { startMs: 3000, text: "le monde" },
    ]);
  });

  it("refuses when no caption tracks exist", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => "<html></html>" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "no_captions" });
  });

  it("decodes an entity once, so a double-encoded tag stays text", async () => {
    const cues = await cuesFrom('<text start="1.0">Tom &amp; Jerry &#39;ok&#39; &amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</text>');
    expect(cues[0]?.text).toBe("Tom & Jerry 'ok' &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(cues[0]?.text).not.toContain("<script");
  });

  it("drops an unclosed tag so the cue cannot contain <script", async () => {
    const cues = await cuesFrom('<text start="2">avant <script alert(1)</text>');
    expect(cues[0]?.text).not.toContain("<");
    expect(cues[0]?.text).not.toContain(">");
    expect(cues[0]?.text).toContain("avant");
  });
});

async function cuesFrom(xml: string) {
  const fetchImpl = async (url: string) => {
    if (url.includes("watch?v=")) {
      return { ok: true, text: async () => '"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=fr","languageCode":"fr"}]' };
    }
    return { ok: true, text: async () => xml };
  };
  return fetchYoutubeTranscript("abc12345678", fetchImpl as typeof fetch);
}
