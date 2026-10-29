/** Isolated gallery for the access card a bot posts to ask the person to
 * sign in to an engine (#1545, sagax_settings models.engineSignIn), next to
 * the existing no-access card. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccessCard } from "../components/AccessCard";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const viewer = { principalId: "pr_owner", admin: false };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="flex min-h-screen flex-col gap-4 bg-panel p-6 text-ink">
      <AccessCard access={{ reason: "sign_in", engine: "Work account", instanceId: "claude-2", botId: "b1", botName: "Scout", ownerPrincipalId: "pr_owner", payerPrincipalId: "pr_owner" }} viewer={viewer} onSignIn={() => {}} />
      <AccessCard access={{ reason: "no_access", engine: "Claude", botId: "b1", botName: "Scout", ownerPrincipalId: "pr_owner", payer: "speaker", payerPrincipalId: "pr_owner", subscriptionSignIn: true }} viewer={viewer} onSignIn={() => {}} />
    </main>
  </StrictMode>,
);
