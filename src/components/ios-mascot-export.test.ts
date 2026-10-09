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
// - ios/Sources/CompanionCore/ShibaStillArt.swift: Shiba's parts as draw
//   operations with paint roles (shiba-art.ts), for each stance and each of
//   the sixteen faces, the rig's pivots and the walk cycle's keyframes
//   (shiba-moves.ts). The fixture also carries Shiba's palette for each skin
//   on a few colors, which ShibaArt.swift must match.
//
// Both are checked here; `UPDATE_IOS_MASCOT=1 pnpm vitest run
// src/components/ios-mascot-export.test.ts` rewrites them after a desktop
// change.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNBU_SKINS,
  FROG_SKINS,
  LEGACY_BUNBU_SKINS,
  LEGACY_FROG_SKINS,
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
import { legOps, SHIBA_ART, SHIBA_BUST, SHIBA_BUST_MAX, SHIBA_EXPRESSIONS, SHIBA_HIPS, SHIBA_LEGS, SHIBA_PIVOTS, SHIBA_ROLES, shibaOutline, shibaParts, STANCE_HEAD, MOUTHS, mouthOps, type ShibaOp, type ShibaStance } from "./shiba-art";
import { blendPose, restPose, SHIBA_MOVE_TIMING, shibaMoveAt } from "./shiba-moves";
import { shibaSkinPaint } from "./skin-fx/shiba-skins";

const ROOT = join(__dirname, "..", "..");
const FIXTURE = join(ROOT, "ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json");
const SWIFT_ART = join(ROOT, "ios/Sources/CompanionCore/ShapeStillArt.swift");
const SWIFT_SHIBA = join(ROOT, "ios/Sources/CompanionCore/ShibaStillArt.swift");
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
  for (const skin of FROG_SKINS) add(`frog ${skin}`, { character: "frog", skins: { frog: skin } });
  // the desktop editor saves every choice made (completeMascotLook), every character's skin at once
  for (const character of MASCOT_CHARACTERS) {
    add(`editor ${character}`, completeMascotLook({ character, shape: "cloud", skins: { shape: "galaxy", trombi: "holo", bunbu: "velvet", shiba: "sesame", frog: "poison" } }));
    add(`editor default ${character}`, completeMascotLook({ character }));
  }
  for (const [legacy] of Object.entries(LEGACY_SHAPES)) add(`legacy shape ${legacy}`, { character: "shape", shape: legacy });
  for (const [legacy] of Object.entries(LEGACY_SHAPE_SKINS)) add(`legacy shape skin ${legacy}`, { character: "shape", shape: "circle", skins: { shape: legacy } });
  for (const [legacy] of Object.entries(LEGACY_TROMBI_SKINS)) add(`legacy trombi skin ${legacy}`, { character: "trombi", skins: { trombi: legacy } });
  for (const [legacy] of Object.entries(LEGACY_BUNBU_SKINS)) add(`legacy bunbu skin ${legacy}`, { character: "bunbu", skins: { bunbu: legacy } });
  for (const [legacy] of Object.entries(LEGACY_SHIBA_SKINS)) add(`legacy shiba skin ${legacy}`, { character: "shiba", skins: { shiba: legacy } });
  for (const [legacy] of Object.entries(LEGACY_FROG_SKINS)) add(`legacy frog skin ${legacy}`, { character: "frog", skins: { frog: legacy } });
  // a newer build's skin is dropped, never the character
  add("unknown shape skin", { character: "shape", shape: "pill", skins: { shape: "plasma" } });
  add("unknown bunbu skin", { character: "bunbu", skins: { bunbu: "plasma", shape: "gold" } });
  add("unknown shiba skin", { character: "shiba", skins: { shiba: "plasma", bunbu: "gold" } });
  add("unknown frog skin", { character: "frog", skins: { frog: "plasma", shiba: "red" } });
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
    frogSkins: FROG_SKINS,
    owlSkins: MASCOT_SKIN_IDS,
    colorGroups: Object.fromEntries(MASCOT_COLOR_GROUPS.map((group) => [group, Object.keys(MASCOT_COLOR_PALETTES[group])])),
    colors: MASCOT_COLOR_HEX,
    looks: lookCases(),
    owlSkinCases: owlSkins,
    shibaPalettes: shibaPalettes(),
  };
}

