// Real markdown for bot bubbles: react-markdown + GFM (tables, task lists,
// strikethrough, autolinks) with a chromed code block — language label, copy
// button, lazy Shiki highlighting. Model output never reaches the DOM as raw
// HTML: no rehype-raw, so HTML in the text renders as text; Shiki's output is
// generator-escaped. While a message is still streaming, a code block renders
// as plain <pre> until its content has held still for STREAM_SETTLE_MS (the
// fence is very likely complete), then highlights and caches — so the settled
// bubble, a fresh component instance, mounts straight from cache instead of
// popping from plain to highlighted.
//
// Bidi: message text is written in the user's or the model's language, which
// is independent of the UI language, so every block resolves its own
// direction from its own first strong character — one Arabic paragraph reads
// right-to-left while the English one under it does not. Code is the
// exception: fenced blocks and inline spans pin dir="ltr" and isolate
// themselves, so a snippet never reorders and never scrambles the RTL
// sentence holding it.
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fromMarkdown, type Options as MarkdownParseOptions } from "mdast-util-from-markdown";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Hash,
  Info,
  Lightbulb,
  LoaderCircle,
  MessageSquareWarning,
  OctagonAlert,
  RotateCcw,
  TriangleAlert,
  WrapText,
} from "lucide-react";
import { remarkMentions, type MentionPeer } from "@/lib/mentions";

import {
  countLines,
  downloadSnippetFile,
  formatLineCount,
  getLanguageDisplayName,
  getSnippetFileName,
} from "../lib/code-block";
import { repairMarkdownTables } from "../lib/markdown-tables";
import { windowsPathDestinations } from "../../shared/markdown-windows-paths";
import { looksLikeThreadRefUrl, parseThreadRefUrl, resolveThreadRefAddress, remarkThreadRefs } from "../lib/thread-refs";
import { MarkdownImagePreview, useLocalFileSave, type MessageAttachmentContext } from "./AttachmentPreview";
import { ThreadLink, threadLinkFromProps, useThreadRefs } from "./ThreadRefs";
import { t } from "../lib/i18n";
import {
  headingSlug,
  isInlineRasterDataUrl,
  parseCalloutMarker,
  parseEmailBlock,
  richFenceKind,
  unclosedFenceOffset,
  type CalloutKind,
} from "../lib/rich-blocks";
import { EmailCard } from "./EmailCard";
import { WidgetFrame } from "./WidgetFrame";
import { ChartBlock } from "./ChartBlock";
import { RichTable, tableModelFromDelimited, tableModelFromMarkdown } from "./RichTable";

// tiny highlight cache so revisiting a thread doesn't re-tokenize settled
// blocks; keys are content-hashed and capped. Streamed partials may land here
// under their own hash — harmless (never collides with the final content's
// key, and the cap evicts it), and the final content's entry is exactly what
// makes the settled bubble render highlighted on mount.
const highlightCache = new Map<string, string>();
const CACHE_MAX = 200;
// rendered mermaid SVGs, keyed by skin scheme + content hash so revisiting a
// thread re-mounts straight from cache — same idea as highlightCache, smaller
// cap because SVGs are bigger than token streams
const mermaidCache = new Map<string, string>();
const MERMAID_CACHE_MAX = 50;
// every mermaid.render() call needs an id no earlier call used, including the
// calls that failed and may have left an orphan element behind
let mermaidRenderId = 0;
// how long a streaming block's content must be unchanged before we spend a
// tokenize on it — long enough to skip per-token churn mid-fence, short
// enough that the highlight lands before the stream settles
const STREAM_SETTLE_MS = 250;
// code blocks longer than this fold behind a "Show all" button
export const CODE_COLLAPSE_LINES = 30;
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

// A markdown link whose target is a file on this machine: bots hand over
// bot-created documents as absolute paths or file:// URLs. Web links stay
// ordinary anchors handled by the shell's window-open policy.
// A leading slash covers macOS and Linux; "C:\…" and "C:/…" cover Windows,
// where a file:// URL's pathname also arrives as "/C:/…".
const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/;
const absolutePath = (value: string): string | null => {
  if (value.startsWith("/") || WINDOWS_PATH.test(value)) return value;
  return null;
};

export const localFilePath = (href?: string): string | null => {
  if (!href) return null;
  // URL schemes are case-insensitive, so FILE:// is as valid as file://
  if (/^file:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.username || url.password || url.port || url.search || url.hash) return null;
      const path = decodeURIComponent(url.pathname);
      if (url.hostname && url.hostname !== "localhost") return `//${url.hostname}${path}`;
      // WHATWG file URLs spell a Windows drive as /C:/ on every host. Only
      // strip that sentinel for an actual file URL: a raw /C:/... Markdown
      // target is a distinct POSIX path and must retain its identity.
      return /^\/[a-z]:[\\/]/i.test(path) ? path.slice(1) : absolutePath(path);
    } catch {
      return null;
    }
  }
  if (href.startsWith("\\\\")) return href;
  // Forward-slash //host/path is a protocol-relative web URL in Markdown.
  // UNC remains available through backslashes or file://server/share.
  if (href.startsWith("//")) return null;
  const absolute = absolutePath(href);
  if (absolute) return absolute;
  if (href.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  return href;
};

/** Keep only the local URL spellings our message-scoped file renderer knows
 * about; all ordinary links still use react-markdown's protocol allow-list. */
