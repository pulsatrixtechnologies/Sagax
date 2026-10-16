/** Isolated gallery for Playwright screenshots of the whole desktop sidebar
 * (bot rows, Primary Bot, sections, foot) beside Grok Bot's. Not shipped in
 * the app. It answers /api itself with a made-up team, so nothing reaches a
 * server. ?skin=<id>&lang=<code>&threads=header|sidebar */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message, type Task } from "../state/store";
import { Sidebar } from "../components/Sidebar";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
try {
  localStorage.setItem("sagax.interfaceMode.v1", "advanced");
  localStorage.setItem("sagax-sidebar-shortcuts", "1");
  localStorage.setItem("omb-sidebar-width-v2", "368");
  localStorage.setItem("omb-threads-location", params.get("threads") === "sidebar" ? "sidebar" : "header");
} catch {
  // the gallery still renders with the defaults
}

const now = Date.now();
const minutes = (n: number) => now - n * 60_000;
const message = (id: string, text: string, at: number, role: Message["role"] = "bot"): Message =>
  ({ id, role, kind: "text", text, at } as Message);
const task = (threadId: string, title: string, at: number, extra: Partial<Task> = {}): Task =>
  ({ threadId, title, createdAt: at, updatedAt: at, ...extra });

const bot = (id: string, name: string, extra: Partial<Bot>, last: string, at: number): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" },
  messages: [message(`m-${id}`, last, at)],
  tasks: [task(`t-${id}`, "Général", at)],
  ...extra,
} as Bot);

const team: Bot[] = [
  bot("nova", "Nova", { chiefOfStaff: true, title: "Chef de cabinet", color: "green", mascotBody: "squircle", pinned: true }, "Je coordonne la semaine avec l'équipe.", minutes(4)),
  bot("atlas", "Atlas", {
    title: "ConnectWise Ops & MS 365", color: "pink", mascotBody: "squircle", section: "My team",
    tasks: [
      task("t-atlas", "Général", minutes(8)),
      task("t-atlas-2", "Rapport mensuel des billets", minutes(30), { unread: true }),
      task("t-atlas-3", "Migration Exchange", minutes(95), { unread: true }),
    ],
  }, "J'ai supprimé le flux Power Automate « Nouveau courriel » comme demandé.", minutes(8)),
  bot("iris", "Iris", { title: "Full Stack, Dev Ops & ITSec", color: "orange", mascotBody: "drop", section: "My team" }, "J'ai fait le ménage de ma mémoire et gardé les règles actives.", minutes(42)),
  bot("milo", "Milo", { title: "Vérification", color: "teal", mascotBody: "blob", section: "My team" }, "J'ai noté cette règle permanente. Une seule question avant de fermer.", minutes(70)),
  bot("lina", "Lina", { title: "Juridique et marketing", color: "purple", mascotBody: "circle", section: "My team" }, "Les deux sont supprimées, il ne me reste aucune routine.", minutes(130)),
  bot("forge", "Concepteur de bots", {
    color: "graphite", mascotBody: "capsule",
    installedPackage: { id: "designer", name: "Concepteur", release: "1.0.0", requiredApps: [], source: "org" },
  }, "J'ai envoyé la règle aux 7 bots et je l'ai aussi notée.", minutes(200)),
  bot("veille", "Veille", {
    title: "Veille technologique", color: "blue", mascotBody: "capsule",
    installedPackage: { id: "veille", name: "Veille", release: "1.0.0", requiredApps: [], source: "org" },
  }, "Trois avis de sécurité à lire ce matin.", minutes(320)),
];

// Answer the app's /api calls here: the made-up team, a profile, and an
// empty answer for everything else.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/api/bots") return json({ bots: team, groups: [], sections: ["My team"], computerControl: {} });
  if (path === "/api/config") return json({ profile: { name: "Alex Gagnon" } });
  return json({ error: "gallery" }, 404);
}) as typeof window.fetch;
class SilentEventSource {
  onmessage = null;
  onerror = null;
  onopen = null;
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;

function SelectAtlas() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "atlas") dispatch({ type: "select", id: "atlas" });
  }, [state.hydrated, state.selectedId, dispatch]);
  return null;
}

function Gallery() {
  return (
    <StoreProvider>
      <SelectAtlas />
      <div data-gallery className="flex h-[1015px] w-[368px] overflow-hidden bg-app text-ink">
        <Sidebar open onClose={() => {}} />
      </div>
    </StoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
