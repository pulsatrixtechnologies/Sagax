// A page for the Computer tab's machine menu, opened by
// scripts/screenshot-computer-menu.mjs. It is not part of the app: Vite
// serves preview/computer-menu.html in development only.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Globe, Laptop, Server } from "lucide-react";

import { ScreenPicker } from "@/components/computer/ComputerMenu";
import { setLocale, t } from "@/lib/i18n";
import { applySkin } from "@/lib/skins";

import "../styles.css";

const params = new URLSearchParams(location.search);
setLocale(params.get("lang") ?? "en");
const skin = params.get("skin");
if (skin === "pulsatrix" || skin === "pulsatrix-light") applySkin(skin);

function Preview() {
  const [chosen, setChosen] = useState("server");
  return (
    <div className="min-h-screen bg-app p-6 text-ink">
      <section className="w-[400px] rounded-2xl border border-hairline bg-panel p-4" data-computer-preview="">
        <div className="mb-4 flex items-center gap-3 text-[13px] text-ink-secondary">
          <span>{t("botPanel.tab.details")}</span>
          <span>{t("botPanel.tab.library")}</span>
          <span className="rounded-lg bg-card px-2 py-1 text-ink">{t("botPanel.tab.computer")}</span>
        </div>
        <ScreenPicker
          items={[
            { key: "server", label: t("orgComputer.choice.cloud"), icon: Server, here: true, status: "off" },
            { key: "desktop:mbp", label: "Jean-Christophes-MacBook-Pro", icon: Laptop, status: "on" },
            { key: "browser", label: t("computer.view.browser"), icon: Globe },
          ]}
          chosen={chosen}
          onPick={setChosen}
        />
      </section>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