export function chatUrlTransform(value: string, key?: string): string {
  // thread links render as chips below, never as external anchors; the
  // scheme must survive the allow-list so the anchor component sees it
  if (looksLikeThreadRefUrl(value)) return value;
  // an inline raster image needs no network and runs no script; only an
  // image source may use one (a link to data: stays stripped)
  if (key === "src" && isInlineRasterDataUrl(value)) return value;
  // Markdown-to-HTML percent-encodes a destination's backslashes, so
  // C:\Users\Maus\report.md arrives as C:%5CUsers%5CMaus%5Creport.md and no
  // longer looked like a drive path: the link rendered dead and the image as
  // unavailable. Restore the separators; other escapes stay for the server's
  // single decode.
  const url = /^[a-zA-Z]:%5C/i.test(value) ? value.replace(/%5C/gi, "\\") : value;
  if (/^file:\/\//i.test(url) || WINDOWS_PATH.test(url) || url.startsWith("\\\\")) {
    return localFilePath(url) ? url : "";
  }
  return defaultUrlTransform(value);
}

/** Parse link destinations exactly as server/message-file.ts does. */
function remarkWindowsPathDestinations(this: { data(): object }) {
  const data = this.data() as { fromMarkdownExtensions?: unknown[] };
  (data.fromMarkdownExtensions ??= []).push(windowsPathDestinations);
}

// Reuse the renderer's installed GFM plugin, including literal autolinks.
const gfmParseData: {
  micromarkExtensions?: MarkdownParseOptions["extensions"];
  fromMarkdownExtensions?: MarkdownParseOptions["mdastExtensions"];
} = {};
remarkGfm.call({ data: () => gfmParseData });
const normalizationParseOptions: MarkdownParseOptions = {
  extensions: gfmParseData.micromarkExtensions,
  mdastExtensions: [...(gfmParseData.fromMarkdownExtensions ?? []), windowsPathDestinations],
};

