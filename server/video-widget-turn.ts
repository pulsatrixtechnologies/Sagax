import type { SagaxVideoEmit } from "../shared/video-widget.ts";
import { videosFromToolOutput } from "../shared/video-widget.ts";
import { wireVideoFromEmit } from "./media-proxy.ts";
import type { Message } from "./store.ts";

export function videoMessagesFromTool(
  toolName: string,
  output: string | undefined,
  threadId: string,
  now = Date.now(),
): Array<Omit<Message, "id" | "at">> {
  const emits = videosFromToolOutput(toolName, output);
  if (!emits.length) return [];
  return emits.map((emit: SagaxVideoEmit) => ({
    role: "bot",
    kind: "video",
    video: wireVideoFromEmit(emit, threadId, now),
  }));
}
