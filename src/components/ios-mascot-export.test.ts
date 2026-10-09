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
// - ios/Sources/CompanionCore/OgreStillArt.swift: Ogre's still drawing (the
//   approved head and shoulders, `ogreParts` in ogre-art.ts) as draw
//   operations, every face, the skins' fixed colors and palette samples.
//
// They are all checked here; `UPDATE_IOS_MASCOT=1 pnpm vitest run
// src/components/ios-mascot-export.test.ts` rewrites them after a desktop
// change.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNBU_SKINS,
  LEGACY_BUNBU_SKINS,
  LEGACY_OGRE_SKINS,
  LEGACY_SHAPE_SKINS,
  LEGACY_SHAPES,
  LEGACY_SHIBA_SKINS,
  LEGACY_TROMBI_SKINS,
  MASCOT_CHARACTERS,
  MASCOT_SHAPES,
  OGRE_SKINS,
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
import { OGRE_EXPRESSIONS, ogreOutline, ogrePalette, ogreParts, type OgreOp, type OgreParts } from "./ogre-art";
import { ogreSkinPaint } from "./skin-fx/ogre-skins";

const ROOT = join(__dirname, "..", "..");
const FIXTURE = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json");
const SWIFT_ART = join(ROOT, "ios/Sources/CompanionCore/ShapeStillArt.swift");
const OGRE_ART_SWIFT = join(ROOT, "ios/Sources/CompanionCore/OgreStillArt.swift");
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
  for (const skin of OGRE_SKINS) add(`ogre ${skin}`, { character: "ogre", skins: { ogre: skin } });
  // the desktop editor saves every choice made (completeMascotLook), every character's skin at once
  for (const character of MASCOT_CHARACTERS) {
    add(`editor ${character}`, completeMascotLook({ character, shape: "cloud", skins: { shape: "galaxy", trombi: "holo", bunbu: "velvet", shiba: "sesame", ogre: "lava" } }));
    add(`editor default ${character}`, completeMascotLook({ character }));
  }
  for (const [legacy] of Object.entries(LEGACY_SHAPES)) add(`legacy shape ${legacy}`, { character: "shape", shape: legacy });
  for (const [legacy] of Object.entries(LEGACY_SHAPE_SKINS)) add(`legacy shape skin ${legacy}`, { character: "shape", shape: "circle", skins: { shape: legacy } });
  for (const [legacy] of Object.entries(LEGACY_TROMBI_SKINS)) add(`legacy trombi skin ${legacy}`, { character: "trombi", skins: { trombi: legacy } });
  for (const [legacy] of Object.entries(LEGACY_BUNBU_SKINS)) add(`legacy bunbu skin ${legacy}`, { character: "bunbu", skins: { bunbu: legacy } });
  for (const [legacy] of Object.entries(LEGACY_SHIBA_SKINS)) add(`legacy shiba skin ${legacy}`, { character: "shiba", skins: { shiba: legacy } });
  for (const [legacy] of Object.entries(LEGACY_OGRE_SKINS)) add(`legacy ogre skin ${legacy}`, { character: "ogre", skins: { ogre: legacy } });
  // a newer build's skin is dropped, never the character
  add("unknown shape skin", { character: "shape", shape: "pill", skins: { shape: "plasma" } });
  add("unknown bunbu skin", { character: "bunbu", skins: { bunbu: "plasma", shape: "gold" } });
  add("unknown shiba skin", { character: "shiba", skins: { shiba: "plasma", bunbu: "gold" } });
  add("unknown ogre skin", { character: "ogre", skins: { ogre: "plasma", shiba: "red" } });
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
    ogreSkins: OGRE_SKINS,
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


/* ------------------------------------------------------------- Ogre */

/** Two sizes on either side of the bust: their outlines give each width as a + b * outline. */
const OGRE_FULL = 80;
const OGRE_BUST = 40;

function swiftOps(full: readonly OgreOp[], bust: readonly OgreOp[], indent: string): string {
  const k = ogreOutline(OGRE_BUST) - ogreOutline(OGRE_FULL);
  const ops = full.map((op, i) => {
    const other = bust[i]!;
    expect(other.d).toBe(op.d);
    const fields = [`d: "${op.d}"`];
    if (op.fill) fields.push(`fill: "${op.fill}"`);
    if (op.stroke) {
      const w = op.width ?? 1;
      const slope = Math.round((((other.width ?? 1) - w) / k) * 1e4) / 1e4;
      const base = Math.round((w - slope * ogreOutline(OGRE_FULL)) * 1e4) / 1e4;
      fields.push(`stroke: "${op.stroke}"`, `width: (${base}, ${slope})`);
    }
    if (op.opacity !== undefined) fields.push(`opacity: ${op.opacity}`);
    if (op.clip) fields.push(`clip: "${op.clip}"`);
    if (op.round) fields.push("round: true");
    return `${indent}Op(${fields.join(", ")}),`;
  });
  return ops.join("\n");
}

