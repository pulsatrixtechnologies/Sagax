// The person's own environments as terminal destinations (2026-10-15, JC):
// their cloud computer (the server environment, "sandbox"), their Local VM
// ("local-vm") and their own computer ("desktop"). Each one has a single id,
// "mine": it always means the environment of the person who lists or opens
// it, never anyone else's, so a card answered by someone else opens THEIR
// environment, under their own rights (server/terminal-resources/registry.ts).
import type { Duplex } from "node:stream";

import type { TerminalProviderKind, TerminalResource, TerminalResourceStatus } from "../../../shared/terminal-resources.ts";
import type { TerminalAttachment, TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";

export const PERSONAL_RESOURCE_ID = "mine";

/** Default labels; the app shows its own translated names for these kinds. */
export const PERSONAL_LABELS: Record<"sandbox" | "local-vm" | "desktop", string> = {
  sandbox: "Ordinateur infonuagique",
  "local-vm": "VM locale",
  desktop: "Cet ordinateur",
};

/** Whether the environment is there for this person and bot, and what to
 * call its host; null when it is not offered. */
export interface PersonalAvailability {
  hostLabel: string;
  status?: TerminalResourceStatus;
  statusNote?: string;
}

export interface PersonalTerminalDeps {
  available(ctx: TerminalListContext): Promise<PersonalAvailability | null>;
  open(ctx: TerminalOpenContext): Promise<TerminalAttachment>;
}

export function createPersonalTerminalAdapter(kind: "sandbox" | "local-vm" | "desktop", deps: PersonalTerminalDeps): TerminalResourceAdapter {
  const row = (found: PersonalAvailability): TerminalResource => ({
    id: PERSONAL_RESOURCE_ID,
    provider: kind as TerminalProviderKind,
    label: PERSONAL_LABELS[kind],
    hostLabel: found.hostLabel,
    status: found.status ?? "unknown",
    ...(found.statusNote ? { statusNote: found.statusNote } : {}),
    scope: "personal",
  });
  return {
    kind: kind as TerminalProviderKind,
    async list(ctx) {
      if (!ctx.principalId) return [];
      const found = await deps.available(ctx);
      return found ? [row(found)] : [];
    },
    async resolve(resourceId, ctx) {
      if (resourceId !== PERSONAL_RESOURCE_ID || !ctx.principalId) return null;
      const found = await deps.available(ctx);
      return found ? row(found) : null;
    },
    async open(resourceId, ctx) {
      if (resourceId !== PERSONAL_RESOURCE_ID || !ctx.principalId) throw new Error("Resource unavailable");
      return deps.open(ctx);
    },
  };
}

/** A duplex terminal stream (provisioner, Kubernetes) as an attachment. */
export function streamTerminalAttachment(terminal: { stream: Duplex; resize(cols: number, rows: number): void }): TerminalAttachment {
  const { stream } = terminal;
  stream.on("error", () => stream.destroy());
  return {
    input: stream,
    output: stream,
    resize: (cols, rows) => terminal.resize(cols, rows),
    close() {
      stream.destroy();
    },
  };
}
