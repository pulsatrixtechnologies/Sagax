/** Isolated gallery for headless screenshots of web work out of sight and of
 * a bot controlling this computer's own screen (2026-10-28,
 * shared/host-control.ts). Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=web|screen&before=1
 * `before=1` draws the same conversation as an older build showed it: no
 * banner and no line while the bot drives the screen. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { HostControlIndicator } from "../components/HostControlIndicator";
import { StatusActivityRow } from "../components/StatusActivityRow";
import { ThreadRefsContext } from "../components/ThreadRefs";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Message } from "../state/store";
import { HOST_CONTROL_NOTICE } from "../../shared/host-control";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const before = params.get("before") === "1";
const view = params.get("view") === "screen" ? "screen" : "web";
const fr = lang === "fr";

const BOT = { id: "bot-scout", name: "Scout", threadId: "thread-1" };
const notice = { id: "n1", role: "bot", kind: "activity", at: 0, tool: { name: HOST_CONTROL_NOTICE, ok: true } } as Message;

function UserBubble({ text }: { text: string }) {
  return <div className="ml-auto w-fit max-w-[80%] rounded-2xl bg-accent px-4 py-2 text-[14px] text-white">{text}</div>;
}

function Conversation() {
  if (view === "web") {
    return (
      <>
        <UserBubble text={fr ? "Montre-moi la dernière vidéo de Lumière Studio." : "Show me the latest video from Lumière Studio."} />
        <div className="text-[14px] text-ink">
          <ChatMarkdown text={fr
            ? "Voici la dernière vidéo de Lumière Studio, publiée hier :\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"
            : "Here is Lumière Studio's latest video, posted yesterday:\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"} />
        </div>
      </>
    );
  }
  return (
    <>
      <UserBubble text={fr ? "Ouvre ça dans mon Chrome." : "Open it in my Chrome."} />
      <p className="text-[14px] text-ink">{fr ? "Je prends le contrôle de ton ordinateur pour l'ouvrir dans Chrome." : "I'm taking control of your computer to open this in Chrome."}</p>
      {!before && <StatusActivityRow message={notice} />}
    </>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div data-shot="host-control" className="mx-auto flex max-w-[760px] flex-col overflow-hidden rounded-2xl bg-card">
        {view === "screen" && !before && <HostControlIndicator load={async () => [BOT]} stop={async () => {}} />}
        <div className="flex flex-col gap-3 px-5 py-4">
          <Conversation />
        </div>
      </div>
      <span className="sr-only">{t("hostControl.stop")}</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <ThreadRefsContext.Provider value={{ threads: [], currentBotId: undefined }}>
        <Gallery />
      </ThreadRefsContext.Provider>
    </StoreProvider>
  </StrictMode>,
);
