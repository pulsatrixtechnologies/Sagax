// Frog, the smug sad frog (the desktop's `src/components/frog-art.ts`,
// direction C "aplat net"): the types the generated `FrogStillArt` uses, the
// outline rule, the faces the app's states wear, the skin's tint of the bot
// colour and how a skin paints each role (`frogSkinPaint` in
// skin-fx/frog-skins.tsx). The fixture test checks these palettes against
// the desktop's (`frogPalettes` in Fixtures/mascot-looks.json).
import CoreGraphics
import Foundation

/// What every part is painted with (`FROG_ROLES`).
public enum FrogRole: String, CaseIterable, Sendable {
    case skin, shade, line, belly, bellyShade, toe, toeShade, lid, lidLine, white, ink, pupil, spec, lip, lipShade, lipLine, mouth, tongue, blush, sweat, throat, throatShade, pad, padShade, padLine, water, waterLine, fly
}

/// One drawing operation (`FrogOp`): a path filled and/or stroked, maybe
/// clipped. A stroke's width is `width + perOutline * outline`.
public struct FrogOp: Sendable {
    public let d: String
    public let fill: FrogRole?
    public let stroke: FrogRole?
    public let width: Double
    public let perOutline: Double
    public let opacity: Double
    public let clip: String?
    public let round: Bool
    /// False for what the bust leaves out (the sleeping z).
    public let bust: Bool

    public init(d: String, fill: FrogRole? = nil, stroke: FrogRole? = nil, width: Double = 0, perOutline: Double = 0, opacity: Double = 1, clip: String? = nil, round: Bool = false, bust: Bool = true) {
        self.d = d
        self.fill = fill
        self.stroke = stroke
        self.width = width
        self.perOutline = perOutline
        self.opacity = opacity
        self.clip = clip
        self.round = round
        self.bust = bust
    }

    public func strokeWidth(outline: Double) -> Double { width + perOutline * outline }
}

/// The sixteen faces (`FROG_EXPRESSIONS`, the Shapes ids), carried by the lids and the lips.
public enum FrogExpression: String, CaseIterable, Sendable {
    case neutral, attentive, surprised, excited, happy, laughing, angry, sad, scared, suspicious, confused, curious, proud, shy, bored, sleepy

    /// `frogExpressionFor` in Avatar.tsx: the same map as Shiba's.
    public static func forState(_ state: String?) -> FrogExpression {
        FrogExpression(rawValue: ShibaExpression.forState(state).rawValue) ?? .neutral
    }
}

/// One keyframe of a move (`frogMoveAt`): the whole frog, the head, the legs, the throat, the lids.
public struct FrogFrame: Sendable {
    public let y: Double
    public let rot: Double
    public let sx: Double
    public let sy: Double
    public let headY: Double
    public let headRot: Double
    public let legs: Double
    public let puff: Double
    public let blinkL: Double
    public let blinkR: Double

    public init(y: Double, rot: Double, sx: Double, sy: Double, headY: Double, headRot: Double, legs: Double, puff: Double, blinkL: Double, blinkR: Double) {
        self.y = y
        self.rot = rot
        self.sx = sx
        self.sy = sy
        self.headY = headY
        self.headRot = headRot
        self.legs = legs
        self.puff = puff
        self.blinkL = blinkL
        self.blinkR = blinkR
    }

    /// Two keyframes blended (`t` 0..1).
    public func mixed(_ other: FrogFrame, _ t: Double) -> FrogFrame {
        func m(_ a: Double, _ b: Double) -> Double { a + (b - a) * t }
        return FrogFrame(y: m(y, other.y), rot: m(rot, other.rot), sx: m(sx, other.sx), sy: m(sy, other.sy), headY: m(headY, other.headY), headRot: m(headRot, other.headRot), legs: m(legs, other.legs), puff: m(puff, other.puff), blinkL: m(blinkL, other.blinkL), blinkR: m(blinkR, other.blinkR))
    }
}

public enum FrogArt {
    /// `frogOutline`: 1.9 units, never under 1.6 screen points (the bust box under 48 pt).
    public static func outline(size: CGFloat) -> Double {
        let box: Double = size <= FrogStillArt.bustMax ? Double(FrogStillArt.bust.width) : 100
        return max(1.9, (1.6 * box) / max(1, Double(size)))
    }

