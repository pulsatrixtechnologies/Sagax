import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Duplex } from "node:stream";

import type { RequestAuth } from "../request-auth.ts";
import type { TerminalProviderKind, TerminalResource } from "../../shared/terminal-resources.ts";

export interface TerminalListContext {
  auth: RequestAuth;
  principalId: string;
  botId?: string;
  threadId?: string;
}

export interface TerminalOpenContext extends TerminalListContext {
  sessionId: string;
}

/** Server-side attachment: a byte stream with resize and teardown. */
export interface TerminalAttachment {
  input: Duplex;
  output: Duplex;
  resize(cols: number, rows: number): void;
  close(): void;
  /** Optional underlying process for audit. */
  proc?: ChildProcessWithoutNullStreams;
}

export interface TerminalResourceAdapter {
  kind: TerminalProviderKind;
  list(ctx: TerminalListContext): Promise<TerminalResource[]>;
  /** Returns null when the resource is unknown or unreachable. */
  resolve(resourceId: string, ctx: TerminalListContext): Promise<TerminalResource | null>;
  open(resourceId: string, ctx: TerminalOpenContext): Promise<TerminalAttachment>;
}
