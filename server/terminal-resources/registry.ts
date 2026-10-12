import type { TerminalResource, TerminalProviderKind } from "../../shared/terminal-resources.ts";
import type { TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "./types.ts";

export class TerminalResourceRegistry {
  private readonly adapters = new Map<TerminalProviderKind, TerminalResourceAdapter>();

  register(adapter: TerminalResourceAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  adapter(kind: TerminalProviderKind): TerminalResourceAdapter | undefined {
    return this.adapters.get(kind);
  }

  async listAll(ctx: TerminalListContext): Promise<TerminalResource[]> {
    const out: TerminalResource[] = [];
    for (const adapter of this.adapters.values()) {
      const rows = await adapter.list(ctx);
      out.push(...rows);
    }
    return out;
  }

  async resolve(key: { provider: TerminalProviderKind; id: string }, ctx: TerminalListContext) {
    const adapter = this.adapters.get(key.provider);
    if (!adapter) return null;
    return adapter.resolve(key.id, ctx);
  }

  async open(key: { provider: TerminalProviderKind; id: string }, ctx: TerminalOpenContext) {
    const adapter = this.adapters.get(key.provider);
    if (!adapter) throw new Error("Unknown provider");
    return adapter.open(key.id, ctx);
  }
}