    /// `FROG_GREEN`, `FROG_TINT`, the belly's own tone and `SKIN_MIN_CONTRAST`.
    public static let green = "#74AE48"
    public static let tintAmount = 0.24
    static let belly = "#E4EDB6"
    public static let skinMinContrast = 1.45

    static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// `toHsl`: hue (degrees), saturation and lightness (0..1).
    static func hsl(_ hex: String) -> (h: Double, s: Double, l: Double) {
        let c = RGB(hex: hex)
        let r = c.r / 255, g = c.g / 255, b = c.b / 255
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2, d = mx - mn
        if d == 0 { return (0, 0, l) }
        let s = d / (1 - abs(2 * l - 1))
        var h: Double
        if mx == r { h = ((g - b) / d + 6).truncatingRemainder(dividingBy: 6) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
        h *= 60
        return (h, s, l)
    }

    /// `fromHsl`.
    static func hex(h: Double, s: Double, l: Double) -> String {
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        let (r, g, b): (Double, Double, Double) = h < 60 ? (c, x, 0) : h < 120 ? (x, c, 0) : h < 180 ? (0, c, x) : h < 240 ? (0, x, c) : h < 300 ? (x, 0, c) : (c, 0, x)
        func ch(_ v: Double) -> Double { (min(1, max(0, v + m)) * 255).rounded() }
        return RGB(r: ch(r), g: ch(g), b: ch(b)).hex
    }

    /// `tintTone`: hue and lightness move toward the blend, the saturation never drops under the base's.
    public static func tintTone(_ base: String, _ color: String, _ t: Double) -> String {
        let m = hsl(ShapeArt.mix(base, color, t)), b = hsl(base)
        return hex(h: m.h, s: max(m.s, b.s * 0.92), l: (m.l + b.l) / 2)
    }

    /// `frogSkin`: the green taking 24 % of the bot colour, darkened just enough for the belly to read.
    public static func skin(_ hex: String?) -> String {
        let tinted = hex.map { tintTone(green, $0, tintAmount) } ?? green
        var skin = tinted
        var k = 0.04
        while k <= 0.6, MascotInk.contrast(skin, ShapeArt.mix(belly, skin, 0.12)) < skinMinContrast {
            skin = ShapeArt.mix(tinted, "#0E2008", r2(k))
            k += 0.04
        }
        return skin.uppercased()
    }

    /// `frogPaletteFor`: direction C's own tones around a skin tone.
    public static func palette(skin: String) -> [FrogRole: String] {
        let shade = ShapeArt.mix(skin, "#1A3A10", 0.3)
        return [
            .skin: skin, .shade: shade, .line: ShapeArt.mix(skin, "#0E1A08", 0.74),
            .belly: ShapeArt.mix(belly, skin, 0.12), .bellyShade: ShapeArt.mix("#CCDA92", skin, 0.2),
            .toe: skin, .toeShade: shade, .lid: skin, .lidLine: "#1E1A12", .white: "#FFFFFF", .ink: "#1E1A12", .pupil: "#1E1A12", .spec: "#FFFFFF",
            .lip: "#A9533F", .lipShade: ShapeArt.mix("#A9533F", "#3A1008", 0.3), .lipLine: "#4A1F14", .mouth: "#3A140E", .tongue: "#F07F86",
            .blush: "#F39A8C", .sweat: "#9CD3F5", .throat: ShapeArt.mix("#F0F4D2", skin, 0.1), .throatShade: ShapeArt.mix("#D6E2A4", skin, 0.2),
            .pad: "#4E9A3A", .padShade: "#2F6E25", .padLine: "#1B3F14", .water: "#5FA8D8", .waterLine: "#2C6E9E", .fly: "#2A2A33",
        ]
    }

    /// `frogPalette`: the plain palette for a bot colour.
    public static func palette(hex: String?) -> [FrogRole: String] { palette(skin: skin(hex)) }

    /// `frogSkinPaint`: every role's paint for a skin on a bot colour (a hex). Patterns (the
    /// poison frog's spots, the bullfrog's mottling, Retro 98's dither) read as their base tone.
    public static func paint(_ skin: FrogSkin, hex: String) -> [FrogRole: ShibaPaint] {
        func over(_ base: [FrogRole: String], _ changes: [FrogRole: String]) -> [FrogRole: ShibaPaint] {
            base.merging(changes) { _, new in new }.mapValues { .solid($0.uppercased()) }
        }
        let vertical = (from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0, y: 1))
        switch skin {
        case .plain:
            return over(palette(hex: hex), [:])
        case .leaf:
            return over(palette(skin: "#3FB43A"), [.belly: "#EEF7C2", .lip: "#B4472F", .lipShade: "#7E2F1E"])
        case .tree:
            return over(palette(skin: "#35C23A"), [
                .shade: "#1F8E2A", .line: "#0B3A12", .belly: "#FFF6D6", .bellyShade: "#2F6FC4", .white: "#E5231B", .spec: "#FFD3CC", .toe: "#FF8A1F",
                .toeShade: "#D9580F", .lip: "#2A9A35", .lipShade: "#1B7A27", .lipLine: "#0B3A12", .throat: "#FFF6D6",
            ])
        case .poison:
            return over(palette(skin: "#2E6FE0"), [
                .lid: "#2E6FE0", .shade: "#1A4AB0", .line: "#07102A", .belly: "#5E95F2", .bellyShade: "#3C6FD0", .toe: "#1A4AB0", .toeShade: "#0F327E",
                .lip: "#13328A", .lipShade: "#0B2160", .lipLine: "#07102A", .throat: "#5E95F2", .throatShade: "#3C6FD0",
            ])
        case .bullfrog:
            return over(palette(skin: "#8A6A36"), [
                .lid: "#8A6A36", .shade: "#644B24", .line: "#2C1E0C", .belly: "#F3DD86", .bellyShade: "#D9BC5E", .toe: "#8A6A36", .toeShade: "#644B24",
                .lip: "#6E3420", .lipShade: "#4C2214", .throat: "#F7D45C", .throatShade: "#DDB43C", .white: "#F6E7B0",
            ])
        case .ghost:
            var p = over(palette(skin: "#BFEFDC"), [
                .lid: "#D9F7EA", .line: "#4F9C86", .belly: "#F7FFFB", .bellyShade: "#F4C9D2", .toe: "#D9F7EA", .toeShade: "#A9E6CF", .lip: "#E79AA6",
                .lipShade: "#C77B88", .lipLine: "#7A3B48", .throat: "#F7FFFB", .throatShade: "#D9F7EA", .ink: "#24453C", .pupil: "#24453C",
            ])
            p[.skin] = .linear([.init(0, "#F2FFF8"), .init(0.55, "#CFF3E2"), .init(1, "#A9E6CF")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0.3, y: 1))
            p[.shade] = .linear([.init(0, "#9BDDC4"), .init(1, "#7CCBB0")], from: vertical.from, to: vertical.to)
            return p
        case .retro98:
            let tone = ShibaArt.vga(Self.skin(hex))
            // the dithered shade reads as its average on the phone
            return over(palette(skin: tone), [
                .skin: tone, .lid: tone, .toe: tone, .toeShade: ShapeArt.mix(tone, "#000000", 0.5), .shade: ShapeArt.mix(tone, "#000000", 0.5), .line: "#000000",
                .lidLine: "#000000", .belly: "#FFFFFF", .bellyShade: "#E0E0E0", .ink: "#000000", .pupil: "#000000", .lip: "#800000", .lipShade: "#800000",
                .lipLine: "#000000", .mouth: "#000000", .tongue: "#FF00FF", .blush: "#FF00FF", .sweat: "#00FFFF", .throat: "#FFFFFF", .throatShade: "#C0C0C0",
            ])
        case .gold:
            var p = over(palette(skin: "#C8901E"), [
                .lid: "#D9A333", .shade: "#8A5A0C", .line: "#5A3A06", .lidLine: "#3A2404", .belly: "#FFF1C4", .bellyShade: "#E9CF8A", .toe: "#E9B949",
                .toeShade: "#8A5A0C", .ink: "#3A2404", .pupil: "#3A2404", .lip: "#9A3B1A", .lipShade: "#6E2610", .lipLine: "#3A1606", .throat: "#FFF1C4",
                .throatShade: "#E9CF8A",
            ])
            p[.skin] = .linear([.init(0, "#FFF4C2"), .init(0.22, "#F2C94C"), .init(0.55, "#C8901E"), .init(0.8, "#8A5A0C"), .init(1, "#E9B949")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0.35, y: 1))
            return p
        case .neon:
            let glow = ShapeArt.tint(hex, 0.45)
            return over(palette(hex: hex), [
                .skin: "#0D0F15", .lid: "#0D0F15", .shade: "#07080C", .line: ShapeArt.tint(hex, 0.2), .lidLine: glow, .belly: "#161A26", .bellyShade: "#10131C",
                .toe: "#0D0F15", .toeShade: "#07080C", .ink: glow, .pupil: "#0D0F15", .white: "#EAFCFF", .lip: "#1A0B12", .lipShade: "#10060B",
                .lipLine: "#FF4FA8", .mouth: "#07080C", .spec: "#FFFFFF", .throat: "#161A26", .throatShade: "#10131C",
            ])
        case .chrome:
            var p = over(palette(skin: "#8C98A6"), [
                .lid: "#8C98A6", .shade: "#4B5561", .line: "#1F262D", .lidLine: "#10151B", .belly: "#EEF2F6", .bellyShade: "#C9D2DB", .toe: "#C9D2DB",
                .toeShade: "#4B5561", .ink: "#10151B", .pupil: "#10151B", .lip: "#5B6673", .lipShade: "#3A434E", .lipLine: "#10151B", .throat: "#EEF2F6",
                .throatShade: "#C9D2DB",
            ])
            let horizon = ShapeArt.mix(hex, "#4B5561", 0.7)
            p[.skin] = .linear([.init(0, "#FDFDFE"), .init(0.3, "#C9D2DB"), .init(0.49, horizon), .init(0.53, "#262D35"), .init(0.76, "#8C98A6"), .init(1, "#E6EBF0")], from: vertical.from, to: vertical.to)
            return p
        case .glitch:
            return over(palette(skin: "#2A3348"), [
                .skin: "#2A3348", .lid: "#2A3348", .shade: "#11151F", .line: "#0B0F1A", .lidLine: "#22E6FF", .belly: "#CDEEDD", .bellyShade: "#9FC9B4",
                .toe: "#22E6FF", .toeShade: "#1495A8", .ink: "#0B0F1A", .pupil: "#0B0F1A", .lip: "#FF2BD6", .lipShade: "#B0189A", .lipLine: "#0B0F1A",
                .mouth: "#0B0F1A", .tongue: "#22E6FF", .throat: "#CDEEDD", .throatShade: "#9FC9B4",
            ])
        case .holo:
            var p = over(palette(skin: "#D9D2F5"), [
                .lid: "#E3E9FF", .shade: "#C9BFF0", .line: "#6B5FA8", .lidLine: "#2A2140", .belly: "#FFFFFF", .bellyShade: "#ECE6FF", .toe: "#FFD6F4",
                .toeShade: "#C9BFF0", .ink: "#2A2140", .pupil: "#2A2140", .lip: "#FF9AD5", .lipShade: "#D77AB8", .lipLine: "#6B5FA8", .throat: "#FFFFFF",
                .throatShade: "#ECE6FF",
            ])
            p[.skin] = .linear([.init(0, "#FBF8FF"), .init(0.6, "#E3E9FF"), .init(1, "#D9D2F5")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 1, y: 1))
            return p
        case .molten:
            var p = over(palette(skin: "#3D1D14"), [
                .lid: "#2A120C", .shade: "#170806", .line: "#FF6A1A", .lidLine: "#FF6A1A", .belly: "#6B2F17", .bellyShade: "#4A1E0E", .toe: "#FF8A2A",
                .toeShade: "#C2410C", .ink: "#FFD36B", .pupil: "#170806", .white: "#FFF3C4", .lip: "#FF6A1A", .lipShade: "#C2410C", .lipLine: "#FFD36B",
                .mouth: "#170806", .throat: "#FF8A2A", .throatShade: "#C2410C",
            ])
            p[.skin] = .radial([.init(0, "#3D1D14"), .init(1, "#170806")], center: CGPoint(x: 0.45, y: 0.4), radius: 0.7)
            return p
        }
    }

    /// The skins the phone draws without some of the desktop's look: patterns (spots, mottling,
    /// dither), the glass frog's see-through, or a premium skin's layers (sweeps, foil, bloom, cracks).
    public static let baseOnly: Set<FrogSkin> = [.poison, .bullfrog, .ghost, .retro98, .gold, .neon, .chrome, .glitch, .holo, .molten]
}
