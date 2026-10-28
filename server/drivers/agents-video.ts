// make_video: a bot can ask for a video on every engine, including an
// organization turn whose host shell is withheld. This is not a new video
// service. The only producers already in the tree are the engine tools
// image_to_video and reference_to_video. When this turn does not offer
// them, the answer says so and starts nothing.
import type { Json } from "./agents-client.ts";
import type { ToolCallResult } from "./agents-call.ts";

export const VIDEO_TOOL_NAME = "make_video";

/** Engine tools that already produce a video. Not the shell. */
export const ENGINE_VIDEO_TOOLS = ["image_to_video", "reference_to_video"] as const;

export const VIDEO_PROVIDER_GAP = [
  "No video provider is connected for this turn.",
  "A description is produced by image_to_video, and an image already in the turn by reference_to_video, when this turn offers those tools.",
  "This tool does not start a shell, read a file, or call another service.",
  "Use those tools when they are listed. Otherwise tell the person that video is not connected on this engine.",
].join(" ");

export function videoToolDefinition() {
  return {
    name: VIDEO_TOOL_NAME,
    description: [
      "Ask for a video from a short description, or from an image the person already attached in this turn.",
      "If image_to_video or reference_to_video is in your tools, call that instead: it is the producer.",
      "This tool never runs a shell. If no producer is connected, it says so and does not invent one.",
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", maxLength: 2_000, description: "What the video should show." },
        image: { type: "string", maxLength: 500, description: "Optional reference already in this turn. Not a new upload and not a shell path to go fetch." },
      },
      required: ["prompt"],
    },
  };
}

/** The answer a model reads. No network, no process. */
export function callVideoTool(args: Json): ToolCallResult {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) return { text: "prompt: what the video should show.", isError: true };
  if (prompt.length > 2_000) return { text: "prompt is at most 2000 characters.", isError: true };
  if (args.image !== undefined && typeof args.image !== "string") return { text: "image is a short reference already in this turn.", isError: true };
  if (typeof args.image === "string" && args.image.trim().length > 500) return { text: "image is at most 500 characters.", isError: true };
  return { text: VIDEO_PROVIDER_GAP, isError: true };
}
