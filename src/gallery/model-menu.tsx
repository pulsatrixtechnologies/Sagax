/** Isolated gallery for Playwright screenshots of the composer's model menu
 * with its provider submenus and favorites. Not shipped in the app.
 * ?skin=<id>&lang=<code>&open=<provider key>&q=<search>&favorites=1&narrow=1 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../components/ModelMenu";
import { setLocale, t } from "../lib/i18n";
import { favoriteKey, toggleModelFavorite, useModelFavorites, writeModelFavorites } from "../lib/model-favorites";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
writeModelFavorites(params.get("favorites") === "1" ? [favoriteKey("claude", "claude-opus-5-5"), favoriteKey("grok", "grok-4.7")] : []);

const model = (instanceId: string, id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey(instanceId, id), kind: "model", instanceId, modelId: id, label, current: false, ...extra,
});
const defaultTag = t("model.defaultTag");
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    { key: "auto", kind: "auto", label: t("model.auto.label"), detail: t("model.auto.rowHint"), current: false },
    { key: "follow", kind: "follow", label: t("model.useBotModel", { name: "Dispatch" }), detail: "Claude Sonnet 5", current: true },
  ] },
  { key: "claude", label: "Claude (API key)", rows: [
    model("claude", "claude-fable-5-1", "Claude Fable 5.1", { detail: "Élevé" }),
    model("claude", "claude-fable-5", "Claude Fable 5", { detail: "Élevé" }),
    model("claude", "claude-opus-5-5", "Claude Opus 5.5", { detail: "Élevé" }),
    model("claude", "claude-opus-5", "Claude Opus 5", { detail: "Élevé" }),
    model("claude", "claude-sonnet-5-5", "Claude Sonnet 5.5", { detail: "Moyen" }),
    model("claude", "claude-sonnet-5", "Claude Sonnet 5", { detail: "Moyen", tags: [defaultTag] }),
    model("claude", "claude-haiku-5-5", "Claude Haiku 5.5"),
    model("claude", "claude-haiku-4-5", "Claude Haiku 4.5"),
    model("claude", "dwarfstar::qwen3.8-flash-next", "DwarfStar: Qwen3.8 Flash Next", { detail: "Local" }),
  ] },
  { key: "grok", label: "Grok", rows: [model("grok", "grok-4.7", "Grok 4.7", { detail: "Élevé" }), model("grok", "grok-4.5", "Grok 4.5", { detail: "Élevé" })] },
  { key: "codex", label: "OpenAI", rows: [model("codex", "gpt-5.6", "GPT-5.6", { detail: "Moyen" }), model("codex", "gpt-5.6-mini", "GPT-5.6 mini")] },
  { key: "dwarfstar", label: "DwarfStar (local)", rows: [model("dwarfstar", "qwen3.8-flash-next", "Qwen3.8 Flash Next"), model("dwarfstar", "gemma-4", "Gemma 4")] },
];

function Gallery() {
  const keys = useModelFavorites();
  useEffect(() => {
    const open = params.get("open");
    const query = params.get("q");
    const input = document.querySelector<HTMLInputElement>("[data-model-search]");
    if (query && input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (open) setTimeout(() => document.querySelector<HTMLElement>(`[data-model-provider="${open}"]`)?.click(), 50);
  }, []);
  const narrow = params.get("narrow") === "1";
  return (
    <div className="min-h-dvh bg-app p-4">
      <div data-model-menu
        style={narrow ? { left: 8, right: 8, bottom: 16 } : { right: 24, bottom: 24, width: 340 }}
        className="fixed z-50 flex max-h-[min(560px,calc(100dvh-96px))] flex-col rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50">
        <ModelSearchList variant="popover" autoFocus submenus sections={sections} onPick={() => {}}
          favorites={{ keys, onToggle: (row) => toggleModelFavorite(row.key) }} />
        <div className="border-t border-popover-hairline px-3 py-2 text-[13px]">{t("model.effort")}</div>
        <div className="border-t border-popover-hairline px-3 py-2 text-[13px]">{t("model.edit")}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
