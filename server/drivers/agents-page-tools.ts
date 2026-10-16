// The published-page tool of the agents catalog (shared/published-pages.ts),
// spread into TOOL_DEFINITIONS in agents-catalog.ts. Definitions only;
// agents-call-cards.ts carries a call out and server/chat-widgets.ts writes
// the card. Every word here is sent to the model on every turn and pinned by
// agents-catalog-wire.test.ts.
export const PAGE_TOOL_DEFINITIONS = [
  {
    name: "propose_page",
    description:
      "Propose a web page the person can publish from this chat: a report, a one-page site or a small self-contained app. kind html is one complete document with inline CSS and JS; kind markdown is text. The page runs sandboxed: fetch, remote scripts, images and fonts are blocked (use data: URIs) and WebRTC is removed. This never publishes: the person reviews it on its card and chooses whether to publish and who can see it. To revise a page, call again with its page_id. Not available in rooms.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: 120 },
        kind: { type: "string", enum: ["html", "markdown"] },
        content: { type: "string", description: "The whole page, at most 512 KB." },
        page_id: { type: "string", description: "A page this conversation already has, for a new version." },
      },
      required: ["title", "kind", "content"],
    },
  },
];