function unwrapLinkedImages() {
  return (tree: { children?: any[] }) => {
    const visit = (node: { children?: any[] }) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child?.type === "link" && child.children?.length === 1 && child.children[0]?.type === "image") {
          const image = child.children[0];
          return { ...image, data: { ...image.data, hProperties: { ...image.data?.hProperties, "data-open-url": child.url } } };
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

// Direction is resolved here rather than delegated to HTML's dir="auto",
// because that algorithm skips any descendant carrying its own dir: a
// <blockquote dir="auto"> whose paragraphs each resolve their own direction
// finds no text left to judge and silently falls back to the app's LTR,
// putting its rule on the left of right-to-left prose. Same trap for a table
// whose cells resolve individually — the columns never reverse.
//
// Code is skipped when judging: an answer that opens with `fs.readFileSync`
// and continues in Arabic is an Arabic paragraph, not an English one.
// JS regexes cannot match on Bidi_Class, and naming scripts one at a time has
// no end to it: Hanifi Rohingya, Yezidi, Garay and Old Uyghur are all
// right-to-left, and Unicode keeps adding more. These are instead the blocks
// Unicode reserves for right-to-left letters, so the set stays correct
// without being maintained — and a plane-1 range is one comparison rather
// than a property lookup.
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** Direction of `value`, from its first strong character (letters only —
 * digits and punctuation are directionally weak). Defaults to "ltr". */
export function textDirection(value: string): "rtl" | "ltr" {
  const strong = /\p{Letter}/u.exec(value);
  return strong && RTL_LETTER.test(strong[0]) ? "rtl" : "ltr";
}

interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

function blockText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  if (node.tagName === "code" || node.tagName === "pre") return "";
  return (node.children ?? []).map(blockText).join("");
}

/** Direction a rendered block adopts, read from its own text. */
export function blockDirection(node: unknown): "rtl" | "ltr" {
  return textDirection(blockText(node as HastNode));
}

/** Props react-markdown hands a block component we only re-tag. */
interface BlockProps {
  node?: unknown;
  children?: ReactNode;
}

/** Props for the {@link CodeBlock} component. */
export interface CodeBlockProps {
  /** Source code snippet to display. */
  code: string;
  /** Language identifier from markdown fence, e.g. "ts", "python". */
  lang: string;
  /** Whether the parent message is still actively receiving tokens. */
  streaming: boolean;
}

/**
 * Chromed code block component for rendered markdown messages.
 * Features syntax highlighting with Shiki, language normalization badge,
 * line count indicator, word wrap toggle, and accessible clipboard copy with status feedback.
 *
 * @param props - Component props containing code string, language identifier, and streaming flag.
 * @returns Rendered code block element.
 */
export function CodeBlock({ code, lang, streaming }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const key = `${lang}:${hash(code)}`;
    const cached = highlightCache.get(key);
    if (cached) return setHtml(cached);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const highlight = () => {
      import("shiki")
        .then((shiki) =>
          shiki.codeToHtml(code, {
            lang: lang || "text",
            themes: {
              light: "github-light-default",
              dark: "github-dark-default",
            },
            defaultColor: "light-dark()",
          }),
        )
        .then((out) => {
          if (!alive) return;
          if (highlightCache.size >= CACHE_MAX) {
            const first = highlightCache.keys().next().value;
            if (first) highlightCache.delete(first);
          }
          highlightCache.set(key, out);
          setHtml(out);
        })
        .catch(() => {
          /* unknown language or shiki failed — the plain <pre> stays */
        });
    };
    if (streaming) {
      // any earlier highlight is of a shorter snapshot — drop it so the
      // growing plain <pre> shows the real content, then wait for the block
      // to hold still. The effect re-runs (and this cleanup clears the timer)
      // on every content change, which is the debounce.
      setHtml(null);
      timer = setTimeout(highlight, STREAM_SETTLE_MS);
    } else {
      highlight();
    }
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [code, lang, streaming]);

  const copy = () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        if (copyTimeoutRef.current !== null) {
          clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard write rejected or failed silently
      });
  };

  const download = () => {
    const filename = getSnippetFileName(lang);
    downloadSnippetFile(filename, code);
  };

  const displayLanguage = getLanguageDisplayName(lang);
  const lineCount = countLines(code);
  // a long output folds to its first screenful; the stream never folds, so
  // a growing block does not jump between states
  const collapsible = !streaming && lineCount > CODE_COLLAPSE_LINES;
  const folded = collapsible && !expanded;

  // Code reads left-to-right whatever language surrounds it, so the block pins
  // its own direction rather than inheriting the message's.
  return (
    <div dir="ltr" className="my-2 overflow-hidden rounded-lg border border-hairline/40 bg-inset">
      <div className="flex items-center justify-between gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-1.5 text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span title={displayLanguage} className="min-w-0 truncate rounded border border-hairline/40 bg-raised px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink select-none">
            {displayLanguage}
          </span>
          {lineCount > 0 && (
            <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-secondary select-none">
              {formatLineCount(lineCount)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setWrapLines((w) => !w)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
              wrapLines
                ? "bg-accent/15 text-accent font-medium"
                : "text-ink-secondary hover:bg-raised hover:text-ink"
            }`}
            title={wrapLines ? "Disable line wrapping" : "Wrap long lines"}
            aria-label={wrapLines ? "Disable line wrapping" : "Wrap long lines"}
            aria-pressed={wrapLines}
          >
            <WrapText size={12} aria-hidden="true" />
            <span className="hidden sm:inline">{wrapLines ? "Unwrap" : "Wrap"}</span>
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink transition-colors"
            title="Download snippet as file"
            aria-label="Download snippet as file"
          >
            <Download size={12} aria-hidden="true" />
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink transition-colors"
            title={copied ? "Copied to clipboard" : "Copy code"}
            aria-label={copied ? "Code copied to clipboard" : "Copy code to clipboard"}
          >
            {copied ? (
              <>
                <Check size={12} className="text-success" aria-hidden="true" />
                <span className="text-success font-medium hidden sm:inline">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={12} aria-hidden="true" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div className={folded ? "relative max-h-[22rem] overflow-hidden" : undefined}>
      {html ? (
        <div
          className={`text-[12px] leading-[18px] [&_pre]:!bg-transparent [&_pre]:m-0 [&_pre]:p-3 ${
            wrapLines
              ? "whitespace-pre-wrap break-words overflow-x-hidden [&_pre]:!whitespace-pre-wrap [&_pre]:!break-words [&_code]:!whitespace-pre-wrap [&_code]:!break-words"
              : "overflow-x-auto"
          }`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={`p-3 text-[12px] leading-[18px] text-ink ${
            wrapLines
              ? "whitespace-pre-wrap break-words overflow-x-hidden"
              : "overflow-x-auto"
          }`}
        >
          {code}
        </pre>
      )}
      {folded && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-inset to-transparent" />}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1 border-t border-hairline/30 bg-raised/20 px-3 py-1.5 text-[11.5px] text-ink-secondary hover:bg-raised/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        >
          {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          {expanded ? t("rich.code.collapse") : t("rich.code.expand", { count: lineCount })}
        </button>
      )}
    </div>
  );
}

/** Scheme of the nearest skin, read the same way the Shiki blocks read it:
 * from the --code-color-scheme token, which resolves through any data-skin
 * subtree. Anything unreadable falls back to dark, the default skin's value. */
function mermaidScheme(element: HTMLElement | null): "dark" | "light" {
  if (!element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return "dark";
  try {
    return window.getComputedStyle(element).getPropertyValue("--code-color-scheme").trim() === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/** Props for the {@link MermaidDiagram} component. */
export interface MermaidDiagramProps {
  /** Mermaid diagram source from a fenced code block. */
  code: string;
  /** Whether the parent message is still actively receiving tokens. */
  streaming: boolean;
}

const MERMAID_FONT = '"Inter", -apple-system, BlinkMacSystemFont, "SF UI Text", "Segoe UI", system-ui, sans-serif';

/**
 * Mermaid fence renderer: draws the diagram instead of highlighting its
 * source. Mermaid is a heavy import, so it loads only when a diagram fence
 * actually appears — the same lazy pattern Shiki uses. The SVG
 * mermaid.render() returns under securityLevel "strict" is the only thing
 * injected; a diagram that fails to parse falls back to its source with the
 * error above it, and a still-streaming block stays plain source so a
 * half-arrived diagram never flashes a parse error.
 *
 * @param props - Component props containing the mermaid source and streaming flag.
 * @returns Rendered diagram, or the source with the parse error.
 */
export function MermaidDiagram({ code, streaming }: MermaidDiagramProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [skinEpoch, setSkinEpoch] = useState(0);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skins are stamped on <html>, a subtree could someday carry its own, so
  // watch the whole document for data-skin changes and re-render the diagram
  // in the new scheme. Both schemes stay cached, like Shiki's dual palette.
  useEffect(() => {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const observer = new MutationObserver(() => setSkinEpoch((epoch) => epoch + 1));
    observer.observe(document.documentElement, { subtree: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scheme = mermaidScheme(frame.current);
    const key = `${scheme}:${hash(code)}`;
    const cached = mermaidCache.get(key);
    if (cached) {
      setSvg(cached);
      setError(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const render = () => {
      import("mermaid")
        .then((module) => {
          mermaidRenderId += 1;
          module.default.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: scheme === "light" ? "default" : "dark",
            fontFamily: MERMAID_FONT,
          });
          return module.default.render(`omb-mermaid-${mermaidRenderId}`, code);
        })
        .then((out) => {
          if (!alive) return;
          if (mermaidCache.size >= MERMAID_CACHE_MAX) {
            const first = mermaidCache.keys().next().value;
            if (first) mermaidCache.delete(first);
          }
          mermaidCache.set(key, out.svg);
          setSvg(out.svg);
          setError(null);
        })
        .catch((cause: unknown) => {
          // a streaming diagram is probably just incomplete: keep the source
          // up and stay quiet until the stream settles and re-runs this effect
          if (!alive || streaming) return;
          const message = cause instanceof Error ? cause.message : String(cause);
          setError(message.length > 300 ? `${message.slice(0, 300)}…` : message);
        });
    };
    if (streaming) {
      // an earlier render is of a shorter snapshot — drop it so the growing
      // source shows the real content, then wait for the block to hold still
      setSvg(null);
      setError(null);
      timer = setTimeout(render, STREAM_SETTLE_MS);
    } else {
      render();
    }
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [code, streaming, skinEpoch]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const copy = () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        if (copyTimeoutRef.current !== null) {
          clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard write rejected or failed silently
      });
  };

  // Diagrams read left-to-right whatever language surrounds them, so the
  // frame pins its own direction rather than inheriting the message's.
  return (
    <div ref={frame} dir="ltr" className="my-2 overflow-hidden rounded-lg border border-hairline/40 bg-inset">
      <div className="flex items-center justify-between gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-1.5 text-xs">
        <span title="Mermaid diagram" className="min-w-0 truncate rounded border border-hairline/40 bg-raised px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink select-none">
          Mermaid diagram
        </span>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setShowSource((visible) => !visible)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
              showSource
                ? "bg-accent/15 text-accent font-medium"
                : "text-ink-secondary hover:bg-raised hover:text-ink"
            }`}
            title={showSource ? "Hide diagram source" : "Show diagram source"}
            aria-label={showSource ? "Hide diagram source" : "Show diagram source"}
            aria-pressed={showSource}
          >
            <WrapText size={12} aria-hidden="true" />
            <span className="hidden sm:inline">{showSource ? "Hide source" : "Show source"}</span>
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink transition-colors"
            title={copied ? "Copied to clipboard" : "Copy diagram source"}
            aria-label={copied ? "Diagram source copied to clipboard" : "Copy diagram source to clipboard"}
          >
            {copied ? (
              <>
                <Check size={12} className="text-success" aria-hidden="true" />
                <span className="text-success font-medium hidden sm:inline">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={12} aria-hidden="true" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="px-3 pt-2 text-[12px] text-danger">
          Diagram could not be rendered: {error}
        </p>
      )}
      {svg && (
        <div
          className="overflow-x-auto p-3 [&_svg]:!max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {(showSource || !svg || error) && (
        <pre className="overflow-x-auto p-3 text-[12px] leading-[18px] text-ink">{code}</pre>
      )}
    </div>
  );
}

