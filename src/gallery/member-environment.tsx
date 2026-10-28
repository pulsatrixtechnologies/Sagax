/** Isolated gallery for headless screenshots of what an organization member
 * sets in their own environment (#1098, 2026-10-28): their own voice keys
 * next to their own web search key (Settings > Models and voice), and their
 * own Show tool calls (Settings > Appearance), and the working folder of a
 * group they own (group panel > Advanced). Not shipped. A mocked fetch
 * answers; nothing connects. Fictitious values only. ?skin=<id>&lang=<code> */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { PersonalVoiceKeys } from "../components/settings/PersonalVoiceKeys";
import { WebSearchSettings } from "../components/settings/WebSearchSettings";
import { ToolCallsRow } from "../components/settings/AppearanceSettings";
import { RoomWorkingFolder, roomFolderEditable } from "../components/GroupView";
import { MEMBER_ALWAYS_PERMISSIONS } from "../../shared/permissions";
import { SettingsGroup } from "../components/SettingsPrimitives";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.origin).pathname;
  if (path === "/api/me/voice-keys") {
    return json({ elevenlabs: { configured: true, last4: "7f3a" }, fish: { configured: false, last4: null }, xai: { configured: false, last4: null } });
  }
  if (path === "/api/me/web-search") return json({ provider: "brave", baseUrl: null, keyConfigured: true, last4: "c41d", ready: true });
  return realFetch(input, init);
};

function Sample({ id, width = 680, children }: { id: string; width?: number; children: ReactNode }) {
  return (
    <section data-gallery-sample={id} className="bg-app p-6" style={{ width }}>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** A member of an organization server: their own settings, no right to
 * edit the installation. */
const store = {
  state: {
    ...initialState,
    config: {
      personalSettings: true,
      features: { showToolCalls: true },
      // what the server sends a member with no list from Perspicax
      viewer: { operator: false, principalId: "pr_me", role: "member", permissions: [...MEMBER_ALWAYS_PERMISSIONS] },
    } as unknown as typeof initialState.config,
  },
  dispatch: () => {},
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
};

const ownGroup = {
  id: "ops", threadId: "t-ops", name: "Opérations", bulletin: "", unread: false, createdAt: Date.now(),
  memberIds: [], humanIds: ["pr_me"], ownerId: "pr_me", cwd: "/home/exemple/projets/operations", messages: [], tasks: [],
} as unknown as Parameters<typeof RoomWorkingFolder>[0]["group"];

function Gallery() {
  return (
    <main className="flex min-h-screen flex-col bg-app text-ink" data-gallery-member-environment="">
      <Sample id="models-voice-member">
        <WebSearchSettings />
        <PersonalVoiceKeys />
      </Sample>
      <Sample id="group-folder-owner-member">
        <RoomWorkingFolder group={ownGroup} disabled={!roomFolderEditable(ownGroup, store.state.config)} adminOnlyNote={!roomFolderEditable(ownGroup, store.state.config)} />
      </Sample>
      <Sample id="appearance-tool-calls-member">
        <SettingsGroup title={t("settings.group.conversation")} groupId="conversation">
          <ToolCallsRow />
        </SettingsGroup>
      </Sample>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
