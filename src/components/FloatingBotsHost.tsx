// Always mounted, nearly free: holds the list of bots this device put "on the
// desktop" and, only once there is one, fetches the floating bots' brain and
// drawings (src/components/floating-bots). With no bot floated it renders
// nothing and downloads nothing.
import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { floatingBots, forgetLegacyBotLooks, loadFloatingBots, readLegacyBotLooks, subscribeFloatingBots } from "@/lib/floating-bots";
import { useStore } from "@/state/store";
import { botMascotLook } from "../../shared/mascot-look";

const FloatingBots = lazy(loadFloatingBots);

/**
 * The character used to be kept per device; it now lives with the bot. Once
 * the bots are loaded, each bot that has no character yet gets the one this
 * device remembered, then the device forgets it.
 */
function useMoveLegacyLooks() {
  const { state, dispatch } = useStore();
  const loaded = state.bots.length > 0;
  useEffect(() => {
    if (!loaded) return;
    const legacy = readLegacyBotLooks();
    const ids = Object.keys(legacy);
    if (!ids.length) return;
    for (const bot of state.bots) {
      const look = legacy[bot.id];
      if (look && !bot.mascotLook) dispatch({ type: "updateBot", botId: bot.id, patch: { mascotLook: botMascotLook(look) } });
    }
    forgetLegacyBotLooks();
    // once, when the bots first arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
}

export function FloatingBotsHost() {
  useMoveLegacyLooks();
  const entries = useSyncExternalStore(subscribeFloatingBots, floatingBots, floatingBots);
  if (entries.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <FloatingBots />
    </Suspense>
  );
}