// A bot handing over a file it created renders as a button, not an anchor.
// Two reasons the href is dropped rather than merely preventDefault()ed:
// an absolute path in an href resolves against the page origin, so the link
// pointed at http://127.0.0.1:8799<path> and opened the chat UI in a browser;
// and an <a href="file://…"> would still reach setWindowOpenHandler on a
// middle or modifier click, which calls shell.openExternal without the main
// process' containment check.
function LocalFileLink({ filePath, children, message }: { filePath: string; children?: ReactNode; message?: MessageAttachmentContext }) {
  const save = useLocalFileSave(filePath, undefined, message);
  if (!message) {
    return <span title="Unavailable legacy file reference" className="break-words text-ink-secondary">{children}</span>;
  }
  const label = save.state === "saving"
    ? "Saving…"
    : save.state === "saved"
      ? "Saved"
      : save.state === "failed"
        ? "Retry"
        : null;

  return (
    <span dir="ltr" className="inline-flex flex-wrap items-center gap-x-1.5 [unicode-bidi:isolate]">
      <button
        type="button"
        onClick={() => void save.save()}
        disabled={save.state === "saving"}
        title="Save a copy"
        className="inline-flex items-center gap-1 break-words text-start text-accent underline decoration-accent/40 hover:decoration-accent disabled:cursor-wait"
      >
        {children}
        {save.state === "saving" ? (
          <LoaderCircle size={12} className="shrink-0 animate-spin" aria-hidden="true" />
        ) : save.state === "saved" ? (
          <Check size={12} className="shrink-0 text-success" aria-hidden="true" />
        ) : save.state === "failed" ? (
          <RotateCcw size={12} className="shrink-0" aria-hidden="true" />
        ) : (
          <Download size={12} className="shrink-0" aria-hidden="true" />
        )}
      </button>
      {label && (
        <span
          role={save.state === "failed" ? "alert" : "status"}
          title={save.state === "saved" ? save.savedTo : undefined}
          className={`text-[12px] ${save.state === "saved" ? "text-success" : save.state === "failed" ? "text-danger" : "text-ink-secondary"}`}
        >
          {save.state === "failed" ? save.reason : label}
        </span>
      )}
    </span>
  );
}

export function markdownImageName(src: string, alt?: string): string {
  const supplied = alt?.trim();
  if (supplied) return supplied;
  try {
    const path = decodeURIComponent(new URL(src, "https://openmausbot.invalid").pathname);
    const name = path.split(/[\\/]/).filter(Boolean).at(-1)?.trim();
    if (name) return name;
  } catch {
    // A malformed source still gets a useful accessible fallback.
  }
  return "Image";
}

