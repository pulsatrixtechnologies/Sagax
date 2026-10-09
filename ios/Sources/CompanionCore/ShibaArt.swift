// Shiba, the dog (the desktop's `src/components/shiba-art.ts`, direction C
// "aplat net"): the types the generated `ShibaStillArt` uses, the outline
// rule, the faces the app's states wear, and how a skin paints each role
// (`shibaSkinPaint` in skin-fx/shiba-skins.tsx). The fixture test checks
// these palettes against the desktop's (`shibaPalettes` in
// Fixtures/mascot-looks.json).
import CoreGraphics
import Foundation

/// What every part is painted with (`SHIBA_ROLES`).
public enum ShibaRole: String, CaseIterable, Sendable {
    case coat, shade, line, cream, creamShade, earIn, brow, lid, ink, pupil, white, spec, mouth, tongue, tongueLine, blush, sweat, nose
}

/// One drawing operation (`ShibaOp`): a path filled and/or stroked, maybe
/// clipped. A stroke's width is `width + perOutline * outline`.
public struct ShibaOp: Sendable {
    public let d: String
    public let fill: ShibaRole?
    public let stroke: ShibaRole?
    public let width: Double
    public let perOutline: Double
    public let opacity: Double
    public let clip: String?
    public let round: Bool
    /// False for what the bust leaves out (the sleeping z).
    public let bust: Bool

