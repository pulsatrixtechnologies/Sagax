// Small pieces the three Plugins views share: the icon, the status word and
// the page header with its back arrow.
import type { ReactNode } from "react";
import { BookOpen, Puzzle, ServerCog } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { WHOP_KEY, type PluginItem, type PluginStatus } from "@/lib/plugins-model";
import { Breadcrumb, type Crumb } from "../Breadcrumb";
import { CATEGORY_MODAL } from "../category-modal";
import { WhopIcon } from "../WhopIcon";
import { ServiceIcon } from "./connected-apps";

export function PluginIcon({ item, className = "size-10" }: { item: Pick<PluginItem, "kind" | "name" | "logo" | "domain"> & { key?: string }; className?: string }) {
  if (item.key === WHOP_KEY) {
    return <WhopIcon className={className} />;
  }
  if (item.kind === "skill") {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
        <BookOpen size={18} aria-hidden="true" />
      </div>
    );
  }
  if (item.kind === "plugin") {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-text", className)}>
        <Puzzle size={18} aria-hidden="true" />
      </div>
    );
  }
  if (item.kind === "mcp" && !item.domain && !item.logo) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
        <ServerCog size={18} aria-hidden="true" />
      </div>
    );
  }
  return <ServiceIcon key={item.logo ?? item.domain ?? ""} card={{ logo: item.logo ?? null, domain: item.domain ?? null, label: item.name }} className={cn("shrink-0", className)} />;
}

const STATUS_KEY: Record<PluginStatus, LocaleKey> = {
  connected: "connectApps.status.connected",
  needs_auth: "connectApps.status.needsAuth",
  pending: "connectApps.status.pending",
  off: "connectApps.status.off",
  available: "connectApps.status.available",
};

export function PluginStatusLabel({ status, className }: { status: PluginStatus; className?: string }) {
  return (
    <span
      data-plugin-status={status}
      className={cn(
        "shrink-0 text-[12px] font-medium",
        status === "connected" ? "text-success" : status === "needs_auth" || status === "pending" ? "text-warning" : "text-ink-secondary",
        className,
      )}
    >
      {t(STATUS_KEY[status])}
    </span>
  );
}

/** A sub-page's header: back arrow, title, close. */
/** A page's header in the panel's window: the breadcrumb (back, the pages
 * above, this one), then its title. The close button is the window's. */
export function PluginPageHeader({ title, trail, onBack, titleId }: {
  title: string;
  /** the pages above this one, Connect apps first (absent: Connect apps) */
  trail?: readonly Crumb[];
  onBack: () => void;
  titleId: string;
}) {
  const crumbs = trail ?? [{ label: t("connectApps.title"), onSelect: onBack }];
  return (
    <header className={CATEGORY_MODAL.titleBar}>
      <Breadcrumb trail={crumbs} current={title} onBack={onBack} backData={{ "data-plugins-back": "" }} />
      <h2 id={titleId} className={cn(CATEGORY_MODAL.title, "truncate")}>{title}</h2>
    </header>
  );
}

/** One card of the detail page: a title and flat content (one card level). */
export function PluginCard({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {title && <h3 className="text-[13px] font-semibold text-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
