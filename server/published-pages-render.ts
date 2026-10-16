// The bytes a published page is read as (shared/published-pages.ts has the
// isolation rules). An HTML page is the bot's document as written: it runs
// in an opaque-origin sandbox under a CSP with no network, so its scripts
// can only touch their own document. A Markdown page is turned into HTML
// here by a small renderer that escapes every character first and emits
// only a fixed set of tags (no raw HTML, links http(s) and mailto only), and
// it runs no script at all.
import { pageCsp, type PageKind } from "../shared/published-pages.ts";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(href) ? href : null;
}

/** Inline Markdown on an already escaped line: code, bold, italic, links. */
function inline(escaped: string): string {
  const codes: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    // The href is escaped text: &amp; is the only entity a URL keeps.
    const url = safeHref(href.replace(/&amp;/g, "&"));
    return url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${label}</a>` : match;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return out.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => codes[Number(index)] ?? "");
}

/** Markdown to an HTML body fragment. Pure. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map((line) => inline(escapeHtml(line))).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) body.push(lines[index++]!);
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]!.trim()))}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push("<hr>");
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote>${inline(escapeHtml(quote[1]!))}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

const MARKDOWN_STYLE = "body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2328;background:#fff}"
  + "pre{background:#f6f8fa;padding:.75rem;border-radius:6px;overflow:auto}code{font:.9em ui-monospace,Menlo,monospace}"
  + "blockquote{margin:0;padding-left:1rem;border-left:3px solid #d0d7de;color:#57606a}a{color:#0969da}"
  + "@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}pre{background:#161b22}a{color:#4493f8}}";

/** The full document a version is read as. `meta` adds the CSP as a meta tag
 * (the app's sandboxed preview, which has no response headers). Pure. */
export function pageDocument(input: { kind: PageKind; title: string; content: string; lang?: string }, options: { meta?: boolean } = {}): string {
  const meta = options.meta ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(pageCsp(input.kind, { meta: true }))}">` : "";
  if (input.kind === "markdown") {
    return `<!doctype html><html lang="${escapeHtml(input.lang ?? "fr")}"><head><meta charset="utf-8">${meta}`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>`
      + `<style>${MARKDOWN_STYLE}</style></head><body>${markdownToHtml(input.content)}</body></html>`;
  }
  if (!meta) return input.content;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(input.content);
  return doctype
    ? `${doctype[0]}${meta}${input.content.slice(doctype[0].length)}`
    : `${meta}${input.content}`;
}
