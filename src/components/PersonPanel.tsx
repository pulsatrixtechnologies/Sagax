// The right panel for a person of the organization, the counterpart of the
// bot panel: who they are (from the Perspicax directory only), the groups
// you share, their bots shared with you, and what you can do (write to
// them, hide or show them in your sidebar, and for an admin, their page in
// the Perspicax console). Nothing from a private thread shows here.
import { ExternalLink, EyeOff, Eye, Mail, MessageSquare, PanelRight, Users } from "lucide-react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { usePerspicaxOrg, type OrgDirectory } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { personInitials } from "@/lib/people-dm";
import { viewerActorId } from "@/lib/viewer";
import {
  canMessagePerson,
  findPanelPerson,
  personDmGroup,
  personManageUrl,
  personSharedBots,
  personTeams,
  sharedGroups,
} from "@/lib/person-panel";
import { hiddenKey, hideFromSidebar, showInSidebar, useSidebarHidden } from "@/lib/sidebar-hidden";
import { BotAvatar } from "./Avatar";
import { PersonAvatar } from "./MessageAuthor";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { useOrgDirectory } from "./GroupPeoplePicker";

const PANEL_WIDTH_KEY = "omb-settings-panel-width";

function panelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= 320 && stored <= 720) return stored;
  } catch { /* default width */ }
  return 360;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hairline-weak px-3 py-2.5 text-[13px] last:border-b-0">
      <span className="shrink-0 text-ink-secondary">{label}</span>
      <span className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

export function PersonPanel({ personId, directory: given }: { personId: string; directory?: OrgDirectory | null }) {
  const { state, dispatch } = useStore();
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const org = usePerspicaxOrg();
  const loaded = useOrgDirectory(given === undefined);
  const directory = given === undefined ? loaded : given;
  const hidden = useSidebarHidden();
  const viewerId = viewerActorId(state.config);
  const person = findPanelPerson(directory, personId);
  const name = person?.name || person?.login || personId;
  const avatarUrl = personAvatarSrc(person?.avatarUrl);
  const teams = personTeams(person, directory);
  const groups = sharedGroups(state.groups, personId);
  const bots = personSharedBots(state.bots, personId);
  const dm = personDmGroup(state.groups, personId);
  const manageUrl = personManageUrl(person, org?.viewerRole ?? null);
  const canMessage = canMessagePerson(person, viewerId);
  const isHidden = hidden.items.some((item) => hiddenKey(item.kind, item.id) === hiddenKey("person", personId));
  const close = () => dispatch({ type: "openPersonPanel", personId: null });

  return (
    <aside
      role="dialog"
      aria-labelledby="person-panel-title"
      data-person-panel={personId}
      style={{ width: panelWidth() }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto"
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
    >
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <div className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-end px-3", padClass)}>
        <button type="button" onClick={close} aria-label={t("personPanel.close")} title={t("personPanel.close")} className={CIRCLE_BUTTON}>
          <PanelRight size={18} strokeWidth={1.75} />
        </button>
      </div>
      <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex shrink-0 flex-col items-center px-4 pb-3">
          <PersonAvatar avatarUrl={avatarUrl} initials={personInitials(name)} size={88} />
          <h2 id="person-panel-title" className="mt-3 max-w-full truncate text-[17px] font-medium leading-6 text-ink">{name}</h2>
          {person && (
            <span className="mt-0.5 text-[12.5px] leading-4 text-ink-secondary">
              {person.role === "admin" ? t("personPanel.role.admin") : t("personPanel.role.member")}
              {person.disabled ? ` · ${t("personPanel.disabled")}` : ""}
            </span>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {canMessage && (
              <button
                type="button"
                data-person-action="message"
                onClick={() => {
                  if (dm) dispatch({ type: "select", id: dm.id });
                  else dispatch({ type: "openPeopleDm", principalId: person!.principalId });
                }}
                className="ui-button inline-flex items-center gap-1.5"
              >
                <MessageSquare size={14} aria-hidden />
                {t("personPanel.message")}
              </button>
            )}
            {dm && (
              <button
                type="button"
                data-person-action={isHidden ? "show" : "hide"}
                onClick={() => (isHidden ? showInSidebar(hiddenKey("person", personId)) : hideFromSidebar("person", personId))}
                className="ui-button inline-flex items-center gap-1.5"
              >
                {isHidden ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
                {isHidden ? t("sidebar.hidden.show") : t("sidebar.hidden.hide")}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 px-4 pb-6 pt-2">
          {!person && directory && (
            <p role="note" className="rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] text-ink-secondary">{t("personPanel.notInDirectory")}</p>
          )}
          {person && (
            <section className="overflow-hidden rounded-xl border border-hairline-weak">
              {person.email && (
                <Field label={t("personPanel.email")}>
                  <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Mail size={12} aria-hidden />{person.email}</a>
                </Field>
              )}
              {person.login && person.login !== person.email && <Field label={t("personPanel.login")}>{person.login}</Field>}
              <Field label={t("personPanel.teams")}>
                {teams.length
                  ? teams.map((team) => (team.manager ? t("personPanel.teamManager", { name: team.name }) : team.name)).join(", ")
                  : <span className="text-ink-secondary">{t("personPanel.noTeams")}</span>}
              </Field>
            </section>
          )}

          <section className="flex flex-col gap-2" data-person-section="groups">
            <h3 className="text-[13px] text-ink-secondary">{t("personPanel.sharedGroups")}</h3>
            {groups.length ? (
              <ul className="overflow-hidden rounded-xl border border-hairline-weak">
                {groups.map((group) => (
                  <li key={group.id} className="border-b border-hairline-weak last:border-b-0">
                    <button type="button" onClick={() => dispatch({ type: "select", id: group.id })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-hover">
                      <Users size={14} className="shrink-0 text-ink-secondary" aria-hidden />
                      <span className="truncate">{group.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[12.5px] text-ink-secondary">{t("personPanel.noSharedGroups")}</p>}
          </section>

          <section className="flex flex-col gap-2" data-person-section="bots">
            <h3 className="text-[13px] text-ink-secondary">{t("personPanel.sharedBots")}</h3>
            {bots.length ? (
              <ul className="overflow-hidden rounded-xl border border-hairline-weak">
                {bots.map((bot) => (
                  <li key={bot.id} className="border-b border-hairline-weak last:border-b-0">
                    <button type="button" onClick={() => dispatch({ type: "select", id: bot.id })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-hover">
                      <BotAvatar bot={bot} state="idle" size={24} animated={false} />
                      <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                      {bot.title && <span className="shrink-0 truncate text-[12px] text-ink-secondary">{bot.title}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[12.5px] text-ink-secondary">{t("personPanel.noSharedBots")}</p>}
          </section>

          {manageUrl && (
            <a
              href={manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-person-manage
              className="inline-flex items-center gap-1.5 self-start text-[13px] text-accent hover:underline"
            >
              <ExternalLink size={14} aria-hidden />
              {t("personPanel.manage")}
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
