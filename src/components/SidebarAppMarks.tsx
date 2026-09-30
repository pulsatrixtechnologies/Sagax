// The app marks shown beside "Connected apps" in the footer menu.
//
// Team map, Automations, Connected apps and Templates used to fold behind a
// "Connect apps & tools" pill beside the avatar. The footer is now one row,
// the way Perspicax's console lays out its account footer: your avatar and
// your full name, opening one menu that holds those places first and the
// profile items after them (SidebarProfileMenu). The pill's Gmail, Slack and
// GitHub marks moved with its items: they sit at the end of the Connected
// apps row, tinted until the row is hovered or focused (.footer-tint).
import { cn } from "@/lib/cn";

// The marks are drawn inline rather than fetched: the catalog only carries
// official logos once a Composio key is set, and a favicon lookup would call
// out to a third party every time the sidebar renders.
function GmailMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]">
      <path fill="#4285F4" d="M6 40h8V20.6L3 12.4V37a3 3 0 0 0 3 3z" />
      <path fill="#34A853" d="M34 40h8a3 3 0 0 0 3-3V12.4l-11 8.2z" />
      <path fill="#FBBC04" d="M34 8.5v12.1l11-8.2V8.9c0-3.7-4.2-5.8-7.2-3.6z" />
      <path fill="#EA4335" d="M14 20.6V8.5l10 7.5 10-7.5v12.1L24 28z" />
      <path fill="#C5221F" d="M3 8.9v3.5l11 8.2V8.5l-3.8-3.2C7.2 3.1 3 5.2 3 8.9z" />
    </svg>
  );
}

function SlackMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]">
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
      <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
      <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" />
      <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] text-ink">
      <path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** Left to right. */
const MARKS = [GmailMark, SlackMark, GitHubMark];

/** The marks, overlapping a little, at the end of a menu row. */
export function AppMarks({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-[18px] shrink-0 items-center", className)} aria-hidden="true">
      {MARKS.map((Mark, i) => (
        <span
          key={i}
          style={{ zIndex: MARKS.length - i }}
          className="relative -ml-1.5 flex items-center justify-center rounded-[4px] ring-2 ring-elevated first:ml-0"
        >
          {/* tinted at rest, real colours on hover/focus (.footer-tint) */}
          <span className="footer-tint flex">
            <Mark />
          </span>
        </span>
      ))}
    </span>
  );
}
