// Pin or unpin one file of a conversation's Files tab (#1112):
//
//   POST /api/threads/:id/files/:fileId/pin   { "pinned": true | false }
//        { ok: true, pinned }
//
// The pin is kept on the server so it follows the person to their other
// devices. The listing entry is the grant: a file that is not in the
// conversation's listing cannot be pinned.
import { PASS, type RouteHandler } from "./table.ts";

export interface ThreadFilePinRouteDeps {
  /** A bot's or a group's conversation exists for this thread id. */
  hasConversation: (threadId: string) => boolean;
  /** The file is one of this conversation's listed files. */
  hasFile: (threadId: string, fileId: string) => boolean;
  /** False when the conversation holds too many pins already. */
  setPin: (threadId: string, fileId: string, pinned: boolean) => boolean;
}

const ROUTE = /^\/api\/threads\/([\w-]+)\/files\/([a-f0-9]{24})\/pin$/;

export function createThreadFilePinRoutes(deps: ThreadFilePinRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    const m = ROUTE.exec(path);
    if (!m || method !== "POST") return PASS;
    const threadId = m[1]!;
    const fileId = m[2]!;
    if (!deps.hasConversation(threadId)) return json(res, 404, { error: "no such conversation" });
    const body = await readBody(req, 1024);
    if (typeof body?.pinned !== "boolean") return json(res, 400, { error: "pinned must be true or false" });
    if (!deps.hasFile(threadId, fileId)) return json(res, 404, { error: "no such file in this conversation" });
    if (!deps.setPin(threadId, fileId, body.pinned)) return json(res, 409, { error: "too many pinned files in this conversation" });
    return json(res, 200, { ok: true, pinned: body.pinned });
  };
}
