/** Isolated gallery for headless screenshots of @mentions of people (chips),
 * the viewer's own standing out, in the transcript and in the composer mirror.
 * Not shipped in the app. ?skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MentionText } from "../components/MentionText";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { MentionPeer } from "../lib/mentions";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());

const peers: MentionPeer[] = [
  { name: "Scout", color: "blue" },
  { name: "Ada Martin", person: true },
  { name: "Sam Roy", person: true, me: true },
];
const text = "@Ada Martin can you review this with @Scout? @Sam Roy you own the follow-up.";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app p-6 text-ink">
      <p className="mb-1 text-xs text-ink-secondary">Transcript (viewer: Sam Roy)</p>
      <div className="mb-6 max-w-xl rounded-2xl bg-raised p-3 text-[14px] leading-7">
        <ChatMarkdown text={text} mentionPeers={peers} everyone />
      </div>
      <p className="mb-1 text-xs text-ink-secondary">Composer mirror</p>
      <div className="mention-editor-mirror max-w-xl rounded-xl bg-inset text-[14px]">
        <MentionText text="@Ada Martin and @Scout, ready?" peers={peers.map((peer) => ({ ...peer, me: false }))} />
      </div>
    </div>
  </StrictMode>,
);