export function markdownImageOpenUrl(src: string): string | undefined {
  try {
    const url = new URL(src.startsWith("//") ? `https:${src}` : src);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// Spoiler spans: GFM parses ~~text~~ to <del>; in bot messages that content
// is usually a spoiler (answers, plot points, surprises), not a deletion —
// hide it behind a tap-to-reveal chip instead of striking it through.
// Display only: the stored markdown, exports, and the model's own context
// all keep the raw ~~text~~.
function Spoiler({ children }: { children?: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (!revealed) {
    return (
      <span className="relative mx-px inline-block rounded px-1 py-px">
        <span
          aria-hidden="true"
          className="pointer-events-none select-none bg-raised text-transparent [&_*]:!text-transparent [&_a]:!no-underline"
        >
          {children}
        </span>
        <button
          type="button"
          aria-label="Reveal spoiler"
          title="Reveal spoiler"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 rounded bg-raised/90"
        />
      </span>
    );
  }
  return (
    <span className="mx-px inline rounded px-1 py-px text-ink underline decoration-dotted decoration-hairline underline-offset-2">
      {children}
      <button
        type="button"
        aria-label="Hide spoiler"
        title="Hide spoiler"
        onClick={() => setRevealed(false)}
        className="ms-1 rounded px-0.5 text-[11px] text-ink-secondary hover:text-ink"
      >
        Hide
      </button>
    </span>
  );
}

const NO_MENTION_PEERS: readonly MentionPeer[] = [];

// A markdown image resolves its attachment by its original source offset.
const MARKDOWN_IMAGE = "![";

// A currency sign glued to its code and followed by an amount ("R$ 120",
// "US$5") is money, never a math delimiter.
const CURRENCY_DOLLAR = /(?<![$\p{L}\p{N}])(?:R|US|AU|A|CA|C|NZ|HK|SG|S|MX|NT|BZ|Z)\$(?=[ \t\u00a0]?\d)/gu;

/** Escape every single `$` that cannot delimit inline math, so prices such as
 * "$5 and $10" or "R$ 120 ... R$ 120" stay prose instead of turning the text
 * between them into a formula. Follows Pandoc's rule: an opening `$` is
 * followed by non-space, a closing `$` is preceded by non-space and not
 * followed by a digit, and the pair stays inside one paragraph. A `$` that
 * fails as a closer abandons the open span rather than skipping past it. */
function escapeLiteralDollars(text: string): string {
  const display: string[] = [];
  const hidden = text
    .replace(/\$\$[\s\S]*?\$\$/g, (math) => `\u0000OMB_MATH_${display.push(math) - 1}\u0000`)
    .replace(CURRENCY_DOLLAR, (sign) => `${sign.slice(0, -1)}\\$`);
  const literal = new Set<number>();
  const singles: number[] = [];
  for (let i = 0; i < hidden.length; i++) {
    if (hidden[i] === "\\") i++;
    else if (hidden[i] === "$") singles.push(i);
  }
  let open: number | null = null;
  for (const at of singles) {
    if (open !== null) {
      const closes = !/\s/.test(hidden[at - 1]) && !/\d/.test(hidden[at + 1] ?? "")
        && !/\n[ \t]*\n/.test(hidden.slice(open, at));
      if (closes) { open = null; continue; }
      literal.add(open);
    }
    open = /\S/.test(hidden[at + 1] ?? "") ? at : null;
    if (open === null) literal.add(at);
  }
  if (open !== null) literal.add(open);
  let escaped = "";
  for (let i = 0; i < hidden.length; i++) escaped += literal.has(i) ? "\\$" : hidden[i];
  display.forEach((math, index) => {
    escaped = escaped.split(`\u0000OMB_MATH_${index}\u0000`).join(math);
  });
  return escaped;
}

/** Convert the TeX delimiters models commonly emit into remark-math syntax.
 * Fenced and inline code are protected so examples such as `\\(x\\)` remain
 * literal. Unmatched delimiters are left untouched while a response streams,
 * and dollar signs that read as money are escaped. */
export function normalizeMathDelimiters(text: string, imageOffsets?: Map<number, number>): string {
  const protectedCode: Array<{ value: string; sourceOffset: number }> = [];
  const protect = (value: string, sourceOffset: number): string => {
    const token = `\u0000OMB_CODE_${protectedCode.length}\u0000`;
    protectedCode.push({ value, sourceOffset });
    return token;
  };
  const spans: Array<{ start: number; end: number }> = [];
  const imageStarts: number[] = [];
  const visit = (node: { type: string; children?: any[]; position?: { start: { offset?: number }; end: { offset?: number } } }, protectedParent = false) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const image = node.type === "image" || node.type === "imageReference";
    if (image && start !== undefined) imageStarts.push(start);
    // Explicit links leave their labels available for math normalization;
    // protect only the trailing destination syntax. Autolinks stay intact.
    const labelEnd = node.type === "link" && start !== undefined && text[start] === "["
      ? node.children?.at(-1)?.position?.end.offset : undefined;
    const protectedNode = node.type === "code" || node.type === "inlineCode" || node.type === "definition" || node.type === "linkReference" || node.type === "link" || (imageOffsets !== undefined && image);
    if (!protectedParent && protectedNode && start !== undefined && end !== undefined) {
      spans.push({ start: labelEnd ?? start, end });
    }
    node.children?.forEach((child) => visit(child, protectedParent || (protectedNode && labelEnd === undefined)));
  };
  visit(fromMarkdown(text, normalizationParseOptions));
  for (const { start, end } of spans.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + protect(text.slice(start, end), start) + text.slice(end);
  }
  let normalized = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$\n${math}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`)
    // remark-math treats flow math as a block only when the fences occupy
    // their own lines; accept the compact form models commonly produce.
    .replace(/\$\$[ \t]*([^\n][\s\S]*?)[ \t]*\$\$/g, (_match, math: string) => `$$\n${math}\n$$`);
  normalized = escapeLiteralDollars(normalized);
  let shift = 0;
  // oxlint-disable-next-line no-control-regex -- restore opaque code and image sentinels
  normalized = normalized.replace(/\u0000OMB_CODE_(\d+)\u0000/g, (token, index: string, at: number) => {
    const part = protectedCode[Number(index)];
    if (!part) return token;
    const { value, sourceOffset } = part;
    // A protected reference link can contain images of its own. Their raw
    // positions stay relative to that unchanged span when it is restored.
    for (const imageOffset of imageStarts) {
      if (imageOffset >= sourceOffset && imageOffset < sourceOffset + value.length) {
        imageOffsets?.set(at + shift + imageOffset - sourceOffset, imageOffset);
      }
    }
    shift += value.length - token.length;
    return value;
  });
  return normalized;
}

// GitHub alerts: "> [!NOTE]" (and TIP, IMPORTANT, WARNING, CAUTION) as the
// first line of a blockquote turns it into a callout. The marker is removed
// from the text and carried as data-callout / data-callout-title.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
}

export function remarkCallouts() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      for (const child of node.children ?? []) visit(child);
      if (node.type !== "blockquote") return;
      const paragraph = node.children?.[0];
      const first = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
      if (!paragraph || first?.type !== "text" || !first.value) return;
      const marker = parseCalloutMarker(first.value);
      if (!marker) return;
      const newline = first.value.indexOf("\n");
      first.value = newline === -1 ? "" : first.value.slice(newline + 1);
      if (!first.value) {
        paragraph.children = paragraph.children!.slice(1);
        // a line break right after the marker would open the body with a gap
        if (paragraph.children[0]?.type === "break") paragraph.children = paragraph.children.slice(1);
      }
      if (!paragraph.children!.length) node.children = node.children!.slice(1);
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, "data-callout": marker.kind, "data-callout-title": marker.title } };
    };
    visit(tree);
  };
}

const CALLOUT_STYLE: Record<CalloutKind, { icon: typeof Info; tone: string; label: Parameters<typeof t>[0] }> = {
  note: { icon: Info, tone: "border-[#2a78d6] text-[#2a78d6] [--callout-bg:rgb(42_120_214/0.08)]", label: "rich.callout.note" },
  tip: { icon: Lightbulb, tone: "border-success text-success [--callout-bg:color-mix(in_srgb,var(--color-success)_9%,transparent)]", label: "rich.callout.tip" },
  important: { icon: MessageSquareWarning, tone: "border-[#8a63d2] text-[#8a63d2] [--callout-bg:rgb(138_99_210/0.09)]", label: "rich.callout.important" },
  warning: { icon: TriangleAlert, tone: "border-warning text-warning [--callout-bg:color-mix(in_srgb,var(--color-warning)_9%,transparent)]", label: "rich.callout.warning" },
  caution: { icon: OctagonAlert, tone: "border-danger text-danger [--callout-bg:color-mix(in_srgb,var(--color-danger)_9%,transparent)]", label: "rich.callout.caution" },
};

export function Callout({ kind, title, dir, children }: { kind: CalloutKind; title?: string; dir?: "ltr" | "rtl"; children?: ReactNode }) {
  const style = CALLOUT_STYLE[kind];
  const Icon = style.icon;
  return (
    <div dir={dir} role="note" data-callout={kind} className={`my-2 rounded-lg border-s-[3px] bg-[var(--callout-bg)] px-3 py-2 ${style.tone}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
        <Icon size={14} aria-hidden="true" className="shrink-0" />
        <span>{title || t(style.label)}</span>
      </div>
      <div className="text-ink [&>*+*]:mt-2">{children}</div>
    </div>
  );
}

/** Scroll to an element of this message by fragment. Heading and footnote
 * ids carry a per-message prefix so two messages never collide. */
function scrollToFragment(fragment: string, prefix: string): boolean {
  if (typeof document === "undefined") return false;
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // keep the raw spelling
  }
  const target = document.getElementById(id) ?? document.getElementById(`${prefix}${id}`);
  if (!target) return false;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  if (target instanceof HTMLElement) {
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
  return true;
}

const HEADING_CLASS: Record<string, string> = {
  // Scaled to the 13 px body (Perspicax v3's body step): the two top levels
  // step up, h3 to h5 hold the body size in semibold, h6 steps down.
  h1: "mt-2 text-[15px] leading-[22px] font-semibold",
  h2: "mt-2 text-[14px] font-semibold",
  h3: "mt-1.5 font-semibold",
  h4: "mt-1.5 font-semibold",
  h5: "mt-1.5 font-semibold",
  h6: "mt-1.5 text-[12px] font-semibold text-ink-secondary",
};

const nodeOffset = (node: unknown): number | undefined =>
  (node as { position?: { start?: { offset?: number } } } | undefined)?.position?.start?.offset;

/** Render message Markdown with math, protected code, scoped attachments, and mentions. */
function ChatMarkdownComponent({ text, streaming = false, message, mentionPeers = NO_MENTION_PEERS, everyone = false }: {
  text: string; streaming?: boolean; message?: MessageAttachmentContext;
  mentionPeers?: readonly MentionPeer[]; everyone?: boolean;
}) {
  // "#Title" mentions link to the threads the person can see (ThreadRefs);
  // @mentions were already decorated by remarkMentions, which runs first.
  const { threads, currentBotId } = useThreadRefs();
  // A near-miss table from a model renders as an unreadable run of pipes
  // unless it is repaired before parsing. Table repair moves image source
  // offsets, so image messages skip that repair but still normalize math.
  const imageOffsets = text.includes(MARKDOWN_IMAGE) ? new Map<number, number>() : undefined;
  const source = normalizeMathDelimiters(imageOffsets
    ? text
    : repairMarkdownTables(text), imageOffsets);
  // read by the memoized img renderer: the map is rebuilt with each text
  const imageOffsetsRef = useRef(imageOffsets);
  imageOffsetsRef.current = imageOffsets;
  // A fence the message has not closed yet is still being written: widgets,
  // charts and diagrams wait for it rather than render a half document.
  const openFence = unclosedFenceOffset(source);
  // ids of headings and footnotes are unique per message
  const prefix = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;
  const slugs = useRef(new Map<string, number>());
  slugs.current = new Map();
  const threadId = message?.threadId;
  const messageId = message?.messageId;

  // One components map per (stream state, message, fence state), so a
  // re-render with the same inputs keeps every custom block mounted: an
  // iframe widget or a chart is not torn down and rebuilt on each token.
  const components = useMemo<Components>(() => {
    const scopedMessage = threadId && messageId ? { threadId, messageId } : undefined;
    const pendingAt = (node: unknown) => {
      if (streaming) return true;
      const offset = nodeOffset(node);
      return openFence >= 0 && offset !== undefined && offset >= openFence;
    };
    const heading = (tag: keyof typeof HEADING_CLASS) => function Heading({ node, children }: BlockProps) {
      const base = headingSlug(blockText(node as HastNode));
      const seen = slugs.current.get(base) ?? 0;
      slugs.current.set(base, seen + 1);
      const id = `${prefix}${seen ? `${base}-${seen}` : base}`;
      return (
        <div dir={blockDirection(node)} className={HEADING_CLASS[tag]} id={id} role="heading" aria-level={Number(tag.slice(1))}>
          {children}
          <a
            href={`#${id}`}
            onClick={(event) => {
              event.preventDefault();
              scrollToFragment(id, prefix);
            }}
            aria-label={t("rich.headingAnchor")}
            className="chat-heading-anchor ms-1.5 inline-flex align-middle text-ink-secondary"
          >
            <Hash size={12} aria-hidden="true" />
          </a>
        </div>
      );
    };
    return {
      pre({ node, children }: { node?: unknown; children?: ReactNode }) {
        // fenced code arrives as <pre><code class="language-x">…</code></pre>
        const child: any = Array.isArray(children) ? children[0] : children;
        const className: string = child?.props?.className ?? "";
        const lang = /language-([^\s]+)/.exec(className)?.[1] ?? "";
        // children can be a string OR an array of strings/nodes: flatten
        // strings only, so String() never comma-joins an array
        const flat = (n: any): string =>
          typeof n === "string" ? n : Array.isArray(n) ? n.map(flat).join("") : (n?.props?.children ? flat(n.props.children) : "");
        const code = flat(child?.props?.children).replace(/\n$/, "");
        const pending = pendingAt(node);
        // a mermaid fence is a picture, not a program: hand it to the
        // diagram renderer instead of the highlighter
        if (lang.trim().toLowerCase() === "mermaid") {
          return <MermaidDiagram code={code} streaming={pending} />;
        }
        const kind = richFenceKind(lang);
        const email = kind === "email" || !kind ? parseEmailBlock(code, lang) : null;
        if (email) return <EmailCard draft={email} pending={pending} />;
        if (kind === "widget") return <WidgetFrame code={code} pending={pending} />;
        if (kind === "chart") return <ChartBlock code={code} pending={pending} />;
        if (kind === "csv" && !pending) {
          const model = tableModelFromDelimited(code, lang);
          if (model && model.header.length > 0) return <RichTable model={model} />;
        }
        return <CodeBlock code={code} lang={lang} streaming={pending} />;
      },
      img(props) {
        const { src, alt } = props;
        if (!src) {
          return <span className="text-[12px] text-danger" role="alert">Image unavailable</span>;
        }
        const filePath = localFilePath(src) ?? undefined;
        const sourceOffset = (props as { node?: { position?: { start?: { offset?: number } } } })
          .node?.position?.start?.offset;
        return (
          <MarkdownImagePreview
            src={src}
            name={markdownImageName(src, alt)}
            openUrl={markdownImageOpenUrl(typeof (props as Record<string, unknown>)["data-open-url"] === "string" ? String((props as Record<string, unknown>)["data-open-url"]) : src)}
            filePath={filePath}
            message={filePath ? scopedMessage : undefined}
            sourceOffset={sourceOffset === undefined ? undefined : imageOffsetsRef.current?.get(sourceOffset) ?? sourceOffset}
          />
        );
      },
      code({ children }: { children?: ReactNode }) {
        // break-words because a path or an identifier can be longer than
        // the bubble is wide, and an unbreakable token has nowhere to go
        // but outside it, off the left edge in a right-to-left paragraph,
        // where the line ends.
        return (
          <code dir="ltr" className="rounded bg-inset px-1 py-px text-[12px] break-words [unicode-bidi:isolate]">{children}</code>
        );
      },
      // markdown never emits a span itself (no raw HTML); the only
      // spans are the ones our remark plugins produced: a thread link,
      // or an @mention highlight that must keep its class and colour
      span(props) {
        // SAFETY: react-markdown hands hast data-* attributes through as string props
        const link = threadLinkFromProps(props as Record<string, unknown>);
        if (link) return <ThreadLink target={link.target} ambiguous={link.ambiguous}>{props.children}</ThreadLink>;
        const { node: _node, children, ...rest } = props;
        return <span {...rest}>{children}</span>;
      },
      a({ href, children, ...rest }: { href?: string; children?: ReactNode; node?: unknown; id?: string }) {
        // an in-message fragment (footnote, heading) scrolls in place; it is
        // never handed to the shell as a new window
        if (href?.startsWith("#")) {
          const fragment = href.slice(1);
          return (
            <a
              href={href}
              id={rest.id}
              onClick={(event) => {
                if (scrollToFragment(fragment, prefix)) event.preventDefault();
              }}
              className="text-accent underline decoration-accent/40 hover:decoration-accent"
            >
              {children}
            </a>
          );
        }
        // a canonical thread link is a chip whatever text carries it;
        // a dead one keeps its label as plain text rather than handing
        // the app's own scheme to the shell
        const address = href ? parseThreadRefUrl(href) : null;
        const ref = address ? resolveThreadRefAddress(threads, address, currentBotId) : null;
        if (ref) return <ThreadLink target={ref} ambiguous={ref.ambiguous}>{children}</ThreadLink>;
        if (address || (href && looksLikeThreadRefUrl(href))) return <span className="break-words">{children}</span>;
        const localPath = localFilePath(href);
        if (localPath) return <LocalFileLink filePath={localPath} message={scopedMessage}>{children}</LocalFileLink>;
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            dir="auto"
            className="break-words text-accent underline decoration-accent/40 hover:decoration-accent [unicode-bidi:isolate]"
          >
            {children}
          </a>
        );
      },
      table({ node, children }: BlockProps) {
        const model = tableModelFromMarkdown(children);
        if (!model) {
          return (
            <div className="overflow-x-auto">
              <table dir={blockDirection(node)} className="w-full border-collapse text-[12.5px]">{children}</table>
            </div>
          );
        }
        return <RichTable model={model} dir={blockDirection(node)} />;
      },
      th({ children }: { children?: ReactNode }) {
        return (
          <th className="border-b border-hairline/40 px-2 py-1.5 text-start font-semibold">{children}</th>
        );
      },
      td({ children }: { children?: ReactNode }) {
        return <td className="border-b border-hairline/20 px-2 py-1.5 align-top">{children}</td>;
      },
      p({ node, children }: BlockProps) {
        return <p dir={blockDirection(node)}>{children}</p>;
      },
      ul({ node, children, className }: BlockProps & { className?: string }) {
        // GFM task lists carry their own checkbox in place of a bullet
        const tasks = className?.includes("contains-task-list");
        return <ul dir={blockDirection(node)} className={tasks ? "space-y-1 ps-1" : "list-disc space-y-1 ps-5"}>{children}</ul>;
      },
      ol({ node, children, className }: BlockProps & { className?: string }) {
        const tasks = className?.includes("contains-task-list");
        return <ol dir={blockDirection(node)} className={tasks ? "space-y-1 ps-1" : "list-decimal space-y-1 ps-5"}>{children}</ol>;
      },
      li({ children, className, id }: BlockProps & { className?: string; id?: string }) {
        if (className?.includes("task-list-item")) {
          return <li id={id} className="flex list-none items-start gap-2 [&>p]:inline">{children}</li>;
        }
        return <li id={id} className={id ? "scroll-mt-4" : undefined}>{children}</li>;
      },
      input({ type, checked }: { type?: string; checked?: boolean }) {
        if (type !== "checkbox") return null;
        return (
          <span
            role="checkbox"
            aria-checked={Boolean(checked)}
            aria-disabled="true"
            className={`mt-[3px] inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border ${checked ? "border-accent bg-accent text-accent-ink" : "border-hairline bg-panel"}`}
          >
            {checked && <Check size={11} strokeWidth={3} aria-hidden="true" />}
          </span>
        );
      },
      section({ children, className, ...rest }: BlockProps & { className?: string }) {
        // GFM footnotes arrive as <section data-footnotes>
        if ((rest as Record<string, unknown>)["data-footnotes"] !== undefined || className?.includes("footnotes")) {
          return (
            <section aria-label={t("rich.footnotes")} className="mt-3 border-t border-hairline/30 pt-2 text-[12px] text-ink-secondary [&_ol]:ps-5 [&_p]:inline">
              {children}
            </section>
          );
        }
        return <section>{children}</section>;
      },
      sup({ children }: { children?: ReactNode }) {
        return <sup className="ms-px text-[0.72em]">{children}</sup>;
      },
      h1: heading("h1"),
      h2(props: BlockProps & { className?: string; id?: string }) {
        // the footnote section's own label is visually hidden
        if (props.className?.includes("sr-only")) return <h2 id={props.id} className="sr-only">{props.children}</h2>;
        return heading("h2")(props);
      },
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      blockquote({ node, children, ...rest }: BlockProps) {
        const props = rest as Record<string, unknown>;
        const kind = props["data-callout"];
        if (typeof kind === "string" && kind in CALLOUT_STYLE) {
          const title = typeof props["data-callout-title"] === "string" ? props["data-callout-title"] : "";
          return <Callout kind={kind as CalloutKind} title={title} dir={blockDirection(node)}>{children}</Callout>;
        }
        return (
          <blockquote dir={blockDirection(node)} className="border-s-2 border-hairline ps-3 text-ink-secondary">{children}</blockquote>
        );
      },
      del({ children }: { children?: ReactNode }) {
        return <Spoiler>{children}</Spoiler>;
      },
      hr() {
        return <hr className="border-hairline/40" />;
      },
    } as Components;
  }, [streaming, threadId, messageId, threads, currentBotId, openFence, prefix]);
  return (
    <div className="chat-md min-w-0 [&>*+*]:mt-2">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, remarkWindowsPathDestinations, unwrapLinkedImages, remarkCallouts, [remarkMentions, { peers: mentionPeers, everyone }], remarkThreadRefs(threads, currentBotId)]}
        rehypePlugins={[rehypeKatex]}
        remarkRehypeOptions={{ clobberPrefix: prefix }}
        urlTransform={chatUrlTransform}
        components={components}
      >
        {source}
      </Markdown>
    </div>
  );
}

/** Compare the roster by the fields that actually change the render, not by
 * identity. Both callers derive this list from `state.bots` / group members
 * with `useMemo`, and the reducer rebuilds those arrays with `.map()` on every
 * bot patch — so a reference test fails on events that changed nothing here,
 * and every mounted bubble re-parses its markdown. Rosters are small; this
 * walk is far cheaper than the re-render it prevents. */
export function samePeers(previous: readonly MentionPeer[], next: readonly MentionPeer[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((peer, index) => {
    const other = next[index]!;
    return peer.name === other.name && peer.hidden === other.hidden && peer.color === other.color;
  });
}

export const ChatMarkdown = memo(ChatMarkdownComponent, (previous, next) => (
  previous.text === next.text
  && samePeers(previous.mentionPeers ?? NO_MENTION_PEERS, next.mentionPeers ?? NO_MENTION_PEERS)
  && previous.everyone === next.everyone
  && Boolean(previous.streaming) === Boolean(next.streaming)
  && previous.message?.threadId === next.message?.threadId
  && previous.message?.messageId === next.message?.messageId
));
