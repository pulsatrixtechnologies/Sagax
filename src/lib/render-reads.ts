// Values a component reads from outside React: a module variable (the
// language t() answers in), the preload bridge, this device's voice choice.
// React Compiler caches a plain call that has no reactive input for the life
// of the component, so in a compiled component ("use memo") such a read
// would keep its first value. A hook is called on every render and its
// result is a reactive input, so these keep reading the current value and
// re-derive what depends on them.
import { activeLocale } from "@/lib/i18n";
import { localSystemVoiceActive } from "@/lib/local-voice";

/** The locale t() is answering in, read at every render. */
export function useActiveLocale(): string {
  return activeLocale();
}

/** Whether read-aloud uses this device's system voice, read at every render. */
export function useLocalSystemVoice(): boolean {
  return localSystemVoiceActive();
}

/** Whether this window is a remote client of another Sagax, read at every render. */
export function useRemoteClient(): boolean {
  return window.ogb?.remoteClient?.active === true;
}
