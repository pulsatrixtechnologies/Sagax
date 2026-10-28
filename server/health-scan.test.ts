import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatHealthReport, scanHealth, writeHealthReport } from "./health-scan.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("health scan", () => {
  it("groups failures, leaves the database unchanged, and omits message text", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-health-"));
    dirs.push(dir);
    const dbPath = join(dir, "runtime.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE assignments (id TEXT PRIMARY KEY, status TEXT NOT NULL, json TEXT NOT NULL)");
    db.prepare("INSERT INTO assignments (id, status, json) VALUES (?, ?, ?)").run("a", "failed", JSON.stringify({ outcome: "stalled", result: "CANARY_SECRET_TEXT" }));
    db.prepare("INSERT INTO assignments (id, status, json) VALUES (?, ?, ?)").run("b", "completed", JSON.stringify({ outcome: "ok", result: "CANARY_SECRET_TEXT" }));
    db.close();
    const before = readFileSync(dbPath);
    mkdirSync(join(dir, "events"));
    writeFileSync(join(dir, "events", "t.ndjson"), `${JSON.stringify({ type: "runtime.error", message: "token sk-secret-value" })}\n${JSON.stringify({ type: "runtime.error", message: "stalled" })}\n`);
    const report = scanHealth(dir, new Date("2026-10-27T12:00:00.000Z"));
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    const text = formatHealthReport(report);
    expect(text).toContain("failed stalled (1)");
    expect(text).toContain("runtime.error (1)");
    expect(text).not.toContain("CANARY_SECRET_TEXT");
    expect(text).not.toContain("sk-secret-value");
    const latest = writeHealthReport(dir, report);
    expect(readFileSync(latest, "utf8")).toBe(text);
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });
});
