/** Isolated gallery for Playwright screenshots of the actions beside a chat
 * message (MessageBar, MessageHoverActions). Not shipped in the app.
 * ?skin=<id>&lang=<code>&state=rest|hover&side=bot|user: `hover` keeps the
 * row of `side` in view; open its popups with a real click. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Code, Pencil, Pin, RefreshCw, Volume2 } from "lucide-react";
import { MessageBar, MessageMenuItem } from "../components/MessageBar";
import { HOVER_ICON } from "../components/MessageHoverActions";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");
const state = params.get("state") ?? "hover";
const side = params.get("side") === "user" ? "user" : "bot";

function Row({ user }: { user: boolean }) {
  const text = user ? "Can you check the build?" : "Hi, I'm Rocket. What would you like me to do?";
  const bar = (
    <MessageBar
      side={user ? "user" : "bot"}
      time="2:23 PM"
      copy={text}
      onReply={() => {}}
      requestId="m_1"
      react={{ mine: [], onPick: () => {} }}
      visible={state !== "rest" && (user ? side === "user" : side === "bot")}
      view={user ? undefined : (
        <>
          <MessageMenuItem label={t("chat.speak.read")} icon={<Volume2 {...HOVER_ICON} />} onSelect={() => {}} />
          <MessageMenuItem label={t("chat.showRawMarkdown")} icon={<Code {...HOVER_ICON} />} onSelect={() => {}} />
        </>
      )}
    >
      {user ? (
        <>
          <MessageMenuItem label={t("chat.editMessage")} icon={<Pencil {...HOVER_ICON} />} onSelect={() => {}} />
          <MessageMenuItem label={t("chat.pinMessage")} icon={<Pin {...HOVER_ICON} />} onSelect={() => {}} />
        </>
      ) : (
        <>
          <MessageMenuItem label={t("chat.regenerate")} icon={<RefreshCw {...HOVER_ICON} />} onSelect={() => {}} />
          <MessageMenuItem label={t("chat.pinMessage")} icon={<Pin {...HOVER_ICON} />} onSelect={() => {}} />
        </>
      )}
    </MessageBar>
  );
  return (
    <div className="group flex w-full flex-col" data-row={user ? "user" : "bot"}>
      <div className={user ? "flex w-full items-center justify-end gap-1.5" : "flex w-full items-center justify-start gap-1.5"}>
        {user && bar}
        <div data-chat-bubble className={user ? "w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink" : "w-fit rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink"}>
          {text}
        </div>
        {!user && bar}
      </div>
    </div>
  );
}

function Gallery() {
  // the screenshot script hovers and clicks like a person would
  return (
    <div className="min-h-dvh bg-app p-6">
      <div className="mx-auto flex w-[640px] flex-col gap-[300px]">
        <Row user={false} />
        <Row user />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