    public init(d: String, fill: ShibaRole? = nil, stroke: ShibaRole? = nil, width: Double = 0, perOutline: Double = 0, opacity: Double = 1, clip: String? = nil, round: Bool = false, bust: Bool = true) {
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

/// The sixteen faces (`SHIBA_EXPRESSIONS`, the Shapes ids).
public enum ShibaExpression: String, CaseIterable, Sendable {
    case neutral, attentive, surprised, excited, happy, laughing, angry, sad, scared, suspicious, confused, curious, proud, shy, bored, sleepy

    /// `shibaExpressionFor` in Avatar.tsx: most app states name one of the faces.
    public static func forState(_ state: String?) -> ShibaExpression {
        switch state {
        case "sleeping", "drowsy", "powering-down": return .sleepy
        case "thinking", "searching", "loading", "curious": return .curious
        case "listening", "dictating", "waking", "working", "progress", "orbit", "radar", "writing", "uploading", "sending", "receiving", "humming": return .attentive
        case "excited", "celebrate", "playful", "bouncing": return .excited
        case "surprised", "alerting", "notifying": return .surprised
        case let state?: return ShibaExpression(rawValue: state) ?? .neutral
        case nil: return .neutral
        }
    }
}

public enum ShibaStance: String, CaseIterable, Sendable {
    case sit, stand, lie
}

/// One keyframe of the walk cycle (`shibaMoveAt("walk")`).
public struct ShibaWalkFrame: Sendable {
    public let legs: [String: (angle: Double, lift: Double)]
    public let y: Double
    public let sy: Double
    public let headY: Double
    public let headRot: Double
    public let earL: Double
    public let earR: Double
    public let tail: Double

    public init(legs: [String: (Double, Double)], y: Double, sy: Double, headY: Double, headRot: Double, earL: Double, earR: Double, tail: Double) {
        self.legs = legs.mapValues { (angle: $0.0, lift: $0.1) }
        self.y = y
        self.sy = sy
        self.headY = headY
        self.headRot = headRot
        self.earL = earL
        self.earR = earR
        self.tail = tail
    }
}

/// A role's paint: a colour, or a gradient over the part's own box (unit coordinates).
public enum ShibaPaint: Equatable, Sendable {
    case solid(String)
    case linear([Stop], from: CGPoint, to: CGPoint)
    case radial([Stop], center: CGPoint, radius: Double)

    public struct Stop: Equatable, Sendable {
        public let offset: Double
        public let color: String
        public init(_ offset: Double, _ color: String) {
            self.offset = offset
            self.color = color
        }
    }

    /// The colour the paint reads as where one colour must do.
    public var solidColor: String? {
        if case let .solid(hex) = self { return hex }
        return nil
    }
}

public enum ShibaArt {
    /// `shibaOutline`: 1.9 units, never under 1.6 screen points (the bust box under 48 pt).
    public static func outline(size: CGFloat) -> Double {
        let box: Double = size <= ShibaStillArt.bustMax ? Double(ShibaStillArt.bust.width) : 100
        return max(1.9, (1.6 * box) / max(1, Double(size)))
    }

    static let cream = "#FFF4E2"
    /// `COAT_MIN_CONTRAST`.
    public static let coatMinContrast = 1.5

    static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// `shibaCoat`: the bot colour, or a light one darkened just enough that the cream mask reads.
    public static func coat(_ hex: String) -> String {
        var coat = hex.uppercased()
        var k = 0.04
        while k <= 0.6, MascotInk.contrast(coat, ShapeArt.mix(cream, coat, 0.06)) < coatMinContrast {
            coat = ShapeArt.mix(hex, "#000000", r2(k))
            k += 0.04
        }
        return coat
    }

    /// `shibaPalette`: direction C's own tones for a coat colour.
    public static func palette(coat hex: String) -> [ShibaRole: String] {
        let coat = coat(hex)
        let cream = ShapeArt.mix(Self.cream, coat, 0.06)
        return [
            .coat: coat, .shade: ShapeArt.mix(coat, "#5A2A10", 0.22), .line: ShapeArt.mix(coat, "#2A1408", 0.74),
            .cream: cream, .creamShade: ShapeArt.mix("#F0D8BA", coat, 0.14), .earIn: cream, .brow: cream, .lid: coat,
            .ink: "#2B1A12", .pupil: "#2B1A12", .white: "#FFFFFF", .spec: "#FFFFFF", .mouth: "#4A1F1A",
            .tongue: "#F07F86", .tongueLine: "#C9545E", .blush: "#F39A8C", .sweat: "#9CD3F5", .nose: "#2B1A12",
        ]
    }

    /// `vgaColor`: Retro 98's coat, the bot colour on a 64-colour grid.
    public static func vga(_ hex: String) -> String {
        let c = RGB(hex: hex)
        func level(_ v: Double) -> Double { min(3, (v / 85).rounded()) * 85 }
        let out = RGB(r: level(c.r), g: level(c.g), b: level(c.b)).hex
        return out == "#000000" ? "#555555" : out == "#FFFFFF" ? "#AAAAAA" : out
    }

    /// `shibaSkinPaint`: every role's paint for a skin on a bot colour (a hex).
    public static func paint(_ skin: ShibaSkin, hex: String) -> [ShibaRole: ShibaPaint] {
        func over(_ base: [ShibaRole: String], _ changes: [ShibaRole: String]) -> [ShibaRole: ShibaPaint] {
            base.merging(changes) { _, new in new }.mapValues { .solid($0.uppercased()) }
        }
        let tint = { (amount: Double) in ShapeArt.tint(hex, amount) }
        switch skin {
        case .plain:
            return over(palette(coat: hex), [:])
        case .cream:
            return over(palette(coat: "#E2BC86"), [.cream: "#FFF9EF", .brow: "#FFF9EF", .earIn: "#FFF9EF"])
        case .blacktan:
            return over(palette(coat: "#2B2420"), [.shade: "#171210", .line: "#0D0907", .cream: "#F7E9D6", .creamShade: "#E3CDB0", .brow: "#D98B47", .earIn: "#E9B98A"])
        case .red:
            return over(palette(coat: "#D2692A"), [:])
        case .sesame:
            var p = over(palette(coat: "#C97A3C"), [.shade: "#6E4224", .lid: "#7A4A2A", .line: "#2A160B"])
            p[.coat] = .linear([.init(0, "#4A2C1A"), .init(0.42, "#8A5530"), .init(0.7, "#C97A3C")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0, y: 1))
            return p
        case .white:
            return over(palette(coat: "#F4EEE4"), [.coat: "#F4EEE4", .lid: "#EDE4D6", .shade: "#DCCFBE", .line: "#7D6A58", .cream: "#FFFFFF", .creamShade: "#EEE6DA", .brow: "#FFFFFF", .earIn: "#FBE9E2"])
        case .retro98:
            let coat = vga(hex)
            // the dithered shade reads as its average on the phone
            return over(palette(coat: coat), [
                .coat: coat, .lid: coat, .shade: ShapeArt.mix(coat, "#000000", 0.5), .line: "#000000", .cream: "#FFFFFF", .creamShade: "#E0E0E0",
                .brow: "#FFFFFF", .earIn: "#FFFFFF", .ink: "#000000", .pupil: "#000000", .mouth: "#800000", .tongue: "#FF00FF",
                .tongueLine: "#800080", .blush: "#FF00FF", .sweat: "#00FFFF", .nose: "#000000",
            ])
        case .gold:
            var p = over(palette(coat: "#C8901E"), [.lid: "#D9A333", .shade: "#8A5A0C", .line: "#5A3A06", .cream: "#FFF1C4", .creamShade: "#E9CF8A", .brow: "#FFF1C4", .earIn: "#FFE9A8", .ink: "#3A2404", .pupil: "#3A2404"])
            p[.coat] = .linear([.init(0, "#FFF4C2"), .init(0.22, "#F2C94C"), .init(0.55, "#C8901E"), .init(0.8, "#8A5A0C"), .init(1, "#E9B949")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0.35, y: 1))
            return p
        case .neon:
            let glow = tint(0.45)
            return over(palette(coat: hex), [
                .coat: "#0D0F15", .lid: "#0D0F15", .shade: "#07080C", .line: tint(0.2), .cream: ShapeArt.mix(hex, "#0D0F15", 0.8),
                .creamShade: ShapeArt.mix(hex, "#0D0F15", 0.88), .brow: glow, .earIn: ShapeArt.mix(hex, "#0D0F15", 0.6), .ink: glow,
                .pupil: "#0D0F15", .white: "#EAFCFF", .mouth: "#07080C", .nose: glow, .spec: "#FFFFFF",
            ])
        case .chrome:
            var p = over(palette(coat: "#8C98A6"), [.lid: "#8C98A6", .shade: "#4B5561", .line: "#1F262D", .cream: "#EEF2F6", .creamShade: "#C9D2DB", .brow: "#EEF2F6", .earIn: "#DFE5EB", .ink: "#10151B", .pupil: "#10151B"])
            let horizon = ShapeArt.mix(hex, "#4B5561", 0.7)
            p[.coat] = .linear([.init(0, "#FDFDFE"), .init(0.3, "#C9D2DB"), .init(0.49, horizon), .init(0.53, "#262D35"), .init(0.76, "#8C98A6"), .init(1, "#E6EBF0")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0, y: 1))
            return p
        case .glitch:
            return over(palette(coat: "#2A3348"), [.coat: "#2A3348", .lid: "#2A3348", .shade: "#11151F", .line: "#0B0F1A", .cream: "#CDEEDD", .creamShade: "#9FC9B4", .brow: "#22E6FF", .earIn: "#FF2BD6", .ink: "#0B0F1A", .pupil: "#0B0F1A", .mouth: "#0B0F1A", .tongue: "#FF2BD6", .nose: "#0B0F1A"])
        case .holo:
            var p = over(palette(coat: "#D9D2F5"), [.lid: "#E3E9FF", .shade: "#C9BFF0", .line: "#6B5FA8", .cream: "#FFFFFF", .creamShade: "#ECE6FF", .brow: "#FFFFFF", .earIn: "#FFD6F4", .ink: "#2A2140", .pupil: "#2A2140"])
            p[.coat] = .linear([.init(0, "#FBF8FF"), .init(0.6, "#E3E9FF"), .init(1, "#D9D2F5")], from: CGPoint(x: 0, y: 0), to: CGPoint(x: 1, y: 1))
            return p
        case .molten:
            var p = over(palette(coat: "#3D1D14"), [.lid: "#2A120C", .shade: "#170806", .line: "#FF6A1A", .cream: "#6B2F17", .creamShade: "#4A1E0E", .brow: "#FFD36B", .earIn: "#FF8A2A", .ink: "#FFD36B", .pupil: "#170806", .white: "#FFF3C4", .mouth: "#170806", .nose: "#170806"])
            p[.coat] = .radial([.init(0, "#3D1D14"), .init(1, "#170806")], center: CGPoint(x: 0.45, y: 0.4), radius: 0.7)
            return p
        }
    }

    /// The skins whose premium layers (sweeps, foil, bloom, cracks, the glitch split, the dither) the phone does not draw.
    public static let baseOnly: Set<ShibaSkin> = [.retro98, .gold, .neon, .chrome, .glitch, .holo, .molten]
}
