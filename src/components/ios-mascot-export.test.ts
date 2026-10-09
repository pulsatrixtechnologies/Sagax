// The phone draws and decodes the same mascot looks the desktop stores
// (ios/Sources/CompanionCore/MascotLook.swift). This file keeps the two in
// step from the desktop's own sources:
//
// - ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json: every look the
//   desktop can store in `bot.mascotLook` (each character, shape and skin,
//   the editor's saved form with all three skins, the legacy ids) with what
//   `botMascotLook` reads from it, every owl skin with `botMascotSkin`, and
//   every bot color with its value. The Swift decoder is tested against it.
// - ios/Sources/CompanionCore/ShapeStillArt.swift: the Shapes still frames
//   (body outline and cut-out eyes for each mood), from `stillFrame`.
//
// Both are checked here; `UPDATE_IOS_MASCOT=1 pnpm vitest run
// src/components/ios-mascot-export.test.ts` rewrites them after a desktop
// change.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNBU_SKINS,
  LEGACY_BUNBU_SKINS,
  LEGACY_SHAPE_SKINS,
  LEGACY_SHAPES,
  LEGACY_SHIBA_SKINS,
  LEGACY_TROMBI_SKINS,
  MASCOT_CHARACTERS,
  MASCOT_SHAPES,
  SHAPE_SKINS,
  SHIBA_SKINS,
  TROMBI_SKINS,
  botMascotLook,
  completeMascotLook,
} from "../../shared/mascot-look";
import { LEGACY_OWL_SKINS, MASCOT_SKIN_IDS, botMascotSkin } from "../../shared/mascot-skins";
import { MASCOT_COLOR_GROUPS, MASCOT_COLOR_HEX, MASCOT_COLOR_PALETTES } from "../../shared/mascot-colors";
import { expressionForMood, type ShapeMood } from "./ShapeMascot";
import { stillFrame } from "./shape-engine";

const ROOT = join(__dirname, "..", "..");
const FIXTURE = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json");
const SWIFT_ART = join(ROOT, "ios/Sources/CompanionCore/ShapeStillArt.swift");
const UPDATE = process.env.UPDATE_IOS_MASCOT === "1";

type Case = { name: string; input: unknown; expected: unknown };

/** What botMascotLook reads, with an empty skins object left out (the same look). */
function read(input: unknown): unknown {
  const look = botMascotLook(input) as Record<string, unknown>;
  const skins = look.skins as Record<string, unknown> | undefined;
  if (skins && Object.keys(skins).length === 0) {
    const { skins: _drop, ...rest } = look;
    return rest;
  }
  return look;
}

function lookCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, input: unknown) => cases.push({ name, input, expected: read(input) });
  for (const character of MASCOT_CHARACTERS) add(`bare ${character}`, { character });
  add("owl 2d", { character: "owl", style: "2d" });
  add("owl 3d", { character: "owl", style: "3d" });
  for (const shape of MASCOT_SHAPES) {
    for (const skin of SHAPE_SKINS) add(`shape ${shape} ${skin}`, { character: "shape", shape, skins: { shape: skin } });
  }
  for (const skin of TROMBI_SKINS) add(`trombi ${skin}`, { character: "trombi", skins: { trombi: skin } });
  for (const skin of BUNBU_SKINS) add(`bunbu ${skin}`, { character: "bunbu", skins: { bunbu: skin } });
  for (const skin of SHIBA_SKINS) add(`shiba ${skin}`, { character: "shiba", skins: { shiba: skin } });
  // the desktop editor saves every choice made (completeMascotLook), every character's skin at once
  for (const character of MASCOT_CHARACTERS) {
    add(`editor ${character}`, completeMascotLook({ character, shape: "cloud", skins: { shape: "galaxy", trombi: "holo", bunbu: "velvet", shiba: "sesame" } }));
    add(`editor default ${character}`, completeMascotLook({ character }));
  }
  for (const [legacy] of Object.entries(LEGACY_SHAPES)) add(`legacy shape ${legacy}`, { character: "shape", shape: legacy });
  for (const [legacy] of Object.entries(LEGACY_SHAPE_SKINS)) add(`legacy shape skin ${legacy}`, { character: "shape", shape: "circle", skins: { shape: legacy } });
  for (const [legacy] of Object.entries(LEGACY_TROMBI_SKINS)) add(`legacy trombi skin ${legacy}`, { character: "trombi", skins: { trombi: legacy } });
  for (const [legacy] of Object.entries(LEGACY_BUNBU_SKINS)) add(`legacy bunbu skin ${legacy}`, { character: "bunbu", skins: { bunbu: legacy } });
  for (const [legacy] of Object.entries(LEGACY_SHIBA_SKINS)) add(`legacy shiba skin ${legacy}`, { character: "shiba", skins: { shiba: legacy } });
  // a newer build's skin is dropped, never the character
  add("unknown shape skin", { character: "shape", shape: "pill", skins: { shape: "plasma" } });
  add("unknown bunbu skin", { character: "bunbu", skins: { bunbu: "plasma", shape: "gold" } });
  add("unknown shiba skin", { character: "shiba", skins: { shiba: "plasma", bunbu: "gold" } });
  add("unknown skins key", { character: "trombi", skins: { trombi: "gold", dragon: "red" } });
  add("null skins", { character: "bunbu", skins: null });
  add("null skin value", { character: "shape", shape: "drop", skins: { shape: null } });
  // what the desktop itself reads as the owl
  add("unknown character", { character: "dragon" });
  add("unknown top-level key", { character: "shape", color: "red" });
  add("unknown shape", { character: "shape", shape: "star-of-david" });
  add("null shape", { character: "shape", shape: null });
  add("bad style", { character: "owl", style: "4d" });
  add("no character", { shape: "circle" });
  add("not an object", "bunbu");
  return cases;
}

