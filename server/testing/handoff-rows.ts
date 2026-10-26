// Coordinated turns as tests read them: the Assignment rows in a data
// directory's runtime.db, projected onto the HandoffView shape the server
// itself works with. Read-only, so a test can look while the server runs.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { HandoffView } from "../coordinator.ts";
import { view } from "../runtime-coordinator.ts";
import type { Assignment } from "../runtime/types.ts";

export function readHandoffs(dataDir: string): HandoffView[] {
  const file = join(dataDir, "runtime.db");
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("SELECT json FROM assignments ORDER BY created_at, rowid").all() as Array<{ json: string }>;
    const all = rows.map((row) => JSON.parse(row.json) as Assignment);
    const byId = new Map(all.map((a) => [a.id, a]));
    return all.map((a) => view(a, a.parentId ? byId.get(a.parentId) : undefined));
  } finally {
    db.close();
  }
}

/** The runtime's typed outcome of one ended row (an Assignment's `outcome`;
 * HandoffView does not carry it), or undefined. */
export function handoffOutcome(dataDir: string, id: string): Assignment["outcome"] {
  const file = join(dataDir, "runtime.db");
  if (!existsSync(file)) return undefined;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT json FROM assignments WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Assignment).outcome : undefined;
  } finally {
    db.close();
  }
}
