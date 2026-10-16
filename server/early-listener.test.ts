import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startEarlyListener, type EarlyListener } from "./early-listener.ts";
import { freePortBlock } from "./testing/ports.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function uiFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "early-listener-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Sagax</title>");
  writeFileSync(join(dir, "assets", "index-abc.js"), "export {};");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function listener(port: number): Promise<EarlyListener> {
  const early = await startEarlyListener({ port, staticDir: uiFolder() });
  expect(early).not.toBeNull();
  cleanups.push(() => early!.server.close());
  return early!;
}

it("answers the page and its assets before the server is ready", async () => {
  const port = await freePortBlock([0]);
  await listener(port);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toBe("text/html");
  expect(page.headers.get("cache-control")).toBe("no-cache");
  expect(page.headers.get("x-frame-options")).toBe("DENY");
  const asset = await fetch(`http://127.0.0.1:${port}/assets/index-abc.js`);
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
});

it("holds every other request, in order, until the server takes over", async () => {
  const port = await freePortBlock([0]);
  const early = await listener(port);
  const seen: string[] = [];
  const api = fetch(`http://127.0.0.1:${port}/api/bots`).then((r) => r.text());
  // a file the folder does not hold is the server's (its fallback, a 404)
  const missing = fetch(`http://127.0.0.1:${port}/assets/gone.js`).then((r) => r.text());
  // another Host than the window's is the server's to judge
  const other = new Promise<string>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/", headers: { host: "example.com" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.end();
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(seen).toEqual([]);
  early.adopt((req, res) => { seen.push(req.url ?? ""); res.end(`server ${req.url}`); });
  expect(await api).toBe("server /api/bots");
  expect(await missing).toBe("server /assets/gone.js");
  expect(await other).toBe("server /");
  expect(seen).toEqual(["/api/bots", "/assets/gone.js", "/"]);
  // and everything after
  expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())).toBe("server /");
});

it("steps aside when the port is taken", async () => {
  const port = await freePortBlock([0]);
  const taken = createServer();
  await new Promise<void>((resolve) => taken.listen(port, "127.0.0.1", resolve));
  cleanups.push(() => taken.close());
  expect(await startEarlyListener({ port, staticDir: uiFolder() })).toBeNull();
});