function swiftOgre(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Ogre (`ogreParts` in src/components/ogre-art.ts, the approved head and",
    "// shoulders at rest): each part as draw operations with paint roles, every",
    "// face, the skins' fixed colors (`ogreSkinPaint`, a gradient as its solid",
    "// base) and palette samples for the tests. Box 0..100; a stroke's width is",
    "// a + b * outline. Do not edit; regenerate with",
    "// `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "",
    "public enum OgreStillArt {",
    "    /// One drawing operation: a path filled and/or stroked with paint roles, maybe clipped.",
    "    public struct Op: Sendable {",
    "        public let d: String",
    "        public var fill: String? = nil",
    "        public var stroke: String? = nil",
    "        public var width: (Double, Double) = (1, 0)",
    "        public var opacity: Double? = nil",
    "        public var clip: String? = nil",
    "        public var round = false",
    "    }",
    "",
    "    /// A face: the layers every expression swaps, and what it adds (in a bust, without the z).",
    "    public struct Face: Sendable {",
    "        public let brows: [Op]",
    "        public let eyeL: [Op]",
    "        public let eyeR: [Op]",
    "        public let mouth: [Op]",
    "        public let extras: [Op]",
    "        public let bustExtras: [Op]",
    "    }",
    "",
  ];
  const at = (expression: (typeof OGRE_EXPRESSIONS)[number], size: number, marks: "cracks" | "rivets" | null = null): OgreParts => ogreParts({ expression, size, marks });
  lines.push("    /// The parts that never change with the face, plain and with each skin's marks: body, earL, earR, head, nose.", "    public static let parts: [String: [String: [Op]]] = [");
  for (const marks of [null, "cracks", "rivets"] as const) {
    const full = at("neutral", OGRE_FULL, marks);
    const bust = at("neutral", OGRE_BUST, marks);
    lines.push(`        "${marks ?? "plain"}": [`);
    for (const key of ["body", "earL", "earR", "head", "nose"] as const) lines.push(`            "${key}": [`, swiftOps(full[key], bust[key], "                "), "            ],");
    lines.push("        ],");
  }
  lines.push("    ]", "", "    /// The sixteen faces (the Shapes' ids).", "    public static let faces: [String: Face] = [");
  for (const expression of OGRE_EXPRESSIONS) {
    const full = at(expression, OGRE_FULL);
    const bust = at(expression, OGRE_BUST);
    lines.push(`        "${expression}": Face(`);
    for (const key of ["brows", "eyeL", "eyeR", "mouth"] as const) lines.push(`            ${key}: [`, swiftOps(full[key], bust[key], "                "), "            ],");
    // the z is left out of a bust: its extras are their own list
    lines.push("            extras: [", swiftOps(full.extras, full.extras, "                "), "            ],");
    lines.push("            bustExtras: [", swiftOps(bust.extras, bust.extras, "                "), "            ]");
    lines.push("        ),");
  }
  lines.push("    ]", "");
  // each skin's colors that do not depend on the bot color (a gradient drawn as its solid base)
  const SOLID: Record<string, string> = { crack: "#FF8A1F", plate: "#A9B4BF", dither: "#008000", ditherVest: "#000000", gold: "#D9A333", chrome: "#8C98A6", pearl: "#E3E9FF", rock: "#2A120C" };
  const solid = (paint: string) => {
    const name = /^url\(#u-([a-zA-Z]+)\)$/.exec(paint)?.[1];
    return name ? SOLID[name]! : paint.toUpperCase();
  };
  lines.push("    /// Each skin's own colors (the roles it paints whatever the bot color), over the plain palette; and its marks.", "    public static let skins: [String: (colors: [String: String], marks: String?)] = [");
  for (const skin of OGRE_SKINS) {
    const a = ogreSkinPaint(skin, "#377FE6", "u");
    const b = ogreSkinPaint(skin, "#D94B52", "u");
    const fixed = Object.keys(a.palette)
      .filter((role) => a.palette[role as keyof typeof a.palette] === b.palette[role as keyof typeof b.palette] && skin !== "plain")
      .map((role) => `"${role}": "${solid(a.palette[role as keyof typeof a.palette])}"`);
    lines.push(`        "${skin}": (colors: [${fixed.length ? fixed.join(", ") : ":"}], marks: ${a.marks ? `"${a.marks}"` : "nil"}),`);
  }
  lines.push("    ]", "", "    /// The plain palette the desktop paints for each bot color (the phone computes it; the tests compare).", "    public static let paletteSamples: [String: (skin: String, vest: String, line: String, tunicShade: String)] = [");
  for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
    const p = ogrePalette(hex);
    lines.push(`        "${name}": (skin: "${p.skin.toUpperCase()}", vest: "${p.vest.toUpperCase()}", line: "${p.line.toUpperCase()}", tunicShade: "${p.tunicShade.toUpperCase()}"),`);
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

  it("carries Ogre's still drawing, its faces and its skins' colors", () => {
    check(OGRE_ART_SWIFT, swiftOgre());
  });

  it("covers every known character, shape and skin", () => {
    const looks = lookCases();
    for (const character of MASCOT_CHARACTERS) expect(looks.some((c) => (c.expected as { character: string }).character === character)).toBe(true);
    expect(looks.filter((c) => c.name.startsWith("shape ")).length).toBe(MASCOT_SHAPES.length * SHAPE_SKINS.length);
  });
});
