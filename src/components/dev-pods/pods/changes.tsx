// Changes: the pull requests and commits the bot made in this conversation,
// from its own gh and git rows and the pull request links in its replies.
// The menu opens the link or copies it; a local commit with no link offers
// its place in the conversation and its id.
import { useEffect, useMemo, useRef, useState } from "react";
import { GitCommitHorizontal, GitPullRequest, MoreHorizontal } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useMenuMotion } from "../../MenuMotion";
import { registerDevPod, type DevPodContext } from "../registry";
import { devChanges, type DevChange } from "../sources";

const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";

function ChangeMenu({ change, ctx, open, onClose }: { change: DevChange; ctx: DevPodContext; open: boolean; onClose: () => void }) {
  const motion = useMenuMotion(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!motion.shown) return null;
  const run = (action: () => void) => () => { onClose(); action(); };
  return (
    <div ref={ref} role="menu" className={cn("absolute right-0 top-7 z-40 flex w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5", motion.className)} {...motion.exitProps}>
      {change.url && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void openExternalLink(change.url!))}>{t("devPods.changes.open")}</button>}
      {change.url && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void copyText(change.url!))}>{t("devPods.changes.copy")}</button>}
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => ctx.dispatch({ type: "focusMessage", threadId: ctx.bot.threadId, messageId: change.messageId }))}>{t("devPods.changes.show")}</button>
      {change.sha && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void copyText(change.sha!))}>{t("devPods.changes.copySha")}</button>}
    </div>
  );
}

function ChangeRow({ change, ctx }: { change: DevChange; ctx: DevPodContext }) {
  const [open, setOpen] = useState(false);
  const Icon = change.kind === "pull" ? GitPullRequest : GitCommitHorizontal;
  const where = change.kind === "pull"
    ? `${change.repo ?? ""} #${change.number}`
    : change.sha!.slice(0, 7);
  return (
    <li data-change={change.key} className="group/change relative flex min-h-[36px] items-start gap-2 py-1">
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ink" title={change.title}>{change.title}</span>
        <span className="truncate font-mono text-[11.5px] text-ink-secondary">{where}</span>
      </div>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("devPods.changes.more", { title: change.title })}
        title={t("devPods.changes.more", { title: change.title })}
        onClick={() => setOpen((value) => !value)}
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink", !open && "opacity-60 touch:opacity-100 focus-visible:opacity-100 group-hover/change:opacity-100")}
      >
        <MoreHorizontal size={14} />
      </button>
      <ChangeMenu change={change} ctx={ctx} open={open} onClose={() => setOpen(false)} />
    </li>
  );
}

function ChangesBody({ data, ctx }: { data: DevChange[]; ctx: DevPodContext }) {
  return (
    <ul className="flex flex-col">
      {data.map((change) => <ChangeRow key={change.key} change={change} ctx={ctx} />)}
    </ul>
  );
}

registerDevPod<DevChange[]>({
  id: "changes",
  order: 50,
  title: () => t("devPods.changes.title"),
  icon: GitPullRequest,
  collapsible: true,
  useData: (ctx) => {
    const changes = useMemo(() => devChanges(ctx.messages), [ctx.messages]);
    return changes.length ? { status: "ready", data: changes } : { status: "empty" };
  },
  Body: ChangesBody,
});
