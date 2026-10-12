// Every HTTP route the server matches, read from the server sources: the
// exact paths (`path === "/api/…"`), the prefixes (`path.startsWith("/api/…")`)
// and the patterns (regex literals `/^\/api\/…/`) that route handlers test a
// request against, each with the method guard written beside it. Sagax routes
// are code, not a registry, so this is the list of what the running server can
// answer. scripts/tool-policy/tool-policy-coverage.test.ts holds every one to a
// policy entry in server/tool-policy.ts. server/request-auth.ts is left out:
// its path rules are the auth gate, not routes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type RouteKind = "exact" | "prefix" | "pattern";
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";
export interface InventoryRoute { kind: RouteKind; route: string; method: RouteMethod; file: string; line: number }

const METHOD = /\bmethod\s*(===|!==)\s*"(GET|POST|PUT|PATCH|DELETE)"/g;
const EXACT = /\bpath(?:name)?\s*===\s*"(\/api\/[^"$]*)"/g;
const PREFIX = /\bpath(?:name)?\.startsWith\("(\/api\/[^"$]*)"\)/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "testing" || name === "node_modules" ? [] : sources(full);
    return /\.(ts|mts)$/.test(name) && name !== "request-auth.ts" && !/\.test\.|\.e2e\./.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

/** Regex literals that start `/^\/api\/` on one line. */
function patterns(line: string): string[] {
  const found: string[] = [];
  let at = line.indexOf("/^\\/api\\/");
  while (at >= 0) {
    let i = at + 1, cls = false;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === "\\") { i++; continue; }
      if (c === "[") cls = true; else if (c === "]") cls = false; else if (c === "/" && !cls) break;
    }
    if (i < line.length) found.push(line.slice(at + 1, i));
    at = line.indexOf("/^\\/api\\/", i + 1);
  }
  return found;
}

function methodsNear(lines: string[], i: number): RouteMethod[] {
  const on = (text: string) => [...text.matchAll(METHOD)].filter((m) => m[1] === "===").map((m) => m[2] as RouteMethod);
  const same = on(lines[i]!);
  if (same.length) return same;
  for (const j of [i - 1, i - 2, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6]) {
    if (j < 0 || j >= lines.length) continue;
    const near = on(lines[j]!);
    if (near.length) return near;
  }
  return ["ANY"];
}

export function routeInventory(root: string): InventoryRoute[] {
  const seen = new Map<string, InventoryRoute>();
  for (const full of sources(join(root, "server"))) {
    const file = relative(root, full).split("\\").join("/");
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (/^\s*(\/\/|\*)/.test(text)) return;
      const hits: Array<[RouteKind, string]> = [
        ...[...text.matchAll(EXACT)].map((m) => ["exact", m[1]!] as [RouteKind, string]),
        ...[...text.matchAll(PREFIX)].map((m) => ["prefix", m[1]!] as [RouteKind, string]),
        ...patterns(text).map((p) => ["pattern", p] as [RouteKind, string]),
      ];
      // `path.startsWith("/api/")` is the API gate itself, not a route
      const routes = hits.filter(([kind, route]) => !(kind === "prefix" && route === "/api/"));
      if (!routes.length) return;
      const methods = methodsNear(lines, i);
      for (const [kind, route] of routes) for (const method of methods) {
        const key = `${method} ${kind} ${route}`;
        if (!seen.has(key)) seen.set(key, { kind, route, method, file, line: i + 1 });
      }
    });
  }
  return [...seen.values()].sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method) || a.kind.localeCompare(b.kind));
}
