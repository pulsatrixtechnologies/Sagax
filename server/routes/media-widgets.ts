import { z } from "zod";

import { streamProxiedMedia, verifyMediaProxyToken } from "../media-proxy.ts";
import { fetchYoutubeTranscript } from "../youtube-transcript.ts";
import { PASS, type RouteHandler } from "./table.ts";

const transcriptBody = z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }).strict();

export function createMediaWidgetRoutes(): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path.startsWith("/api/media/proxy/") && method === "GET") {
      if (auth.kind !== "session") return json(res, 401, { error: "Unauthorized" });
      const token = decodeURIComponent(path.slice("/api/media/proxy/".length));
      const body = verifyMediaProxyToken(token);
      if (!body) return json(res, 403, { error: "Invalid or expired media link" });
      const range = req.headers.range;
      try {
        await streamProxiedMedia(body.u, res, typeof range === "string" ? range : undefined);
      } catch {
        if (!res.headersSent) json(res, 502, { error: "Could not reach the media source" });
      }
      return;
    }
    if (path === "/api/youtube/transcript" && method === "POST") {
      if (auth.kind !== "session") return json(res, 401, { error: "Unauthorized" });
      const parsed = transcriptBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "videoId required" });
      try {
        const cues = await fetchYoutubeTranscript(parsed.data.videoId);
        return json(res, 200, { videoId: parsed.data.videoId, cues });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "no_captions") return json(res, 404, { error: "no_captions", message: "Aucune transcription publique pour cette vidéo." });
        if (code === "invalid_video") return json(res, 400, { error: "invalid_video" });
        return json(res, 502, { error: "unavailable", message: "Impossible de joindre YouTube pour l'instant." });
      }
    }
    return PASS;
  };
}
