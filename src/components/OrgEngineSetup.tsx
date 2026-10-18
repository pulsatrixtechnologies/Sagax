// The first-run step "connect your own engine" on an organization server
// (2026-10-18, JC), and the chat's notice that leads back to it.
//
// When nothing the organization offers answers this person
// (shared/org-engine-readiness.ts: "connect" or "blocked"), the setup asks
// for their own account the way the solo app's engines beat does, limited to
// the engines the organization allows: each row is the person's own
// EngineConnect (their subscription, signed in through
// /api/me/engines/<id>/login into their own login directory on the server,
// or their key kept in Perspicax), never the server's own engine login.
// Turns then run where every organization turn runs, with the person's
// approvals and security keys unchanged. When the organization allows
// nothing they can connect, the step says to ask the admin, by name when
// the directory knows it, instead of opening on a chat that cannot answer.
//
// The step opens by itself once per person (ORG_ENGINE_SETUP_SEEN_KEY);
// afterwards, as long as nothing answers, the chat shows OrgEngineNotice
// with a button back to the same step. With a working engine, nothing here
// draws at all.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, KeyRound, RefreshCw } from "lucide-react";

import { EngineConnect, PaysWithLine } from "@/components/EngineConnect";
import { InstanceProviderMark } from "@/components/ProviderIcons";
import { PulsatrixMark } from "@/components/PulsatrixMark";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { reloadMyEngines } from "@/lib/perspicax-org";
import {
  markOrgEngineSetupSeen,
  openOrgEngineSetup,
  ORG_ENGINE_SETUP_EVENT,
  orgEngineSetupSeen,
  usePersonEngineReadiness,
  type PersonEngineReadiness,
} from "@/lib/org-engine-readiness";
import { useStore } from "@/state/store";
import { PrimaryButton } from "./onboarding/beats/shared";

/** "Contact your admin", with their names when the directory has them. */
export function contactAdminText(adminNames: readonly string[]): string {
  if (adminNames.length === 0) return t("orgEngines.blocked.contact");
  return t("orgEngines.blocked.contactNamed", { names: adminNames.slice(0, 3).join(", ") });
}

function useRecheck() {
  const { refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      await Promise.all([reloadMyEngines(), Promise.resolve(refreshInstances()).catch(() => {})]);
    } finally {
      setChecking(false);
    }
  }, [refreshInstances]);
  return { checking, recheck };
}

function RecheckButton({ checking, recheck }: ReturnType<typeof useRecheck>) {
  return (
    <button
      type="button"
      data-org-engines-recheck=""
      onClick={() => void recheck()}
      disabled={checking}
      className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
    >
      <RefreshCw size={12} className={checking ? "animate-spin" : ""} aria-hidden="true" />
      {checking ? t("common.checking") : t("common.checkAgain")}
    </button>
  );
}

/** The step's content: the engines to connect, or the admin message, or
 * the success line once one answers. Shared by the first-run card and the
 * welcome flow's engines beat on an organization server. */
