// Saves a bot's runtime settings (PATCH /api/bots/:id/runtime-settings) and
// shows the saved values at once; the server's bot frame follows.
import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { botRuntimeSettingsPath, type BotRuntimePatch } from "@/lib/bot-runtime-settings";
import { api, type Bot } from "@/state/store";

export function useBotRuntimeSettings(bot: Bot) {
  const [saved, setSaved] = useState<BotRuntimePatch>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  // A newer bot frame (this save's, or someone else's change) wins.
  const signature = JSON.stringify([bot.maxConcurrentThreads, bot.maxParallelPerPerson, bot.busySend, bot.automaticRecovery, bot.turnPayer]);
  useEffect(() => { setSaved({}); }, [signature]);
  // a cleared turnPayer (null) shows the default again
  const { turnPayer: savedPayer, ...savedRest } = saved;
  const shown: Bot = { ...bot, ...savedRest, ...(savedPayer !== undefined ? { turnPayer: savedPayer ?? undefined } : {}) };
  const save = async (patch: BotRuntimePatch): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const answer = await api<{ stored: BotRuntimePatch }>(botRuntimeSettingsPath(bot.id), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSaved({ ...(patch.turnPayer === null ? { turnPayer: null } : {}), ...answer.stored });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.parallel.error"));
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { shown, save, saving, error };
}