/** Shiba's palette for every skin on a few colors (a gradient as `gradient`), which ShibaArt.palette must match. */
function shibaPalettes() {
  const colors = ["orange", "blue", "white", "butter", "black", "mint"] as const;
  return SHIBA_SKINS.flatMap((skin) =>
    colors.map((color) => {
      const palette = shibaSkinPaint(skin, MASCOT_COLOR_HEX[color], "u").palette;
      return { skin, color, palette: Object.fromEntries(SHIBA_ROLES.map((role) => [role, palette[role].startsWith("url(") ? "gradient" : palette[role].toUpperCase()])) };
    }),
  );
}

/* --------------------------------------------------------------- Shiba */

const SHIBA_A = 60;
const SHIBA_B = 200;
const num = (v: number) => String(Math.round(v * 10000) / 10000);
const str = (v: string) => JSON.stringify(v);

/**
 * Ops drawn at two sizes (two outline widths) as Swift: each width is
 * `width + perOutline * outline`, solved from the two, so the phone draws
 * every size with the desktop's outline rule.
 */
function swiftOps(a: readonly ShibaOp[], b: readonly ShibaOp[], indent: string, hideInBust?: (op: ShibaOp) => boolean): string {
  expect(a.length).toBe(b.length);
  const [owA, owB] = [shibaOutline(SHIBA_A), shibaOutline(SHIBA_B)];
  const items = a.map((op, i) => {
    const other = b[i];
    expect(other.d).toBe(op.d);
    const wa = op.width ?? 0;
    const wb = other.width ?? 0;
    const per = owA === owB ? 0 : (wa - wb) / (owA - owB);
    const base = wa - per * owA;
    const fields = [
      `d: ${str(op.d)}`,
      op.fill ? `fill: .${op.fill}` : null,
      op.stroke ? `stroke: .${op.stroke}` : null,
      op.stroke ? `width: ${num(base)}, perOutline: ${num(per)}` : null,
      op.opacity !== undefined ? `opacity: ${num(op.opacity)}` : null,
      op.clip ? `clip: ${str(op.clip)}` : null,
      op.round ? "round: true" : null,
      hideInBust?.(op) ? "bust: false" : null,
    ].filter(Boolean);
    return `${indent}ShibaOp(${fields.join(", ")}),`;
  });
  return items.length ? `[\n${items.join("\n")}\n${indent.slice(4)}]` : "[]";
}

