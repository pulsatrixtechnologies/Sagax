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

  const captionsOf = async (xml: string) => {
    const html = `"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc","languageCode":"fr"}]`;
    const fetchImpl = async (url: string) => ({ ok: true, text: async () => (url.includes("watch?v=") ? html : xml) });
    return fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch);
  };

  it("decodes YouTube's double-escaped caption text", async () => {
    expect(await captionsOf('<text start="0">l&amp;#39;homme &amp;quot;x&amp;quot; &quot;y&quot; &#39;z&#39;</text>')).toEqual([
      { startMs: 0, text: `l'homme "x" "y" 'z'` },
    ]);
  });

  it("decodes the two layers only, never a third", async () => {
    expect(await captionsOf('<text start="0">a &amp;amp;lt; b</text>')).toEqual([{ startMs: 0, text: "a &lt; b" }]);
  });

  it("decodes numeric entities and keeps a cue on one line", async () => {
    expect(await captionsOf('<text start="0">un&#10;deux &#x E9; &#xE9;t&#233; &#0; &#x110000;</text>')).toEqual([
      { startMs: 0, text: "un deux &#x E9; été &#0; &#x110000;" },
    ]);
  });

  it("strips markup inside a cue until none is left", async () => {
    const html = `"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc","languageCode":"fr"}]`;
    const fetchImpl = async (url: string) => ({
      ok: true,
      text: async () => (url.includes("watch?v=") ? html : '<text start="2"><font color="#fff">Bon<i>jour</i></font> &amp; <b>salut</b></text>'),
    });
    const cues = await fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([{ startMs: 2000, text: "Bonjour & salut" }]);
  });

  it("refuses when no caption tracks exist", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => "<html></html>" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "no_captions" });
  });
});