export function OrgEngineSetupBody({ readiness, onContinue }: { readiness: PersonEngineReadiness; onContinue: () => void }) {
  const check = useRecheck();
  const [open, setOpen] = useState<string | null>(null);
  // the first row opens by itself: the step is about connecting one
  const firstId = readiness.connectable[0]?.instance.instanceId ?? null;
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !firstId) return;
    opened.current = true;
    setOpen(firstId);
  }, [firstId]);

  if (readiness.state === "ready") {
    const names = readiness.working[0]?.displayName ?? "";
    return (
      <div data-org-engines="ready" className="flex flex-col">
        <p className="mt-2 flex items-center gap-2 text-[13.5px] text-success" aria-live="polite">
          <Check size={15} strokeWidth={2.5} aria-hidden="true" />
          {t("orgEngines.ready", { name: names })}
        </p>
        <PrimaryButton onClick={onContinue} className="mt-5">{t("onboarding.continue")}</PrimaryButton>
      </div>
    );
  }

  if (readiness.state === "blocked") {
    return (
      <div data-org-engines="blocked" className="flex flex-col">
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{t("orgEngines.blocked.body")}</p>
        <p data-org-engines-admins="" className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">{contactAdminText(readiness.adminNames)}</p>
        <div className="mt-3 flex justify-end"><RecheckButton {...check} /></div>
        <PrimaryButton onClick={onContinue} className="mt-4">{t("onboarding.continue")}</PrimaryButton>
      </div>
    );
  }

  return (
    <div data-org-engines="connect" className="flex min-h-0 flex-col">
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-secondary">{t("orgEngines.connect.intro", { org: readiness.organizationName || t("orgEngines.yourOrganization") })}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <KeyRound size={12} aria-hidden="true" />
          {t("orgEngines.connect.own")}
        </p>
        <RecheckButton {...check} />
      </div>
      <div className="mt-2.5 min-h-0 divide-y divide-hairline/40 overflow-y-auto rounded-xl border border-hairline/40 bg-card [scrollbar-width:thin]">
        {readiness.connectable.map(({ instance, access }) => {
          const expanded = open === instance.instanceId;
          return (
            <div key={instance.instanceId} data-org-engine-row={instance.instanceId}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : instance.instanceId)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-raised/40"
              >
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  <InstanceProviderMark instance={instance} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{instance.displayName}</span>
                <PaysWithLine engine={access} className="shrink-0 text-[11.5px]" />
                <ChevronDown size={14} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", expanded && "rotate-180")} aria-hidden="true" />
              </button>
              {expanded && (
                <div className="mx-3.5 mb-3.5 rounded-lg bg-inset p-3">
                  <EngineConnect engine={access} issuer={readiness.issuer} onChanged={() => check.recheck()} statusLine={false} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <PrimaryButton onClick={onContinue} className="mt-5">{t("orgEngines.later")}</PrimaryButton>
    </div>
  );
}

/** The first-run card on an organization server: opens by itself once per
 * person when nothing answers them, and again on request from the chat. */
export function OrgEngineSetupGate() {
  const readiness = usePersonEngineReadiness();
  const [open, setOpen] = useState(false);
  const needed = readiness.organization && (readiness.state === "connect" || readiness.state === "blocked");
  useEffect(() => {
    if (needed && !orgEngineSetupSeen()) setOpen(true);
  }, [needed]);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(ORG_ENGINE_SETUP_EVENT, onOpen);
    return () => window.removeEventListener(ORG_ENGINE_SETUP_EVENT, onOpen);
  }, []);
  // focus the card (its first control) so Escape and Tab work at once
  const dialogRef = useRef<HTMLDivElement>(null);
  const shown = open && readiness.organization && readiness.state !== "loading";
  useEffect(() => {
    if (!shown) return;
    const card = dialogRef.current;
    if (!card || card.contains(document.activeElement)) return;
    (card.querySelector<HTMLElement>("[data-primary]") ?? card).focus({ preventScroll: true });
  }, [shown]);
  if (!shown) return null;
  const close = () => {
    markOrgEngineSetupSeen();
    setOpen(false);
  };
  const title = readiness.state === "blocked" ? t("orgEngines.blocked.title") : t("orgEngines.connect.title");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app p-3 sm:p-8" data-org-engine-setup="">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        className="welcome-card relative flex max-h-full w-full max-w-[560px] flex-col overflow-y-auto rounded-2xl border border-hairline/40 bg-panel p-5 shadow-[0_30px_80px_-28px_rgba(0,0,0,0.45),0_8px_24px_-12px_rgba(0,0,0,0.25)] outline-none sm:p-8"
      >
        <div className="flex shrink-0 items-center gap-3">
          <PulsatrixMark size={40} ground="app" />
          <h1 className="text-[18px] font-semibold text-ink">{readiness.state === "ready" ? t("orgEngines.connect.title") : title}</h1>
        </div>
        <OrgEngineSetupBody readiness={readiness} onContinue={close} />
      </div>
    </div>
  );
}

/** Above a conversation while nothing answers this person on an
 * organization server: says so, and leads back to the step. */
export function OrgEngineNotice() {
  const readiness = usePersonEngineReadiness();
  const check = useRecheck();
  if (!readiness.organization || (readiness.state !== "connect" && readiness.state !== "blocked")) return null;
  const blocked = readiness.state === "blocked";
  return (
    <div className="shrink-0 px-4 pt-3">
    <div role="status" data-org-engine-notice={readiness.state} className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-3 rounded-xl border border-warning/50 bg-panel px-4 py-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{blocked ? t("orgEngines.blocked.title") : t("orgEngines.notice.title")}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">
          {blocked ? `${t("orgEngines.blocked.body")} ${contactAdminText(readiness.adminNames)}` : t("orgEngines.notice.body")}
        </p>
      </div>
      {blocked ? (
        <RecheckButton {...check} />
      ) : (
        <button
          type="button"
          data-org-engine-notice-connect=""
          onClick={openOrgEngineSetup}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-[filter] hover:brightness-110"
        >
          {t("orgEngines.notice.connect")}
        </button>
      )}
    </div>
    </div>
  );
}
