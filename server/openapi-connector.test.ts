import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildOpenApiRequest, OpenApiStore, openApiScope, openApiUrlRefusal } from "./openapi-connector.ts";
import { parseOpenApiSpec } from "./openapi-tools.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SPEC = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Notes" },
  servers: [{ url: "https://api.example/v1" }],
  paths: {
    "/notes/{id}": {
      get: {
        operationId: "getNote",
        summary: "Read one note",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "verbose", in: "query", schema: { type: "boolean" } },
        ],
      },
    },
  },
});

describe("OpenAPI connector", () => {
  it("keeps one person's document, headers included, off another person's file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-openapi-"));
    dirs.push(dir);
    const saved = new OpenApiStore(dir);
    const ada = openApiScope(true, "pr_ada");
    const bob = openApiScope(true, "pr_bob");
    expect(ada && bob).toBeTruthy();
    if (!ada || !bob) return;
    const view = saved.save(ada, SPEC, { Authorization: "Bearer secret-value" });
    expect(typeof view).not.toBe("string");
    if (typeof view === "string") return;
    expect(view.headerKeys).toEqual(["Authorization"]);
    expect(view.operations.map((operation) => operation.name)).toEqual(["getnote"]);
    expect(JSON.stringify(view)).not.toContain("secret-value");
    expect(readFileSync(join(dir, "principals", "pr_ada", "openapi.json"), "utf8")).toContain("secret-value");
    expect(saved.view(bob).operations).toEqual([]);
  });

  it("builds the call without putting the header in the path", () => {
    const parsed = parseOpenApiSpec(SPEC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const request = buildOpenApiRequest({
      operation: parsed.operations[0]!,
      baseUrl: parsed.baseUrl,
      headers: { Authorization: "Bearer secret-value" },
      args: { id: "n 1", verbose: true },
    });
    expect(typeof request).not.toBe("string");
    if (typeof request === "string") return;
    expect(request.url).toBe("https://api.example/v1/notes/n%201?verbose=true");
    expect(request.headers.Authorization).toBe("Bearer secret-value");
    expect(request.url).not.toContain("secret-value");
  });

  it("refuses a private address on an organization server and allows it solo", () => {
    expect(openApiUrlRefusal("https://api.example/v1", ["1.1.1.1"], true)).toBeNull();
    expect(openApiUrlRefusal("http://127.0.0.1/v1", ["127.0.0.1"], true)).toMatch(/public internet/);
    expect(openApiUrlRefusal("http://127.0.0.1/v1", ["127.0.0.1"], false)).toBeNull();
    expect(openApiUrlRefusal("https://user:pw@api.example/", ["1.1.1.1"], false)).toMatch(/password/);
  });
});
