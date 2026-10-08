// The small round dot on an avatar's corner: a bot's working, waiting,
// teammate and queued signals in the sidebar, and a person's presence
// (online, away, offline) everywhere people show. One look for both: a
// coloured disc ringed in the surface behind it, so it reads on a photo and
// on the mascot alike.
import { cn } from "@/lib/cn";

export type StatusDotTone = "success" | "warning" | "accent" | "queued" | "offline";

const TONE: Record<StatusDotTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  accent: "bg-accent",
  queued: "bg-sidebar-ink-secondary",
  offline: "bg-ink-secondary/55",
};

export function StatusDot({ tone, label, role, testId, className, ringClassName = "border-sidebar", sizeClassName = "size-2.5", data }: {
  tone: StatusDotTone;
  /** Accessible name and tooltip. Absent: a decorative dot. */
  label?: string;
  /** "status" for a live signal the row announces; "img" for a still one. */
  role?: "status" | "img";
  testId?: string;
  /** Position (absolute corner) or layout. */
  className?: string;
  /** The ring takes the colour of the surface behind the avatar. */
  ringClassName?: string;
  sizeClassName?: string;
  data?: Record<`data-${string}`, string>;
}) {
  return (
    <span
      data-testid={testId}
      role={label ? role ?? "img" : undefined}
      aria-label={label}
      title={label}
      {...data}
      className={cn("rounded-full border-2", ringClassName, TONE[tone], sizeClassName, className)}
    />
  );
}
