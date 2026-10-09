// Browse Bots: the organisation bot catalogue, on the shared category modal
// shell (src/components/category-modal.ts, as Achievements and the persona
// editor: same backdrop, frame, close button, title and keyboard; Escape
// steps back, then closes). Opened by the store's openBotCatalog() from the
// mascot menu, the To: picker and the sidebar section menu, and on its
// Templates section by every way that used to open the Templates library
// (src/lib/templates-entry.ts).
//
// Sources: GET /api/bot-catalog (mine, shared with me, published to the
// organisation; server/routes/bot-catalog.ts) and the templates: the
// organization library's packages (GET /api/org-library), New bot's presets
// (an admin read), the community teams (GET /api/team-library/catalog) and
// the built-in roles. Actions: show or hide a shared bot in the sidebar
// (src/lib/sidebar-hidden.ts), Import Bot (POST /api/bot-catalog/:id/import),
// Use this template (a role or a preset through New bot's own creation, a
// community team through its preview and POST /api/teams/import, an
// organization package through POST /api/org-library/add), Open, and
// publish, withdraw or feature through PUT /api/bot-catalog/:id/listing.
// Templates' tools (Import, From a folder, Share a team) are TemplateTools.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { track } from "@/lib/analytics";
import { orgCardAction, orgPackagePreview, type OrgLibraryListing, type OrgLibraryPackage } from "@/lib/org-library";
import { teamImportPreview, type PendingTeamImport } from "@/lib/team-import";
import type { Routine } from "@/lib/routines";
import type { PackageDocument } from "../../../shared/package-format";
import { api, closeBotCatalog, useStore, type Bot, type Group } from "@/state/store";
import { useOrgPeople } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { useShowThreads } from "@/lib/thread-preferences";
import { viewerBotsReadOnly, viewerCan, viewerCanCreateBots } from "@/lib/viewer";
import { botsReadOnlyText } from "@/lib/permissions";
import { hiddenKey, hiddenKeySet, hideFromSidebar, showInSidebar, useSidebarHidden } from "@/lib/sidebar-hidden";
import type { BotPreset } from "@/lib/bot-presets";
import {
  ACTION_LABEL,
  cardActionLabel,
  catalogActions,
  catalogCategories,
  catalogSections,
  catalogTemplates,
  itemName,
  templateApps,
  type CommunityCatalog,
  type BotCatalogDetail,
  type BotCatalogResponse,
  type CatalogAction,
  type CatalogItem,
  type CatalogSectionId,
  catalogCategoryLabel,
} from "@/lib/bot-catalog";
import { DEFAULT_BOT_CATALOG_CATEGORIES, type BotCatalogListing } from "../../../shared/bot-catalog";
import { useRetroSkin } from "../RetroChromeHost";
import { shortcutLabel } from "../ShortcutHint";
import { openBotConversationActions } from "../thread-home";
import { CATEGORY_MODAL, useCategoryModalKeyboard } from "../category-modal";
import { BotCatalogView } from "./BotCatalogView";
import { BotCatalogDetailView, templateDetail, type CatalogDetailContent, type CatalogTab } from "./BotCatalogDetailView";
import { TeamImportDetails, type TeamImportResult } from "./TeamImportDetails";
import { openExternal, TeamImportPreview, TemplateTools, type TemplateTool } from "./TemplateTools";

/** The feedback line after a team, a backup or a package was added. */
export function teamImportedText(result: TeamImportResult): string {
  return (result.members === 0 && result.presets
    ? t("sidebar.presetsImported", { count: result.presets })
    : result.members === 1
    ? t("sidebar.teamImportedOne")
    : t("sidebar.teamImportedMany", { count: result.members })) +
    (result.connections ? ` · ${t("sidebar.connectionsToFinish", { count: result.connections })}` : "");
}

/** A template that is a team (a community one or an organization package):
 * its detail shows the import preview. */
type TeamPreview = { pending: PendingTeamImport | null; loading: boolean; error: string };

type Feedback = { error: boolean; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p role={feedback.error ? "alert" : "status"} data-catalog-feedback="" className={cn("mx-6 mt-3 rounded-lg px-3 py-2 text-[12.5px] sm:mx-8", feedback.error ? "bg-danger/10 text-danger" : "bg-ink/[0.05] text-ink-secondary")}>
      {feedback.text}
    </p>
  );
}

