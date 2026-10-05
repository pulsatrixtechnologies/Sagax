// Picking ports for a suite that boots real servers.
//
// A random port in a wide range is fine until two suites run at once — the
// second one loses a bind it never checked, and the failure surfaces as
// whatever the server does when it cannot listen, which is rarely "port
// taken". Probing first turns that into a port nobody else holds.
import { mkdirSync, openSync, closeSync, statSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Bind a port, then let it go. False when something already has it. */
const isFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

/**
 * Find a base port where every `base + offset` is free.
 *
 * Offsets rather than a count because the ports a suite needs are rarely
 * contiguous: the harness quietly opens a webhook receiver one above itself,
 * and a sidecar sits well clear of both. Asking for the exact set is the only
 * way to know the whole layout is clear.
 *
 * The probe releases the ports before they are returned, so two suites that
 * probe the same port at once could both see it free and both get it. Every
 * port handed out is therefore also claimed with a marker file shared by all
 * vitest processes on this machine (other shards, other checkouts); a marker
 * younger than CLAIM_TTL_MS keeps the port out of every other pick. A third
 * party outside these suites can still take a port in the gap.
 */
export async function freePortBlock(offsets: number[], from = 19_600, span = 3_000): Promise<number> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const base = from + Math.floor(Math.random() * span);
    const checks = await Promise.all(offsets.map((offset) => isFree(base + offset)));
    if (checks.every(Boolean) && claim(offsets.map((offset) => base + offset))) return base;
  }
  throw new Error(`no free port block for offsets ${offsets.join(",")} in ${from}..${from + span}`);
}

const CLAIMS = join(tmpdir(), "sagax-test-ports");
// longer than any suite keeps a server up; a stale claim only narrows the pool
const CLAIM_TTL_MS = 15 * 60_000;

/** Claim every port or none: O_EXCL marker files, one per port. */
function claim(ports: number[]): boolean {
  mkdirSync(CLAIMS, { recursive: true });
  const taken: string[] = [];
  for (const port of ports) {
    const marker = join(CLAIMS, String(port));
    if (claimOne(marker)) { taken.push(marker); continue; }
    for (const held of taken) rmSync(held, { force: true });
    return false;
  }
  return true;
}

function claimOne(marker: string): boolean {
  try {
    closeSync(openSync(marker, "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(marker).mtimeMs < CLAIM_TTL_MS) return false;
      rmSync(marker, { force: true });
      closeSync(openSync(marker, "wx"));
      return true;
    } catch {
      return false;
    }
  }
}
