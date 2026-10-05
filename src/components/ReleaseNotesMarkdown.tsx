// Release notes are markdown from a GitHub release or from docs/releases.
// HTML is skipped, images never fetch, and links leave the app.
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternalLink } from "@/lib/app-links";
import { activeLocale, t } from "@/lib/i18n";
import {
  orderedReleaseNotes,
  releaseNotesSection,
  safeReleaseUrl,
  sanitizeReleaseMarkdown,
  type ReleaseNoteEntry,
} from "@/lib/release-notes";

const components: Components = {
  a: ({ children, href }) => {
    const url = typeof href === "string" ? href : "";
    if (!safeReleaseUrl(url)) return <span>{children}</span>;
    return (
      <button type="button" className="text-accent underline" onClick={() => void openExternalLink(url)}>
        {children}
      </button>
    );
  },
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  h1: ({ children }) => <h3 className="mb-1 mt-3 text-[14px] font-semibold text-ink first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 text-[14px] font-semibold text-ink first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-[13px] font-semibold text-ink first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-2 text-[13px] leading-relaxed text-ink first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-ink-secondary">{children}</blockquote>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-control p-2 text-[12px] text-ink">{children}</pre>,
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-control px-1 py-0.5 text-[12px]">{children}</code>
    ),
};

export function ReleaseNotesMarkdown({ source }: { source: string }) {
  const text = sanitizeReleaseMarkdown(source).trim();
  if (!text) return null;
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={components}
      skipHtml
      urlTransform={(url) => (safeReleaseUrl(url) ? url : "")}
    >
      {text}
    </Markdown>
  );
}

/** One block per version, newest first. A single note has no version heading. */
export function ReleaseNotesBody({
  notes,
  fallbackVersion = "",
  language = activeLocale(),
}: {
  notes: string | Array<{ version?: string; note?: string | null }> | null | undefined;
  fallbackVersion?: string;
  language?: string;
}) {
  const blocks = orderedReleaseNotes(notes, fallbackVersion)
    .map((entry) => ({
      version: entry.version,
      markdown: sanitizeReleaseMarkdown(releaseNotesSection(entry.note, language)).trim(),
    }))
    .filter((block) => block.markdown);
  if (blocks.length === 0) {
    return <p className="text-[13px] leading-relaxed text-ink-secondary">{t("releaseNotes.noNotes")}</p>;
  }
  const showHeadings = blocks.length > 1;
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => (
        <section key={`${block.version}:${index}`}>
          {showHeadings && block.version ? (
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">
              {t("releaseNotes.versionHeading", { version: block.version })}
            </h3>
          ) : null}
          <ReleaseNotesMarkdown source={block.markdown} />
        </section>
      ))}
    </div>
  );
}

export type { ReleaseNoteEntry };
