export interface YoutubeTranscriptCue {
  startMs: number;
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** One decoding pass: each entity is read once, never the output of another. */
function decodeEntitiesOnce(text: string): string {
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi, (match, name?: string, dec?: string, hex?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()]!;
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  });
}

/** YouTube double-escapes caption text: HTML-escaped, then XML-escaped. Decode each layer once. */
function decodeEntities(text: string): string {
  return decodeEntitiesOnce(decodeEntitiesOnce(text));
}

function parseXmlTimedText(xml: string): YoutubeTranscriptCue[] {
  const cues: YoutubeTranscriptCue[] = [];
  const blocks = xml.match(/<text[^>]*>[\s\S]*?<\/text>/gi) ?? [];
  for (const block of blocks) {
    const start = block.match(/\bstart="([^"]+)"/);
    const inner = block.replace(/^<text[^>]*>/, "").replace(/<\/text>$/, "");
    let stripped = inner;
    for (let previous = ""; previous !== stripped; ) {
      previous = stripped;
      stripped = stripped.replace(/<[^>]+>/g, "");
    }
    const text = decodeEntities(stripped).replace(/\s*\n\s*/g, " ").trim();
    if (!text || !start) continue;
    const startSec = Number(start[1]);
    if (!Number.isFinite(startSec)) continue;
    cues.push({ startMs: Math.round(startSec * 1000), text });
  }
  return cues;
}

/** Fetch captions for a public YouTube video (no API key). */
export async function fetchYoutubeTranscript(videoId: string, fetchImpl: typeof fetch = fetch): Promise<YoutubeTranscriptCue[]> {
  if (!/^[\w-]{11}$/.test(videoId)) throw Object.assign(new Error("invalid_video"), { code: "invalid_video" });
  const watch = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=fr`, {
    headers: { "accept-language": "fr-CA,fr;q=0.9,en;q=0.5" },
  });
  if (!watch.ok) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
  const html = await watch.text();
  const trackMatch = html.match(/"captionTracks":(\[[\s\S]*?\])/);
  if (!trackMatch) throw Object.assign(new Error("no_captions"), { code: "no_captions" });
  let tracks: Array<{ baseUrl?: string; languageCode?: string }>;
  try {
    tracks = JSON.parse(trackMatch[1]!.replace(/\\u0026/g, "&")) as Array<{ baseUrl?: string; languageCode?: string }>;
  } catch {
    throw Object.assign(new Error("no_captions"), { code: "no_captions" });
  }
  const fr = tracks.find((t) => t.languageCode?.startsWith("fr")) ?? tracks[0];
  if (!fr?.baseUrl) throw Object.assign(new Error("no_captions"), { code: "no_captions" });
  const captions = await fetchImpl(fr.baseUrl);
  if (!captions.ok) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
  const xml = await captions.text();
  const cues = parseXmlTimedText(xml);
  if (!cues.length) throw Object.assign(new Error("no_captions"), { code: "no_captions" });
  return cues;
}