function shibaSwift(): string {
  const lines: string[] = [
    "// GENERATED by src/components/ios-mascot-export.test.ts from the desktop's",
    "// Shiba (src/components/shiba-art.ts, shiba-moves.ts): its parts as draw",
    "// operations with paint roles for each stance and each face, the rig's",
    "// pivots and the walk cycle's keyframes. Box 0..100. Do not edit; regenerate",
    "// with `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.",
    "import CoreGraphics",
    "",
    "public enum ShibaStillArt {",
  ];
  const at = (size: number, stance: ShibaStance, expression: (typeof SHIBA_EXPRESSIONS)[number] = "neutral") => shibaParts({ expression, size, stance });
  const stances: ShibaStance[] = ["sit", "stand", "lie"];
  const z = (op: ShibaOp) => op.d.startsWith("M80 13");
  for (const key of ["tail", "body", "pawL", "pawR"] as const) {
    lines.push(`    public static let ${key}: [ShibaStance: [ShibaOp]] = [`);
    for (const stance of stances) lines.push(`        .${stance}: ${swiftOps(at(SHIBA_A, stance)[key], at(SHIBA_B, stance)[key], "            ")},`);
    lines.push("    ]");
  }
  for (const key of ["earL", "earR", "head", "nose"] as const) lines.push(`    public static let ${key}: [ShibaOp] = ${swiftOps(at(SHIBA_A, "sit")[key], at(SHIBA_B, "sit")[key], "        ")}`);
  for (const key of ["brows", "eyeL", "eyeR", "mouth", "extras"] as const) {
    lines.push(`    public static let ${key}: [ShibaExpression: [ShibaOp]] = [`);
    for (const expression of SHIBA_EXPRESSIONS) lines.push(`        .${expression}: ${swiftOps(at(SHIBA_A, "sit", expression)[key], at(SHIBA_B, "sit", expression)[key], "            ", z)},`);
    lines.push("    ]");
  }
  lines.push("    /// A move's own mouth over the face's (the walk's pant, the bark).", "    public static let mouths: [String: [ShibaOp]] = [");
  for (const mouth of MOUTHS) lines.push(`        ${str(mouth)}: ${swiftOps(mouthOps(mouth, shibaOutline(SHIBA_A)), mouthOps(mouth, shibaOutline(SHIBA_B)), "            ")},`);
  lines.push("    ]", "    /// The standing legs at rest, far ones first.", "    public static let legs: [(name: String, hip: CGPoint, ops: [ShibaOp])] = [");
  for (const leg of SHIBA_LEGS.filter((name) => name.endsWith("Far")).concat(SHIBA_LEGS.filter((name) => name.endsWith("Near")))) {
    const [x, y] = SHIBA_HIPS[leg];
    lines.push(`        (name: ${str(leg)}, hip: CGPoint(x: ${x}, y: ${y}), ops: ${swiftOps(legOps(leg, 0, 0, shibaOutline(SHIBA_A)), legOps(leg, 0, 0, shibaOutline(SHIBA_B)), "            ")}),`);
  }
  lines.push("    ]");
  lines.push("    /// Where each part turns.", "    public static let pivots: [String: CGPoint] = [");
  for (const [name, [x, y]] of Object.entries(SHIBA_PIVOTS)) lines.push(`        ${str(name)}: CGPoint(x: ${x}, y: ${y}),`);
  lines.push("    ]", "    /// Where the head sits on each body (offset, scale about the neck).", "    public static let stanceHead: [ShibaStance: (x: CGFloat, y: CGFloat, scale: CGFloat)] = [");
  for (const stance of stances) {
    const head = STANCE_HEAD[stance];
    lines.push(`        .${stance}: (x: ${head.x}, y: ${head.y}, scale: ${head.scale}),`);
  }
  lines.push("    ]", `    /// The bust an avatar of ${SHIBA_BUST_MAX} pt or less shows.`, `    public static let bust = CGRect(x: ${SHIBA_BUST.x}, y: ${SHIBA_BUST.y}, width: ${SHIBA_BUST.w}, height: ${SHIBA_BUST.h})`, `    public static let bustMax: CGFloat = ${SHIBA_BUST_MAX}`);
  // the walk cycle, sixteen keyframes (the desktop's eight and the ones between)
  const cycle = SHIBA_MOVE_TIMING.walk.duration;
  lines.push(`    /// The walk cycle (s) and its keyframes: legs (angle forward, lift), body, head, ears, tail.`, `    public static let walkCycle: Double = ${cycle}`, "    public static let walk: [ShibaWalkFrame] = [");
  for (let i = 0; i < 16; i += 1) {
    const pose = blendPose(restPose(), shibaMoveAt("walk", (i / 16) * cycle), 1);
    const legs = SHIBA_LEGS.map((leg) => `${str(leg)}: (${num(pose.legs[leg].angle)}, ${num(pose.legs[leg].lift)})`).join(", ");
    lines.push(`        ShibaWalkFrame(legs: [${legs}], y: ${num(pose.y)}, sy: ${num(pose.sy)}, headY: ${num(pose.headY)}, headRot: ${num(pose.headRot)}, earL: ${num(pose.earL)}, earR: ${num(pose.earR)}, tail: ${num(pose.tail)}),`);
  }
  lines.push("    ]", `    /// The art's own box, for reference: the head path.`, `    public static let headPath = ${str(SHIBA_ART.head)}`, "}", "");
  return lines.join("\n");
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

  it("carries Shiba's parts, faces, pivots and walk cycle as the desktop draws them", () => {
    check(SWIFT_SHIBA, shibaSwift());
  });

  it("covers every known character, shape and skin", () => {
    const looks = lookCases();
    for (const character of MASCOT_CHARACTERS) expect(looks.some((c) => (c.expected as { character: string }).character === character)).toBe(true);
    expect(looks.filter((c) => c.name.startsWith("shape ")).length).toBe(MASCOT_SHAPES.length * SHAPE_SKINS.length);
  });
});
