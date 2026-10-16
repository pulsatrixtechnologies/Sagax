// Release notes are markdown from a GitHub release or from docs/releases.
// HTML is skipped, images never fetch, and links leave the app.
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternalLink } from "@/lib/app-links";
import { activeLocale, t } from "@/lib/i18n";
import {
  formatReleaseDate,
  orderedReleaseNotes,
  releaseNotesDate,
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
  // 2026-10-16 (JC): drawn like Settings: each section's heading is a grey
  // heading, as Settings' groups have; the body reads at 13.5 px.
  h1: ({ children }) => <h4 data-release-section="" className="mb-1.5 mt-6 px-1 text-[13px] font-normal leading-[18px] text-ink-secondary first:mt-0">{children}</h4>,
  h2: ({ children }) => <h4 data-release-section="" className="mb-1.5 mt-6 px-1 text-[13px] font-normal leading-[18px] text-ink-secondary first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1 mt-4 px-1 text-[13px] font-semibold leading-[18px] text-ink first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-2 px-1 text-[13.5px] leading-[21px] text-ink first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1.5 pl-6 pr-1 text-[13.5px] leading-[21px] text-ink marker:text-ink-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1.5 pl-6 pr-1 text-[13.5px] leading-[21px] text-ink marker:text-ink-tertiary">{children}</ol>,
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

/** A version's title and, when its file says, its date in grey. */
export function ReleaseVersionHeading({ version, date, language = activeLocale(), level = 3 }: {
  version: string;
  /** YYYY-MM-DD */
  date?: string | null;
  language?: string;
  level?: 3 | 2;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const when = formatReleaseDate(date, language);
  return (
    <div className="px-1" data-release-version={version}>
      <Heading className="text-[15px] font-semibold leading-[22px] text-ink">
        {t("releaseNotes.versionHeading", { version })}
      </Heading>
      {when && <p className="text-[12px] leading-4 text-ink-secondary" data-release-date={date ?? ""}>{when}</p>}
    </div>
  );
}

/** One block per version, newest first. A single note has no version
 * heading unless `headings` asks for it. */
export function ReleaseNotesBody({
  notes,
  fallbackVersion = "",
  language = activeLocale(),
  headings,
}: {
  notes: string | Array<{ version?: string; note?: string | null }> | null | undefined;
  fallbackVersion?: string;
  language?: string;
  headings?: boolean;
}) {
  const blocks = orderedReleaseNotes(notes, fallbackVersion)
    .map((entry) => ({
      version: entry.version,
      date: releaseNotesDate(entry.note),
      markdown: sanitizeReleaseMarkdown(releaseNotesSection(entry.note, language)).trim(),
    }))
    .filter((block) => block.markdown);
  if (blocks.length === 0) {
    return <p className="px-1 text-[13px] leading-relaxed text-ink-secondary">{t("releaseNotes.noNotes")}</p>;
  }
  const showHeadings = headings || blocks.length > 1;
  return (
    <div className="flex flex-col gap-8">
      {blocks.map((block, index) => (
        <section key={`${block.version}:${index}`} className="flex flex-col gap-3">
          {showHeadings && block.version ? <ReleaseVersionHeading version={block.version} date={block.date} language={language} /> : null}
          <div>
            <ReleaseNotesMarkdown source={block.markdown} />
          </div>
        </section>
      ))}
    </div>
  );
}

export type { ReleaseNoteEntry };
