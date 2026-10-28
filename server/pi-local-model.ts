// #1422: a pi model served by a local host (`omlx/<model>`, `ollama/<model>`...)
// runs on that machine's own server. It needs no key of the person who pays
// and no organization allowance, and it is never swapped for a cloud model
// the person did not pick.
import { LOCAL_HOSTS } from "./drivers/local-inject.ts";

export function isPiLocalModel(driverKind: string | undefined, model: string | null | undefined): boolean {
  if (driverKind !== "piAgent" || !model) return false;
  const slash = model.indexOf("/");
  if (slash <= 0) return false;
  const provider = model.slice(0, slash);
  return LOCAL_HOSTS.some((host) => host.id === provider);
}
