import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { BODY_YIELD_BYTES, estimateJsonBytes, readBody, safeParseYielding } from "./http.ts";

/** A request body that arrives in exactly these chunks. */
const request = (chunks: Buffer[]) => Readable.from(chunks) as unknown as IncomingMessage;

/** Split a UTF-8 buffer inside the first multi-byte character after `from`. */
function splitInsideCharacter(bytes: Buffer, from: number): [Buffer, Buffer] {
  let cut = from;
  while ((bytes[cut]! & 0xc0) !== 0x80) cut += 1;
  return [bytes.subarray(0, cut), bytes.subarray(cut)];
}

describe("readBody", () => {
  it("keeps a character whole when a chunk boundary splits it", async () => {
    const text = "مرحبا بالعالم 中文 😀 ".repeat(50);
    const bytes = Buffer.from(JSON.stringify({ text }));
    const body = await readBody(request(splitInsideCharacter(bytes, 100)));
    expect(body.text).toBe(text);
  });

  it("keeps every character whole across many small chunks", async () => {
    const text = "مرحبا 中文 😀".repeat(20);
    const bytes = Buffer.from(JSON.stringify({ text }));
    const chunks: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 7) chunks.push(bytes.subarray(at, at + 7));
    const body = await readBody(request(chunks));
    expect(body.text).toBe(text);
  });

  it("still refuses a body over the limit", async () => {
    const bytes = Buffer.from(JSON.stringify({ text: "中".repeat(100) }));
    await expect(readBody(request(splitInsideCharacter(bytes, 10)), 64)).rejects.toMatchObject({ status: 413 });
  });

  it("yields before JSON.parse when the body is large (#1750)", async () => {
    const text = "x".repeat(BODY_YIELD_BYTES);
    const bytes = Buffer.from(JSON.stringify({ text }));
    const immediates: number[] = [];
    const realImmediate = setImmediate;
    const spy = vi.spyOn(globalThis, "setImmediate").mockImplementation(((fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      immediates.push(1);
      return realImmediate(fn, ...args);
    }) as typeof setImmediate);
    try {
      const body = await readBody(request([bytes]));
      expect(body.text).toBe(text);
      expect(immediates.length).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("safeParseYielding", () => {
  it("parses small bodies without forcing a yield", async () => {
    const schema = z.object({ name: z.string() });
    const spy = vi.spyOn(globalThis, "setImmediate");
    const parsed = await safeParseYielding(schema, { name: "ada" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("ada");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("yields before zod when the value is large (#1750)", async () => {
    const schema = z.object({ text: z.string() });
    const value = { text: "y".repeat(BODY_YIELD_BYTES) };
    expect(estimateJsonBytes(value)).toBeGreaterThanOrEqual(BODY_YIELD_BYTES);
    const immediates: number[] = [];
    const realImmediate = setImmediate;
    const spy = vi.spyOn(globalThis, "setImmediate").mockImplementation(((fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      immediates.push(1);
      return realImmediate(fn, ...args);
    }) as typeof setImmediate);
    try {
      const parsed = await safeParseYielding(schema, value);
      expect(parsed.success).toBe(true);
      expect(immediates.length).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});
