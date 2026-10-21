import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  MODEL_IMAGE_MAX_BYTES,
  MODEL_IMAGE_MAX_EDGE,
  boundedSize,
  fitImageForModel,
  fitTurnImagesForModel,
  modelImageCopyPath,
  rasterSize,
} from "./model-image.ts";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** An RGB PNG whose pixels carry some noise, so it does not compress away. */
function noisyPng(width: number, height: number, noiseEvery = 4): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  let seed = 12345;
  for (let y = 0; y < height; y += 1) {
    const at = y * row;
    for (let x = 0; x < width; x += 1) {
      const p = at + 1 + x * 3;
      raw[p] = (x * 255) / width;
      raw[p + 1] = (y * 255) / height;
      if (x % noiseEvery === 0) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        raw[p + 2] = seed >>> 24;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("model image fit", () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads the size of PNG, GIF, JPEG and WebP headers", () => {
    expect(rasterSize(noisyPng(30, 20))).toEqual({ width: 30, height: 20 });
    const gif = Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1");
    expect(rasterSize(gif)).toEqual({ width: 320, height: 240 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x17, 0x70, 0, 0, 0, 0]);
    expect(rasterSize(jpeg)).toEqual({ width: 6000, height: 4000 });
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBPVP8X", 8, "latin1");
    webp.writeUIntLE(1999, 24, 3);
    webp.writeUIntLE(999, 27, 3);
    expect(rasterSize(webp)).toEqual({ width: 2000, height: 1000 });
    expect(rasterSize(Buffer.from("not an image"))).toBeNull();
  });

  it("keeps the aspect ratio and never scales up", () => {
    expect(boundedSize({ width: 6000, height: 4000 }, 1568)).toEqual({ width: 1568, height: 1045 });
    expect(boundedSize({ width: 800, height: 600 }, 1568)).toEqual({ width: 800, height: 600 });
  });

  it("sends a small picture as it is", async () => {
    const png = noisyPng(200, 100);
    const fitted = await fitImageForModel(png, "image/png");
    expect(fitted).toMatchObject({ resized: false, mime: "image/png" });
    expect(fitted!.bytes).toBe(png);
  });

  it("fits a 12 MB 6000 x 4000 picture within the model limits, readable", async () => {
    const big = noisyPng(6000, 4000, 2);
    expect(big.length).toBeGreaterThan(12 * 1024 * 1024);
    const fitted = await fitImageForModel(big, "image/png");
    expect(fitted).not.toBeNull();
    expect(fitted!.resized).toBe(true);
    expect(fitted!.mime).toBe("image/png");
    expect(fitted!.bytes.length).toBeLessThanOrEqual(MODEL_IMAGE_MAX_BYTES);
    // What the engine gets is a real PNG of the scaled size.
    expect(rasterSize(fitted!.bytes)).toEqual(fitted!.size);
    // the picture itself, not an empty frame: a blank 1568 px PNG is a few KB
    expect(fitted!.bytes.length).toBeGreaterThan(200_000);
    expect(Math.max(fitted!.size.width, fitted!.size.height)).toBeLessThanOrEqual(MODEL_IMAGE_MAX_EDGE);
    expect(fitted!.size.width / fitted!.size.height).toBeCloseTo(1.5, 1);
  }, 60_000);

  it("hands the engine a scaled copy and keeps the stored picture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-model-image-"));
    temporary.push(dir);
    const path = join(dir, "123e4567-e89b-42d3-a456-426614174000.png");
    const big = noisyPng(3000, 2000);
    writeFileSync(path, big);
    const [image] = await fitTurnImagesForModel([{ path, mime: "image/png", bytes: big.length }], { attachmentsDir: dir });
    expect(image!.path).toBe(modelImageCopyPath(dir, path));
    expect(image!.path.startsWith(join(dir, ".model"))).toBe(true);
    expect(image!.bytes).toBe(statSync(image!.path).size);
    expect(rasterSize(readFileSync(image!.path))).toEqual({ width: 1568, height: 1045 });
    expect(statSync(path).size).toBe(big.length);
    // a second turn reuses the copy
    const [again] = await fitTurnImagesForModel([{ path, mime: "image/png", bytes: big.length }], { attachmentsDir: dir });
    expect(again).toEqual(image);
  }, 60_000);

  it("keeps a picture it cannot draw as stored instead of failing the turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-model-image-"));
    temporary.push(dir);
    const path = join(dir, "123e4567-e89b-42d3-a456-426614174001.png");
    const big = noisyPng(3000, 2000);
    writeFileSync(path, big);
    const input = { path, mime: "image/png" as const, bytes: big.length };
    const [image] = await fitTurnImagesForModel([input], {
      attachmentsDir: dir,
      render: async () => { throw new Error("no renderer"); },
    });
    expect(image).toEqual(input);
    expect(existsSync(modelImageCopyPath(dir, path))).toBe(false);
  });

  it("puts the copy of a picture in a subfolder beside it", () => {
    expect(modelImageCopyPath("/data/att", "/data/att/.office/up/1.png")).toBe("/data/att/.office/up/1.png.fit.png");
  });
});
