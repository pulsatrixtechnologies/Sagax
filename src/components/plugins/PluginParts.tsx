// Small pieces the three Plugins views share: the icon, the status word and
// the page header with its back arrow.
import type { ReactNode } from "react";
import { ArrowLeft, BookOpen, ServerCog, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { PluginItem, PluginStatus } from "@/lib/plugins-model";
import { ServiceIcon } from "./connected-apps";

export function PluginIcon({ item, className = "size-10" }: { item: Pick<PluginItem, "kind" | "name" | "logo" | "domain">; className?: string }) {
  if (item.kind === "skill") {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
        <BookOpen size={18} aria-hidden="true" />
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
  return <ServiceIcon card={{ logo: item.logo ?? null, domain: item.domain ?? null, label: item.name }} className={cn("shrink-0", className)} />;
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
export function PluginPageHeader({ title, backLabel, onBack, onClose, titleId }: {
  title: string;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  titleId: string;
}) {
  return (
    <header className="flex items-center gap-2 px-6 pb-3 pt-6 sm:px-8">
      <button type="button" onClick={onBack} aria-label={backLabel} title={backLabel} className="ui-icon-button -ml-1.5">
        <ArrowLeft size={18} />
      </button>
      <h2 id={titleId} className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("connectors.closeAria")}
        className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"
      >
        <X size={18} />
      </button>
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
