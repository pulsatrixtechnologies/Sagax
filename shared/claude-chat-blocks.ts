/**
 * Claude harness chat blocks: the Agent SDK `Artifact` tool (a published
 * page with a real URL) and Claude.ai `<antArtifact>` tags that leak into
 * assistant text. Both are untrusted model output. The chat already has
 * equivalents for markdown, ```chart, ```widget, ```email and AskUserQuestion;
 * this module only rewrites what the harness actually emits into those
 * fences or into a small page card. Invented URLs are dropped.
 */

export const ARTIFACT_TOOL = "Artifact";
export const ARTIFACT_HTML_MAX = 200_000;
export const ARTIFACT_TITLE_MAX = 200;

export function isArtifactTool(name: string | undefined): boolean {
  return (name ?? "").trim() === ARTIFACT_TOOL;
}

/** A published page the person can open. `path` is the local file the
 * harness wrote; it never becomes a link. `html` is inlined by the driver
 * when that file is a small HTML/SVG document. */
export interface ArtifactPage {
  title: string;
  url?: string;
  icon?: string;
  path?: string;
  html?: string;
}

const CHART_TYPES = new Set(["bar", "line", "area", "pie", "scatter"]);

/** https URLs, plus http on loopback. Userinfo is refused. */
export function isSafeHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  return false;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
          return (block as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
    return (content as { text: string }).text;
  }
  return "";
}

/** The published page from an Artifact tool_result, or null for a list
 * action, a failed publish, or a payload without a real URL. */
export function parseArtifactPublish(content: unknown): ArtifactPage | null {
  const text = toolResultText(content).trim();
  if (!text.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.artifacts)) return null;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!isSafeHttpUrl(url)) return null;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, ARTIFACT_TITLE_MAX) : "";
  const icon = typeof record.icon === "string" ? record.icon.trim().slice(0, 32) : "";
  const path = typeof record.path === "string" ? record.path.trim() : "";
  return {
    title: title || "Page",
    url,
    ...(icon ? { icon } : {}),
    ...(path ? { path } : {}),
  };
}

/** JSON in a ```artifact fence: a title and an optional real URL. HTML in
 * that fence stays a widget (parseArtifactPage returns null). Chart-shaped
 * JSON is refused so a mis-tagged ```artifact does not become a page card. */
export function parseArtifactPage(code: string): ArtifactPage | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.type === "string" && CHART_TYPES.has(record.type)) return null;
  if (Array.isArray(record.labels) && Array.isArray(record.series)) return null;
  if (Array.isArray(record.artifacts)) return null;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, ARTIFACT_TITLE_MAX) : "";
  const url = typeof record.url === "string" && isSafeHttpUrl(record.url.trim()) ? record.url.trim() : undefined;
  const icon = typeof record.icon === "string" ? record.icon.trim().slice(0, 32) : undefined;
  if (!title && !url) return null;
  return { title: title || "Page", ...(url ? { url } : {}), ...(icon ? { icon } : {}) };
}

/** The markdown the driver inserts when Artifact publishes. Host paths stay
 * out of the transcript; optional HTML rides a sibling ```widget fence. */
export function formatArtifactFence(page: ArtifactPage): string {
  const body: Record<string, string> = { title: page.title };
  if (page.url) body.url = page.url;
  if (page.icon) body.icon = page.icon;
  const lines = ["```artifact", JSON.stringify(body), "```"];
  if (page.html) lines.push("", "```widget", page.html.replace(/\n$/, ""), "```");
  return lines.join("\n");
}

const FENCE_BLOCK =
  /(^|\n)((?: {0,3}>[ \t]?)* {0,3})(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:\n(?: {0,3}>[ \t]?)* {0,3}\3[ \t]*(?=\n|$)|$)/g;

const ANT_ARTIFACT = /<antArtifact\b([^>]*)>([\s\S]*?)<\/antArtifact>/gi;
const ANT_ARTIFACT_OPEN = /<antArtifact\b[^>]*>/i;
const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;

function fenceAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(raw)) !== null) {
    out[match[1]!.toLowerCase()] = match[2]!;
  }
  return out;
}

function fenced(lang: string, body: string): string {
  const text = body.replace(/^\n/, "").replace(/\n$/, "");
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function langFromMime(type: string): string | null {
  if (type === "text/javascript" || type === "application/javascript") return "javascript";
  if (type === "text/typescript" || type === "application/typescript") return "typescript";
  if (type === "application/json" || type === "text/json") return "json";
  if (type === "text/css") return "css";
  if (type === "text/x-python" || type === "text/python") return "python";
  if (type.startsWith("text/x-")) return type.slice("text/x-".length);
  return null;
}

function looksLikeChart(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return typeof parsed.type === "string" && CHART_TYPES.has(parsed.type);
  } catch {
    return false;
  }
}

/** Turn one Claude.ai artifact tag into the Sagax fence the renderer already
 * knows. React/JSX stays a code fence: the widget sandbox has no network
 * and cannot load React. */
export function antArtifactToMarkdown(attributeSource: string, body: string): string {
  const attrs = fenceAttrs(attributeSource);
  const type = (attrs.type ?? "").trim().toLowerCase();
  const language = (attrs.language ?? "").trim();
  const trimmed = body.replace(/^\n/, "").replace(/\n$/, "");
  if (type === "application/vnd.sagax.cw+json") return fenced("cw", trimmed);
  if (type === "application/vnd.ant.mermaid" || type === "text/mermaid") return fenced("mermaid", trimmed);
  if (type === "text/markdown") return trimmed;
  if (type.includes("chart") || looksLikeChart(trimmed)) return fenced("chart", trimmed);
  if (type === "text/html" || type === "image/svg+xml" || type === "application/vnd.ant.html") {
    return fenced("widget", trimmed);
  }
  if (type === "application/vnd.ant.react" || type.includes("react")) {
    return fenced(language || "jsx", trimmed);
  }
  if (type === "application/vnd.ant.code") return fenced(language || langFromMime(type) || "text", trimmed);
  if (type.startsWith("text/") && type !== "text/plain") {
    return fenced(language || langFromMime(type) || "text", trimmed);
  }
  if (/^\s*</.test(trimmed)) return fenced("widget", trimmed);
  return fenced(language || "text", trimmed);
}

/** Rewrite complete `<antArtifact>` tags into fences. An unclosed tag (the
 * model is still streaming) is dropped so raw XML never flashes in the
 * bubble. Fenced code that documents the tag is left alone. */
export function liftClaudeChatBlocks(text: string): string {
  const parts: string[] = [];
  const protectedText = text.replace(FENCE_BLOCK, (match) => {
    const token = `\u0000OMB_FENCE_${parts.length}\u0000`;
    parts.push(match);
    return token;
  });
  let lifted = protectedText.replace(ANT_ARTIFACT, (_match, attrs: string, body: string) => `\n\n${antArtifactToMarkdown(attrs, body)}\n\n`);
  const unclosed = ANT_ARTIFACT_OPEN.exec(lifted);
  if (unclosed && !/<\/antArtifact>/i.test(lifted.slice(unclosed.index))) {
    lifted = lifted.slice(0, unclosed.index);
  }
  ANT_ARTIFACT_OPEN.lastIndex = 0;
  // NUL tokens cannot appear in model markdown; they mark protected fences.
  // eslint-disable-next-line no-control-regex -- intentional fence placeholders
  return lifted.replace(/\u0000OMB_FENCE_(\d+)\u0000/g, (_match, index: string) => parts[Number(index)] ?? "");
}
