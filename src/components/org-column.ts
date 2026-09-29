import { ApiError, api } from "@/state/store";

type Listener = () => void;

const listeners = new Set<Listener>();
let org: { name: string } | null = null;
let generation = 0;

export function orgColumnSnapshot(): { name: string } | null {
  return org;
}

export function subscribeOrgColumn(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/** GET /api/org. A newer create wins over an older 404. */
export async function refreshOrgColumn(): Promise<void> {
  const token = ++generation;
  try {
    const body = await api<{ org?: { name?: string } }>("/api/org");
    if (token !== generation) return;
    const name = body.org?.name;
    if (typeof name === "string") org = { name };
  } catch (error) {
    if (token !== generation) return;
    if (error instanceof ApiError && error.status === 404) org = null;
  }
  if (token === generation) emit();
}

/** Settings created the organization. A mounted sidebar switches columns. */
export function notifyOrgColumn(name: string) {
  generation += 1;
  org = { name };
  emit();
}
