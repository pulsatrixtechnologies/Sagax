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
  GRUMP_SKINS,
  LEGACY_BUNBU_SKINS,
  LEGACY_GRUMP_SKINS,
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
import { GRUMP_BUST, GRUMP_EXPRESSIONS, GRUMP_ROLES, grumpParts, type GrumpOp } from "./grump-art";
import { grumpFlatPalette } from "./skin-fx/grump-skins";
import { GRUMP_SKINS as GRUMP_SKIN_IDS } from "../../shared/mascot-look";

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
  for (const skin of GRUMP_SKINS) add(`grump ${skin}`, { character: "grump", skins: { grump: skin } });
  // the desktop editor saves every choice made (completeMascotLook), every character's skin at once
  for (const character of MASCOT_CHARACTERS) {
    add(`editor ${character}`, completeMascotLook({ character, shape: "cloud", skins: { shape: "galaxy", trombi: "holo", bunbu: "velvet", shiba: "sesame", grump: "calico" } }));
    add(`editor default ${character}`, completeMascotLook({ character }));
  }
  for (const [legacy] of Object.entries(LEGACY_SHAPES)) add(`legacy shape ${legacy}`, { character: "shape", shape: legacy });
  for (const [legacy] of Object.entries(LEGACY_SHAPE_SKINS)) add(`legacy shape skin ${legacy}`, { character: "shape", shape: "circle", skins: { shape: legacy } });
  for (const [legacy] of Object.entries(LEGACY_TROMBI_SKINS)) add(`legacy trombi skin ${legacy}`, { character: "trombi", skins: { trombi: legacy } });
  for (const [legacy] of Object.entries(LEGACY_BUNBU_SKINS)) add(`legacy bunbu skin ${legacy}`, { character: "bunbu", skins: { bunbu: legacy } });
  for (const [legacy] of Object.entries(LEGACY_SHIBA_SKINS)) add(`legacy shiba skin ${legacy}`, { character: "shiba", skins: { shiba: legacy } });
  for (const [legacy] of Object.entries(LEGACY_GRUMP_SKINS)) add(`legacy grump skin ${legacy}`, { character: "grump", skins: { grump: legacy } });
  // a newer build's skin is dropped, never the character
  add("unknown shape skin", { character: "shape", shape: "pill", skins: { shape: "plasma" } });
  add("unknown bunbu skin", { character: "bunbu", skins: { bunbu: "plasma", shape: "gold" } });
  add("unknown shiba skin", { character: "shiba", skins: { shiba: "plasma", bunbu: "gold" } });
  add("unknown grump skin", { character: "grump", skins: { grump: "plasma", shiba: "gold" } });
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
    grumpSkins: GRUMP_SKINS,
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

/* -------------------------------------------------------------- Grump */

const GRUMP_SWIFT = join(ROOT, "ios/Sources/CompanionCore/GrumpStillArt.swift");
const GRUMP_PALETTE_FIXTURE = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/grump-palettes.json");
/** The skins whose palette follows the bot color: the phone computes them (GrumpArt.swift), checked against this fixture. */
const GRUMP_HEX_SKINS = ["plain", "void", "neon", "retro98"] as const;

const swiftString = (value: string) => JSON.stringify(value);
const swiftOp = (op: GrumpOp) =>
  `.init(d: ${swiftString(op.d)}, fill: ${op.fill ? `.${op.fill}` : "nil"}, stroke: ${op.stroke ? `.${op.stroke}` : "nil"}, width: ${op.width ?? 0}, opacity: ${op.opacity ?? 1}, clip: ${op.clip ? swiftString(op.clip) : "nil"}, round: ${op.round ? "true" : "false"})`;

function grumpSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Grump (`grumpParts` in src/components/grump-art.ts, the palettes of",
    "// skin-fx/grump-skins.tsx flattened): the sitting drawing as paint",
    "// operations with paint roles, the whole box (`full`) and the bust under",
    "// 48 pt (`bust`), each of the sixteen faces, and the palette of every skin",
    "// that does not follow the bot color. Box 0..100. Do not edit; regenerate",
    "// with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "/// What a part is painted with; a skin maps each role to a color.",
    `public enum GrumpRole: String, CaseIterable, Sendable {`,
    `    case ${GRUMP_ROLES.join(", ")}`,
    "}",
    "",
    "/// One drawing operation: a path filled and/or stroked with roles, maybe clipped to another path.",
    "public struct GrumpStillOp: Sendable {",
    "    public let d: String",
    "    public let fill: GrumpRole?",
    "    public let stroke: GrumpRole?",
    "    public let width: Double",
    "    public let opacity: Double",
    "    public let clip: String?",
    "    public let round: Bool",
    "}",
    "",
    "/// The sitting Grump at one scale: what lies under the face, each face, what lies over it.",
    "public struct GrumpStillLayers: Sendable {",
    "    /// The body, the tail, the ears and the head.",
    "    public let under: [GrumpStillOp]",
    "    /// Per expression: the brows, the eyes, the nose, the mouth and the extras.",
    "    public let faces: [String: [GrumpStillOp]]",
    "    /// The folded paws.",
    "    public let over: [GrumpStillOp]",
    "}",
    "",
    "public enum GrumpStillArt {",
    `    /// The sixteen faces, the Shapes ids.`,
    `    public static let expressions: [String] = [${GRUMP_EXPRESSIONS.map(swiftString).join(", ")}]`,
    `    /// The bust crop under 48 pt (x, y, width, height).`,
    `    public static let bustCrop: (x: Double, y: Double, w: Double, h: Double) = (x: ${GRUMP_BUST.x}, y: ${GRUMP_BUST.y}, w: ${GRUMP_BUST.w}, h: ${GRUMP_BUST.h})`,
  ];
  for (const [name, size] of [["full", 120], ["bust", 32]] as const) {
    const base = grumpParts({ expression: "neutral", size });
    lines.push("", `    public static let ${name} = GrumpStillLayers(`, "        under: [");
    for (const op of [...base.body, ...base.tail, ...base.earL, ...base.earR, ...base.head]) lines.push(`            ${swiftOp(op)},`);
    lines.push("        ],", "        faces: [");
    for (const expression of GRUMP_EXPRESSIONS) {
      const parts = grumpParts({ expression, size });
      lines.push(`            ${swiftString(expression)}: [`);
      for (const op of [...parts.brows, ...parts.eyeL, ...parts.eyeR, ...parts.nose, ...parts.mouth, ...parts.extras]) lines.push(`                ${swiftOp(op)},`);
      lines.push("            ],");
    }
    lines.push("        ],", "        over: [");
    for (const op of base.paws) lines.push(`            ${swiftOp(op)},`);
    lines.push("        ]", "    )");
  }
  lines.push("", "    /// The skins with a palette of their own (the bot color does not change them), flattened.", "    public static let skinPalettes: [String: [GrumpRole: String]] = [");
  for (const skin of GRUMP_SKIN_IDS) {
    if ((GRUMP_HEX_SKINS as readonly string[]).includes(skin)) continue;
    const palette = grumpFlatPalette(skin, "#808080");
    lines.push(`        ${swiftString(skin)}: [${GRUMP_ROLES.map((role) => `.${role}: ${swiftString(palette[role])}`).join(", ")}],`);
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

function grumpPaletteFixture() {
  return {
    note: "Generated by src/components/ios-mascot-export.test.ts from skin-fx/grump-skins.tsx (grumpFlatPalette). Do not edit.",
    skins: GRUMP_HEX_SKINS,
    colors: Object.fromEntries(Object.entries(MASCOT_COLOR_HEX).map(([name, hex]) => [name, Object.fromEntries(GRUMP_HEX_SKINS.map((skin) => [skin, grumpFlatPalette(skin, hex)]))])),
  };
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

  it("carries Grump's still drawing, its sixteen faces and its skins' palettes", () => {
    check(GRUMP_SWIFT, grumpSwift());
    check(GRUMP_PALETTE_FIXTURE, `${JSON.stringify(grumpPaletteFixture(), null, 2)}\n`);
  });

  it("covers every known character, shape and skin", () => {
    const looks = lookCases();
    for (const character of MASCOT_CHARACTERS) expect(looks.some((c) => (c.expected as { character: string }).character === character)).toBe(true);
    expect(looks.filter((c) => c.name.startsWith("shape ")).length).toBe(MASCOT_SHAPES.length * SHAPE_SKINS.length);
  });
});