/** The publish form under a bot's actions: a category (a default one or the
 * publisher's own text), then Publish. */
function PublishForm({ initial, pending, onPublish, onCancel }: { initial: string; pending: boolean; onPublish: (category: string) => void; onCancel: () => void }) {
  const [category, setCategory] = useState(initial);
  return (
    <form
      className="mt-3 flex w-full max-w-[420px] flex-col gap-2 rounded-xl border border-hairline-weak bg-panel p-3 text-left"
      data-catalog-publish-form=""
      onSubmit={(event) => { event.preventDefault(); onPublish(category); }}
    >
      <label className="text-[12px] font-medium text-ink" htmlFor="bot-catalog-category">{t("botCatalog.publish.category")}</label>
      <input
        id="bot-catalog-category"
        list="bot-catalog-categories"
        value={category}
        maxLength={40}
        onChange={(event) => setCategory(event.target.value)}
        className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-ink focus:border-border-strong focus:outline-none"
      />
      <datalist id="bot-catalog-categories">
        {DEFAULT_BOT_CATALOG_CATEGORIES.map((id) => <option key={id} value={catalogCategoryLabel(id)} />)}
      </datalist>
      <p className="text-[11.5px] leading-[16px] text-ink-tertiary">{t("botCatalog.publish.categoryHint")} {t("botCatalog.publish.note")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink">{t("common.cancel")}</button>
        <button type="submit" disabled={pending} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-50">{t("botCatalog.publish.confirm")}</button>
      </div>
    </form>
  );
}

/** A typed default category label ("Ventes") back to its id ("sales"). */
function categoryFromInput(value: string): string {
  const text = value.trim();
  const id = DEFAULT_BOT_CATALOG_CATEGORIES.find((candidate) => catalogCategoryLabel(candidate).toLowerCase() === text.toLowerCase());
  return id ?? text;
}

export function BotCatalogModal() {
  const { state, dispatch } = useStore();
  const retroSkin = useRetroSkin();
  const showThreads = useShowThreads();
  const people = useOrgPeople();
  const hiddenPrefs = useSidebarHidden();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<BotCatalogResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [presets, setPresets] = useState<BotPreset[]>([]);
  const [reload, setReload] = useState(0);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  // Opened on Templates: the section alone from the first frame.
  const [expanded, setExpanded] = useState<CatalogSectionId | null>(state.botCatalogTarget ? "templates" : null);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [detail, setDetail] = useState<CatalogDetailContent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<CatalogTab>("soul");
  const [publishing, setPublishing] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [community, setCommunity] = useState<CommunityCatalog | null>(null);
  const [orgListing, setOrgListing] = useState<OrgLibraryListing | null>(null);
  const [templateApp, setTemplateApp] = useState<string | null>(null);
  const [tool, setTool] = useState<TemplateTool | null>(state.botCatalogTarget?.installUrl ? "import" : null);
  const [installUrl, setInstallUrl] = useState<string | undefined>(state.botCatalogTarget?.installUrl);
  const [teamPreview, setTeamPreview] = useState<TeamPreview | null>(null);
  const toolsBack = useRef<(() => boolean) | null>(null);
  // The old library was a desktop feature: files, folders and the team
  // sources stay off on a remote client (it keeps My Bots and the roles).
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;

  const close = useCallback(() => dispatch(closeBotCatalog()), [dispatch]);

  // Opened on Templates (the old library's entry points, an install link):
  // the Templates section alone, and Import with the link when there is one.
  const target = state.botCatalogTarget;
  useEffect(() => {
    if (!target) return;
    setSelected(null);
    setFeedback(null);
    setExpanded("templates");
    if (target.installUrl && !remoteClient) {
      setInstallUrl(target.installUrl);
      setTool("import");
    } else setTool(null);
  }, [target, remoteClient]);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    api<BotCatalogResponse>("/api/bot-catalog")
      .then((result) => { if (alive) setData(result); })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, [reload]);

  // The community teams and the organization's packages: no source is the
  // same as an empty one (offline, no organization, a remote client).
  useEffect(() => {
    if (remoteClient) return;
    let alive = true;
    api<CommunityCatalog>("/api/team-library/catalog")
      .then((result) => { if (alive) setCommunity(result); })
      .catch(() => {});
    return () => { alive = false; };
  }, [remoteClient]);

  useEffect(() => {
    if (remoteClient) return;
    let alive = true;
    api<OrgLibraryListing>("/api/org-library")
      .then((result) => { if (alive) setOrgListing(result); })
      .catch(() => {});
    return () => { alive = false; };
  }, [remoteClient, reload]);

  useEffect(() => {
    let alive = true;
    // New bot's presets are an admin read; a member keeps the built-in roles.
    api<{ presets: BotPreset[] }>("/api/bot-presets")
      .then((result) => { if (alive) setPresets(result.presets); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // The detail of the chosen bot, from the server; a template's is its own.
  useEffect(() => {
    if (!selected) return;
    setTab("soul");
    setPublishing(false);
    setTeamPreview(null);
    if (selected.kind === "template") {
      setDetail(templateDetail(selected));
      const { community: team, orgPackage } = selected.template;
      if (!team && !(orgPackage && orgPackage.blob === "ready")) return;
      // A team template previews what it adds, as the library's Load did.
      let alive = true;
      setTeamPreview({ pending: null, loading: true, error: "" });
      const load = team
        ? api(`/api/team-library/teams/${encodeURIComponent(team.slug)}`).then((manifest) => teamImportPreview(manifest))
        : api<{ document: PackageDocument }>(`/api/org-library/packages/${orgPackage!.packageId}`).then((result) => orgPackagePreview(result.document));
      load
        .then((next) => { if (alive) setTeamPreview({ pending: next, loading: false, error: "" }); })
        .catch((error) => { if (alive) setTeamPreview({ pending: null, loading: false, error: error instanceof Error ? error.message : String(error) }); });
      return () => { alive = false; };
    }
    let alive = true;
    setDetail(null);
    setDetailLoading(true);
    api<BotCatalogDetail>(`/api/bot-catalog/${encodeURIComponent(selected.entry.id)}`)
      .then(({ entry: _entry, ...content }) => { if (alive) setDetail(content); })
      .catch(() => { if (alive) setDetail(null); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selected?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A refreshed list refreshes the chosen bot's row (its listing, its badges).
  useEffect(() => {
    if (!data || selected?.kind !== "bot") return;
    const entry = data.entries.find((candidate) => candidate.id === selected.entry.id);
    if (entry && entry !== selected.entry) setSelected({ kind: "bot", key: `bot:${entry.id}`, entry });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const organization = data?.organization ?? false;
  const admin = data?.viewer.admin ?? false;
  const canCreate = data ? data.viewer.canCreate : viewerCanCreateBots(state.config) && !viewerBotsReadOnly(state.config);
  const templates = useMemo(
    () => catalogTemplates(presets, undefined, { community: community?.teams ?? [], orgPackages: orgListing?.organization ? orgListing.packages : [] }),
    [presets, community, orgListing],
  );
  const apps = useMemo(() => templateApps(templates), [templates]);
  const sections = useMemo(
    () => catalogSections(data ?? { organization: false, entries: [] }, templates, { category, query, showArchived, app: templateApp }),
    [data, templates, category, query, showArchived, templateApp],
  );
  const categories = useMemo(() => catalogCategories(sections.flatMap((section) => section.items)), [sections]);
  const hidden = useMemo(() => hiddenKeySet(hiddenPrefs), [hiddenPrefs]);
  const ctx = { organization, admin, canCreate, feature: viewerCan(state.config, "bots.catalogFeature"), inSidebar: (botId: string) => !hidden.has(hiddenKey("bot", botId)) };
  const creatorAvatar = (item: CatalogItem) => item.kind === "bot" ? personAvatarSrc(people.get(item.entry.owner.principalId)?.avatarUrl) : undefined;

  const back = useCallback(() => {
    if (selected) { setSelected(null); setFeedback(null); return true; }
    if (tool) {
      if (toolsBack.current?.()) return true;
      setTool(null); setInstallUrl(undefined); return true;
    }
    if (expanded) { setExpanded(null); setTemplateApp(null); return true; }
    return false;
  }, [selected, tool, expanded]);

  // The shared keyboard (Settings, Achievements, the persona editor): focus
  // moves in, Tab stays in the dialog, focus returns on close; Escape steps
  // back here first, then closes.
  useCategoryModalKeyboard(dialogRef, "[data-catalog-search]", () => { if (!back()) close(); });

  const fail = (error: unknown) => {
    const body = (error as { body?: { message?: unknown } })?.body;
    const text = typeof body?.message === "string" ? body.message : error instanceof Error ? error.message : String(error);
    setFeedback({ error: true, text });
  };

  const setListing = async (item: Extract<CatalogItem, { kind: "bot" }>, listing: { published: boolean; category?: string; featured?: boolean }, done: string) => {
    setPending(true);
    setFeedback(null);
    try {
      await api<{ catalog: BotCatalogListing | null }>(`/api/bot-catalog/${encodeURIComponent(item.entry.id)}/listing`, { method: "PUT", body: JSON.stringify(listing) });
      setPublishing(false);
      setFeedback({ error: false, text: done });
      setReload((value) => value + 1);
    } catch (error) {
      fail(error);
    } finally {
      setPending(false);
    }
  };

  /** A team, a backup or a package was added (a preview, a tool). */
  const teamImported = (result: TeamImportResult) => {
    setSelected(null);
    setTool(null);
    setInstallUrl(undefined);
    setFeedback({ error: false, text: teamImportedText(result) });
    setReload((value) => value + 1);
  };

  /** An organization package: one click adds it, no confirmation (as the
   * library's From {Organization} shelf did). */
  const addOrgPackage = async (entry: OrgLibraryPackage) => {
    setPending(true);
    setFeedback(null);
    try {
      // SAFETY: this endpoint is owned by the app and returns the added records.
      const response = (await api("/api/org-library/add", {
        method: "POST",
        body: JSON.stringify({ packageId: entry.packageId }),
      })) as { alreadyAdded: boolean; bots?: Bot[]; groups?: Group[]; routines?: Routine[]; connections?: unknown[] };
      for (const bot of response.bots ?? []) dispatch({ type: "botAdded", bot });
      for (const group of response.groups ?? []) dispatch({ type: "groupPatched", group });
      for (const routine of response.routines ?? []) dispatch({ type: "routinePatched", routine });
      track("team_imported", { members: response.bots?.length ?? 0, source: "organization", mode: "add", format: "package" });
      const first = response.bots?.find((bot) => !bot.hidden);
      if (first) {
        dispatch({ type: "select", id: first.id });
        teamImported({ name: entry.name, members: response.bots!.length, ...(response.connections?.length ? { connections: response.connections.length } : {}) });
        return;
      }
      setSelected(null);
      if (!response.alreadyAdded) setFeedback({ error: false, text: t("orgLibrary.addedSkills", { name: entry.name }) });
      setReload((value) => value + 1);
    } catch (error) {
      fail(error);
      setReload((value) => value + 1);
    } finally {
      setPending(false);
    }
  };

  const importItem = async (item: CatalogItem) => {
    const name = itemName(item);
    const done = () => { setFeedback({ error: false, text: t("botCatalog.feedback.imported", { name }) }); setReload((value) => value + 1); };
    setFeedback(null);
    if (item.kind === "template" && item.template.orgPackage) { await addOrgPackage(item.template.orgPackage); return; }
    // A community team previews what it adds first: its detail view.
    if (item.kind === "template" && item.template.community) { setSelected(item); return; }
    if (item.kind === "template" && item.template.role) {
      dispatch({ type: "newBot", role: item.template.role, preserveSelection: true, onCreated: done, onError: (message) => setFeedback({ error: true, text: message }) });
      return;
    }
    setPending(true);
    try {
      if (item.kind === "template" && item.template.preset) {
        const preset = item.template.preset;
        const look = preset.bot.appearance;
        await api("/api/bots", {
          method: "POST",
          body: JSON.stringify({
            name, title: item.template.title, description: item.template.description, soul: item.template.soul, preset: preset.id,
            ...(look ? { color: look.color, ...(look.mascotBody ? { mascotBody: look.mascotBody } : {}) } : {}),
          }),
        });
      } else if (item.kind === "bot") {
        await api(`/api/bot-catalog/${encodeURIComponent(item.entry.id)}/import`, { method: "POST", body: "{}" });
      }
      done();
    } catch (error) {
      fail(error);
    } finally {
      setPending(false);
    }
  };

  const run = (item: CatalogItem, action: CatalogAction) => {
    if (action === "import" || action === "useTemplate") { void importItem(item); return; }
    if (item.kind !== "bot") return;
    const { entry } = item;
    if (action === "open") {
      const bot = state.bots.find((candidate) => candidate.id === entry.id);
      if (!bot) return;
      showInSidebar(hiddenKey("bot", bot.id));
      for (const step of openBotConversationActions(bot, showThreads)) dispatch(step);
      close();
      return;
    }
    if (action === "addToSidebar") {
      showInSidebar(hiddenKey("bot", entry.id));
      setFeedback({ error: false, text: t("botCatalog.feedback.addedToSidebar", { name: entry.name }) });
      return;
    }
    if (action === "removeFromSidebar") {
      hideFromSidebar("bot", entry.id);
      setFeedback({ error: false, text: t("botCatalog.feedback.removedFromSidebar", { name: entry.name }) });
      return;
    }
    if (action === "publish") {
      if (selected?.key !== item.key) setSelected(item);
      setPublishing(true);
      return;
    }
    if (action === "unpublish") { void setListing(item, { published: false }, t("botCatalog.feedback.unpublished")); return; }
    if (action === "feature" || action === "unfeature") {
      void setListing(item, { published: true, featured: action === "feature" }, t(action === "feature" ? "botCatalog.feedback.featured" : "botCatalog.feedback.unfeatured"));
    }
  };

  const renderCardAction = (item: CatalogItem): ReactNode => {
    const pkg = item.kind === "template" ? item.template.orgPackage : undefined;
    if (pkg && orgCardAction(pkg) !== "add") return <OrgPackageState entry={pkg} />;
    const primary = catalogActions(item, ctx)[0];
    if (!primary || primary === "publish" || primary === "unpublish" || primary === "feature" || primary === "unfeature") return null;
    if (primary === "open" && item.kind === "bot" && !state.bots.some((bot) => bot.id === item.entry.id)) return null;
    return (
      <button
        type="button"
        disabled={pending}
        data-catalog-card-action={primary}
        onClick={() => run(item, primary)}
        className={cn(
          "shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50",
          primary === "removeFromSidebar" || primary === "open" ? "border border-border text-ink hover:bg-hover" : "bg-ink text-app hover:opacity-90",
        )}
      >
        {cardActionLabel(primary)}
      </button>
    );
  };

  // A community team's Add is in its preview, under what it adds.
  const renderDetailActions = (item: CatalogItem): ReactNode => item.kind === "template" && item.template.community ? null
    : item.kind === "template" && item.template.orgPackage && orgCardAction(item.template.orgPackage) !== "add" ? <OrgPackageState entry={item.template.orgPackage} />
    : catalogActions(item, ctx).map((action, index) => (
    <button
      key={action}
      type="button"
      disabled={pending || (action === "open" && item.kind === "bot" && !state.bots.some((bot) => bot.id === item.entry.id))}
      data-catalog-action={action}
      onClick={() => run(item, action)}
      className={cn(
        "rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-50",
        index === 0 ? "bg-ink text-app hover:opacity-90" : "border border-border text-ink hover:bg-hover",
        action === "unpublish" && index > 0 && "text-danger",
      )}
    >
      {t(ACTION_LABEL[action])}
    </button>
  ));

  const notice = (
    <>
      {loadFailed && (
        <p role="alert" className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger sm:mx-8">
          {t("botCatalog.loadError")}
          <button type="button" onClick={() => setReload((value) => value + 1)} className="underline">{t("botCatalog.retry")}</button>
        </p>
      )}
      {!canCreate && data && organization && viewerBotsReadOnly(state.config) && (
        <p role="note" className="mx-6 mt-3 text-[12.5px] text-ink-secondary sm:mx-8">{botsReadOnlyText(state.config)}</p>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );

  const templatePreview = (item: CatalogItem): ReactNode | undefined => {
    if (item.kind !== "template" || !teamPreview) return undefined;
    if (teamPreview.loading) return <p className="text-[13px] text-ink-secondary" role="status">{t("botCatalog.loading")}</p>;
    if (!teamPreview.pending) return <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{teamPreview.error || t("botCatalog.loadError")}</p>;
    if (item.template.orgPackage) {
      return <TeamImportDetails pending={teamPreview.pending} importedNames={teamPreview.pending.members.map((member) => member.name)} org />;
    }
    if (!canCreate) return <TeamImportDetails pending={teamPreview.pending} importedNames={teamPreview.pending.members.map((member) => member.name)} />;
    return <TeamImportPreview pending={teamPreview.pending} source="library" onImported={teamImported} />;
  };

  const templateToolsOn = !remoteClient && canCreate;

  return (
    <div className={CATEGORY_MODAL.backdrop} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-catalog-title"
        tabIndex={-1}
        data-bot-catalog-modal=""
        className={CATEGORY_MODAL.frame}
      >
        <div className={CATEGORY_MODAL.content}>
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            title={`${t("common.close")} (${shortcutLabel("close-panel")})`}
            className={CATEGORY_MODAL.close}
          >
            <X size={18} />
          </button>
          {selected ? (
            <BotCatalogDetailView
              item={selected}
              content={detail}
              loading={detailLoading}
              tab={tab}
              onTab={setTab}
              onBack={() => { setSelected(null); setFeedback(null); }}
              creatorAvatar={creatorAvatar(selected)}
              actions={renderDetailActions(selected)}
              preview={templatePreview(selected)}
              below={
                <>
                  {publishing && selected.kind === "bot" && (
                    <PublishForm
                      initial={selected.entry.catalog?.category ? catalogCategoryLabel(selected.entry.catalog.category) : ""}
                      pending={pending}
                      onCancel={() => setPublishing(false)}
                      onPublish={(value) => void setListing(selected, { published: true, ...(value.trim() ? { category: categoryFromInput(value) } : {}) }, t("botCatalog.feedback.published"))}
                    />
                  )}
                  <FeedbackLine feedback={feedback} />
                </>
              }
            />
          ) : tool && templateToolsOn ? (
            <div className="flex min-h-0 flex-1 flex-col" data-catalog-tools="">
              <header className={CATEGORY_MODAL.titleBar}>
                <button type="button" onClick={() => { if (!toolsBack.current?.()) { setTool(null); setInstallUrl(undefined); } }} className="-ml-1.5 mb-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink" data-catalog-back="">
                  <ChevronLeft size={14} aria-hidden="true" />{t("botCatalog.back")}
                </button>
                <h2 id="bot-catalog-title" className={CATEGORY_MODAL.title}>{t("botCatalog.section.templates")}</h2>
              </header>
              <TemplateTools tool={tool} onTool={setTool} installUrl={installUrl} onImported={teamImported} backRef={toolsBack} />
            </div>
          ) : (
            <BotCatalogView
              organization={organization}
              categories={categories}
              category={category}
              onCategory={(value) => { setCategory(value); setExpanded((current) => current === "templates" ? current : null); }}
              query={query}
              onQuery={setQuery}
              sections={sections}
              expanded={expanded}
              onExpand={(value) => { setExpanded(value); if (value !== "templates") setTemplateApp(null); }}
              showArchived={showArchived}
              onShowArchived={setShowArchived}
              hasArchived={Boolean(data?.entries.some((entry) => entry.source === "mine" && entry.archived))}
              creatorAvatar={creatorAvatar}
              onOpen={(item) => { setFeedback(null); setSelected(item); }}
              renderAction={renderCardAction}
              notice={notice}
              loading={!data && !loadFailed}
              onTemplateTool={templateToolsOn ? (next) => { setFeedback(null); setInstallUrl(undefined); setTool(next); } : undefined}
              templateApps={apps}
              templateApp={templateApp}
              onTemplateApp={setTemplateApp}
              repositoryUrl={community?.repositoryUrl}
              onOpenRepository={(url) => void openExternal(url)}
            />
          )}
          {retroSkin && (
            <div className="r98-dialog-footer">
              <button type="button" className="r98-dialog-ok" onClick={close}>{t("retro.button.ok")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** An organization package that cannot be added now: added, needs a newer
 * Sagax, still downloading, or no release yet. */
function OrgPackageState({ entry }: { entry: OrgLibraryPackage }) {
  const state = orgCardAction(entry);
  if (state === "add") return null;
  if (state === "added") {
    return <span className="flex shrink-0 items-center gap-1 rounded-full bg-raised px-3 py-1.5 text-[12px] text-ink-secondary" data-catalog-package-state="added"><Check size={13} className="text-success" />{t("orgLibrary.added")}</span>;
  }
  const key = state === "updateApp" ? "orgLibrary.updateApp" : state === "notReady" ? "orgLibrary.notReady" : "orgLibrary.noRelease";
  return <span className="max-w-[140px] shrink-0 text-right text-[11.5px] text-ink-secondary" data-catalog-package-state={state}>{t(key)}</span>;
}
