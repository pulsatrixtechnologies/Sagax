// The remote-control audit trail: one JSONL line per control action (start,
// grant, release with activity counts, stop). It never records the keys or
// text injected, only that control was held and how much happened (Loi 25
// minimisation). The audit never stops a session from closing.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ControlAuditEvent } from "./remote-control-session.ts";

export function createRemoteControlAudit(dataDir: string) {
  const path = join(dataDir, "remote-control.jsonl");
  mkdirSync(dataDir, { recursive: true });
  return {
    path,
    write(event: ControlAuditEvent) {
      try { appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 }); } catch { /* disk full, read-only */ }
    },
  };
}
