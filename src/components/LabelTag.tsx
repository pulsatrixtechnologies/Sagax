// The small tag a label is drawn with: a bot's label (Bot Settings > Title)
// and a person's custom label (src/lib/person-labels.ts) look the same
// wherever they show. `tone` follows the surface (the sidebar's own colours,
// or a content surface); `size` the row (a list row, or the smaller pinned
// tile, a faint filled tag). Nothing renders for an empty label.
import { cn } from "@/lib/cn";
import { usePersonLabel } from "@/lib/person-labels";

export function LabelTag({ text, tone = "sidebar", size = "row", className }: {
  text: string | null | undefined;
  tone?: "sidebar" | "surface";
  size?: "row" | "small";
  className?: string;
}) {
  const label = text?.trim();
  if (!label) return null;
  // Same markup as the bot row's tag always had (one span, classes in this
  // order), so the tag looks and tests the same for bots and people. The
  // pinned tile's tag is the reference window's: a faint fill and outline.
  const small = size === "small";
  return (
    <span
      className={cn(
        className,
        "truncate rounded-[5px] border",
        tone === "sidebar" ? (small ? "border-sidebar-ink/[0.055] bg-sidebar-ink/[0.02]" : "border-sidebar-hairline bg-sidebar-hover") : (small ? "border-ink/[0.055] bg-ink/[0.02]" : "border-hairline-weak bg-hover"),
        small ? "px-1" : "px-1.5",
        small ? "text-[11.5px] leading-[17px]" : "text-[11px] leading-4",
        tone === "sidebar" ? "text-sidebar-ink-secondary" : "text-ink-secondary",
      )}
    >
      {label}
    </span>
  );
}

/** A person's label from the shared store, as a LabelTag. */
export function PersonLabelTag({ principalId, ...rest }: { principalId: string | null | undefined } & Omit<Parameters<typeof LabelTag>[0], "text">) {
  const label = usePersonLabel(principalId);
  return <LabelTag text={label} {...rest} />;
}

/** A bot's role beside its name in a sidebar row or under its pinned tile,
 * measured on Grok Bot's title tag: 11/16 text, 1px by 4px padding, a 0.5px
 * outline, 4px corners, a faint fill of the rail's ink. In a row it takes the
 * room the name leaves (at least 2em, never wider than its text); the name
 * gives way first. */
export function BotRoleTag({ text, tile = false, className }: { text: string | null | undefined; tile?: boolean; className?: string }) {
  const label = text?.trim();
  if (!label) return null;
  return (
    <span
      data-bot-role-tag=""
      className={cn(
        "inline-flex min-w-0 items-center overflow-hidden rounded-[4px] border-[0.5px] border-sidebar-ink/[0.1] bg-sidebar-ink/[0.022] py-px text-[11px] font-normal leading-4 tracking-[0.005em] text-sidebar-ink-secondary",
        tile ? "max-w-full px-px" : "max-w-fit shrink-0 grow basis-[2em] px-1",
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
