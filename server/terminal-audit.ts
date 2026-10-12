import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type TerminalAuditEvent =
  | { at: number; kind: "session.requested"; principalId: string; botId: string; threadId: string; resourceId: string; provider: string; requestId: string }
  | { at: number; kind: "session.opened"; principalId: string; sessionId: string; resourceId: string; provider: string }
  | { at: number; kind: "session.denied"; principalId: string; requestId: string }
  | { at: number; kind: "session.ended"; principalId: string; sessionId: string; reason: string }
  | { at: number; kind: "session.idle"; principalId: string; sessionId: string }
  | { at: number; kind: "bot.input"; principalId: string; sessionId: string; allowed: boolean };

export function createTerminalAuditLog(dataDir: string) {
  const path = join(dataDir, "terminal-sessions.jsonl");
  mkdirSync(dataDir, { recursive: true });
  return {
    write(event: TerminalAuditEvent) {
      appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    },
  };
}