function fixture() {
  const owlSkins = [...MASCOT_SKIN_IDS, ...Object.keys(LEGACY_OWL_SKINS), "plasma", 7, null].map((input) => ({ input, expected: botMascotSkin(input) }));
  return {
    note: "Generated by src/components/ios-mascot-export.test.ts from shared/mascot-look.ts, mascot-skins.ts and mascot-colors.ts. Do not edit.",
    characters: MASCOT_CHARACTERS,
    shapes: MASCOT_SHAPES,
    shapeSkins: SHAPE_SKINS,
    trombiSkins: TROMBI_SKINS,
    bunbuSkins: BUNBU_SKINS,
    shibaSkins: SHIBA_SKINS,
    owlSkins: MASCOT_SKIN_IDS,
    colorGroups: Object.fromEntries(MASCOT_COLOR_GROUPS.map((group) => [group, Object.keys(MASCOT_COLOR_PALETTES[group])])),
    colors: MASCOT_COLOR_HEX,
    looks: lookCases(),
    owlSkinCases: owlSkins,
  };
}

const MOODS: ShapeMood[] = ["idle", "thinking", "working", "happy", "sleeping"];

function swiftArt(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Shapes (`stillFrame` in src/components/shape-engine.ts): each shape's",
    "// resting outline and its two eyes, cut through the body, for each mood",
    "// (`expressionForMood`). Box 0..100. Do not edit; regenerate with",
    "// `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "public enum ShapeStillArt {",
    "    /// Where the clay light sits and how far it spreads (box units).",
  ];
  const sample = stillFrame({ shape: "circle", expression: "neutral", color: "#000000" });
  lines.push(`    public static let light: (x: Double, y: Double, r: Double) = (x: ${sample.light.x}, y: ${sample.light.y}, r: ${sample.light.r})`);
  lines.push("", "    /// The body outline of each shape at rest.", "    public static let body: [MascotShape: String] = [");
  const swiftShape: Record<string, string> = { circle: "circle", bean: "blob", squircle: "squircle", pill: "pill", pick: "triangle", hexagon: "hexagon", cloud: "cloud", drop: "drop" };
  for (const shape of MASCOT_SHAPES) {
    const frame = stillFrame({ shape, expression: "neutral", color: "#000000" });
    lines.push(`        .${swiftShape[shape]}: "${frame.body}",`);
  }
  lines.push("    ]", "", "    /// The eyes (closed subpaths, cut out with the even-odd rule) per shape and mood.", "    public static let eyes: [MascotShape: [ShapeMood: String]] = [");
  for (const shape of MASCOT_SHAPES) {
    lines.push(`        .${swiftShape[shape]}: [`);
    for (const mood of MOODS) {
      const frame = stillFrame({ shape, expression: expressionForMood(mood), color: "#000000" });
      lines.push(`            .${mood}: "${frame.eyes}",`);
    }
    lines.push("        ],");
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

function check(path: string, content: string) {
  if (UPDATE) {
    writeFileSync(path, content);
    return;
  }
  expect(readFileSync(path, "utf8"), `${path} is out of date: run UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`).toBe(content);
}

describe("the phone's copy of the mascot looks", () => {
  it("lists every look the desktop can store, with what the desktop reads", () => {
    check(FIXTURE, `${JSON.stringify(fixture(), null, 2)}\n`);
  });

  it("carries the Shapes still frames the desktop draws", () => {
    check(SWIFT_ART, swiftArt());
  });

  it("covers every known character, shape and skin", () => {
    const looks = lookCases();
    for (const character of MASCOT_CHARACTERS) expect(looks.some((c) => (c.expected as { character: string }).character === character)).toBe(true);
    expect(looks.filter((c) => c.name.startsWith("shape ")).length).toBe(MASCOT_SHAPES.length * SHAPE_SKINS.length);
  });
});
