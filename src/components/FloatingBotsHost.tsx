// Always mounted, nearly free: holds the list of bots this device put "on the
// desktop" and, only once there is one, fetches the floating bots' brain and
// drawings (src/components/floating-bots). With no bot floated it renders
// nothing and downloads nothing.
import { lazy, Suspense, useSyncExternalStore } from "react";
import { floatingBots, loadFloatingBots, subscribeFloatingBots } from "@/lib/floating-bots";

const FloatingBots = lazy(loadFloatingBots);

export function FloatingBotsHost() {
  const entries = useSyncExternalStore(subscribeFloatingBots, floatingBots, floatingBots);
  if (entries.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <FloatingBots />
    </Suspense>
  );
}
