// The Data window's page (`/data-window#bot=<id>[&card=<id>]`): one bot's
// Data results on their own, in a desktop window (electron/data-window.mjs) or
// a browser window (src/lib/data-window.ts). It has its own store, like any
// other tab of the app. It refuses to show anything while the experimental
// switch is off, whoever opened the address.
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Database } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { dataWindowEnabled } from "@/lib/feature-flags";
import { postDataWindowMessage, readDataWindowTarget, subscribeDataWindowMessages } from "@/lib/data-window";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { setLocale, t } from "@/lib/i18n";

const DataPanel = lazy(() => import("./DataPanel").then((module) => ({ default: module.DataPanel })));

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
const currentHash = () => location.hash;

function Notice({ children }: { children: string }) {
  return <div role="status" className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-ink-secondary">{children}</div>;
}

export function DataWindowBody() {
  const { state } = useStore();
  const hash = useSyncExternalStore(subscribeHash, currentHash);
  const target = readDataWindowTarget(hash);
  const botId = target?.botId;
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
  const ready = state.hydrated === true && state.config != null;
  const enabled = dataWindowEnabled(state.config);

  // This device's language, else the server's, as the main window does.
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    setLocale(language || globalThis.navigator?.language);
    setLocaleEpoch((epoch) => epoch + 1);
  }, [language]);

  const title = bot ? t("dataWindow.title", { name: bot.name }) : "Data";
  useEffect(() => {
    document.title = title;
  }, [title]);

  // A card to show: from the address (first open, or a browser window asked
  // again) and from the main page while this window is already open.
  const requestCounter = useRef(0);
  const [request, setRequest] = useState<{ id: string; requestId: number }>();
  const hashCard = target?.cardId;
  useEffect(() => {
    if (hashCard) setRequest({ id: hashCard, requestId: ++requestCounter.current });
  }, [hash, hashCard]);
  useEffect(() => {
    if (!botId) return;
    return subscribeDataWindowMessages((message) => {
      if (message.type === "card" && message.botId === botId) setRequest({ id: message.cardId, requestId: ++requestCounter.current });
    });
  }, [botId]);

  // The result in view goes to the main page, whose composer sends it with
  // the next message to this bot; nothing once this window goes.
  const view = enabled ? state.dataView : null;
  useEffect(() => {
    if (!botId) return;
    postDataWindowMessage({ type: "view", botId, view: view && view.botId === botId ? view : null });
  }, [botId, view]);
  useEffect(() => {
    if (!botId) return;
    const gone = () => postDataWindowMessage({ type: "view", botId, view: null });
    window.addEventListener("pagehide", gone);
    return () => {
      window.removeEventListener("pagehide", gone);
      gone();
    };
  }, [botId]);

  let body;
  if (!ready) body = <Notice>{t("data.loading")}</Notice>;
  else if (!enabled) body = <Notice>{t("dataWindow.off")}</Notice>;
  else if (!bot) body = <Notice>{t("dataWindow.noBot")}</Notice>;
  else body = (
    <div data-data-window-panel="" className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
      <Suspense fallback={<Notice>{t("data.loading")}</Notice>}>
        <DataPanel key={bot.id} bot={bot} requestedCard={request} />
      </Suspense>
    </div>
  );

  return (
    <main data-data-window={botId ?? ""} className="flex h-dvh min-h-0 flex-col bg-panel text-ink">
      <header className="flex h-11 shrink-0 items-center gap-2 px-4">
        <Database size={16} strokeWidth={1.75} aria-hidden="true" className="text-ink-secondary" />
        <h1 className="truncate text-[14px] font-semibold">{title}</h1>
      </header>
      {body}
    </main>
  );
}

export function DataWindow() {
  return (
    <StoreProvider>
      <DataWindowBody />
    </StoreProvider>
  );
}
