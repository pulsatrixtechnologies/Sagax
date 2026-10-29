/** Isolated gallery for headless screenshots of native controls on a skin
 * (#1507): a native list (drawn open, as a listbox), a dropdown, a date
 * field, and an accent button enabled and disabled. Not shipped in the app.
 * ?skin=<id>&tint=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applySkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { SkinTintId } from "../lib/skin-families";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : "pulsatrix", (params.get("tint") as SkinTintId | null) ?? null);

const field = "rounded-lg border border-hairline/50 bg-ink/[0.03] px-3 py-2 text-[12.5px] text-ink outline-none";

function Gallery() {
  return (
    <div data-gallery-card className="w-[420px] space-y-4 bg-canvas p-6 text-ink">
      <select aria-label="Duration" size={5} className={field} defaultValue="15">
        <option value="5">5 min</option>
        <option value="15">15 min</option>
        <option value="30">30 min</option>
        <option value="45">45 min</option>
        <option value="60">1 h</option>
      </select>
      <div className="flex gap-3">
        <select aria-label="Repeat" className={field} defaultValue="none">
          <option value="none">Does not repeat</option>
          <option value="daily">Every day</option>
        </select>
        <input aria-label="Date" type="date" className={field} defaultValue="2026-10-28" />
      </div>
      <div className="flex gap-3">
        <button type="button" className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-accent-ink">Run now</button>
        <button type="button" disabled className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">Schedule routine</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
