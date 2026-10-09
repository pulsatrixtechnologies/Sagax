// Browse Bots: the organisation bot catalogue, in its own full-height modal
// (the Achievements shell: the close button top right, Escape steps back
// then closes, focus stays inside). Opened by the store's openBotCatalog()
// from the mascot menu, the To: picker and the sidebar section menu.
//
// Sources: GET /api/bot-catalog (mine, shared with me, published to the
// organisation; server/routes/bot-catalog.ts) and the templates (built-in
// roles, and New bot's presets when the server lets this viewer read them).
// Actions: show or hide a shared bot in the sidebar (src/lib/sidebar-hidden.ts),
// Import Bot (a copy for the viewer: POST /api/bot-catalog/:id/import, or a
// template through New bot's own creation), Open, and publish, withdraw or
// feature through PUT /api/bot-catalog/:id/listing.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, closeBotCatalog, useStore } from "@/state/store";
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
import { BotCatalogView } from "./BotCatalogView";
import { BotCatalogDetailView, templateDetail, type CatalogDetailContent, type CatalogTab } from "./BotCatalogDetailView";

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
  const [expanded, setExpanded] = useState<CatalogSectionId | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [detail, setDetail] = useState<CatalogDetailContent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<CatalogTab>("soul");
  const [publishing, setPublishing] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const close = useCallback(() => dispatch(closeBotCatalog()), [dispatch]);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    api<BotCatalogResponse>("/api/bot-catalog")
      .then((result) => { if (alive) setData(result); })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, [reload]);

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
    if (selected.kind === "template") {
      setDetail(templateDetail(selected));
      return;
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
  const templates = useMemo(() => catalogTemplates(presets), [presets]);
  const sections = useMemo(
    () => catalogSections(data ?? { organization: false, entries: [] }, templates, { category, query, showArchived }),
    [data, templates, category, query, showArchived],
  );
  const categories = useMemo(() => catalogCategories(sections.flatMap((section) => section.items)), [sections]);
  const hidden = useMemo(() => hiddenKeySet(hiddenPrefs), [hiddenPrefs]);
  const ctx = { organization, admin, canCreate, feature: viewerCan(state.config, "bots.catalogFeature"), inSidebar: (botId: string) => !hidden.has(hiddenKey("bot", botId)) };
  const creatorAvatar = (item: CatalogItem) => item.kind === "bot" ? personAvatarSrc(people.get(item.entry.owner.principalId)?.avatarUrl) : undefined;

  const back = useCallback(() => {
    if (selected) { setSelected(null); setFeedback(null); return true; }
    if (expanded) { setExpanded(null); return true; }
    return false;
  }, [selected, expanded]);

  // Same keyboard as Settings and Achievements: focus moves in, Escape
  // steps back then closes, Tab stays in the dialog, focus returns on close.
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("[data-catalog-search]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!backRef.current()) dispatch(closeBotCatalog());
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.checkVisibility());
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

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

  const importItem = async (item: CatalogItem) => {
    const name = itemName(item);
    const done = () => { setFeedback({ error: false, text: t("botCatalog.feedback.imported", { name }) }); setReload((value) => value + 1); };
    setFeedback(null);
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
    if (action === "import") { void importItem(item); return; }
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

  const renderDetailActions = (item: CatalogItem): ReactNode => catalogActions(item, ctx).map((action, index) => (
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-catalog-title"
        tabIndex={-1}
        data-bot-catalog-modal=""
        className="relative flex h-[calc(100dvh-48px)] w-[min(1040px,calc(100vw-24px))] flex-col overflow-hidden rounded-[14px] border border-border bg-app outline-none sm:h-[calc(100dvh-64px)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label={t("common.close")}
          title={`${t("common.close")} (${shortcutLabel("close-panel")})`}
          className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"
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
        ) : (
          <BotCatalogView
            organization={organization}
            categories={categories}
            category={category}
            onCategory={(value) => { setCategory(value); setExpanded(null); }}
            query={query}
            onQuery={setQuery}
            sections={sections}
            expanded={expanded}
            onExpand={setExpanded}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
            hasArchived={Boolean(data?.entries.some((entry) => entry.source === "mine" && entry.archived))}
            creatorAvatar={creatorAvatar}
            onOpen={(item) => { setFeedback(null); setSelected(item); }}
            renderAction={renderCardAction}
            notice={notice}
            loading={!data && !loadFailed}
          />
        )}
        {retroSkin && (
          <div className="r98-dialog-footer">
            <button type="button" className="r98-dialog-ok" onClick={close}>{t("retro.button.ok")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
