// The other two Sagax characters as data, and the bits of CSS the desktop
// animates and tints them with:
//
// - `ShapeArt`: `SHAPE_ART` and `shapeSkinPaint` from
//   `src/components/ShapeMascot.tsx`.
// - `TrombiArt`: `src/components/retro-assistant/trombi-art.ts` (geometry and
//   the pose shapes) plus the skins of `shape-mascot.css`.
// - `CSSColorFilter`: the CSS filter functions Trombi's skins use, applied to
//   a colour, since a flat drawing can be tinted colour by colour exactly.
// - `CSSKeyframes`: keyframe interpolation with CSS timing functions, so the
//   phone's mascots move on the desktop's curves.
import CoreGraphics
import Foundation

// MARK: - Shapes

public enum ShapeArt {
    public struct Art: Sendable {
        /// The outline, viewBox 0 0 100 100.
        public let d: String
        /// Where the pair of eyes is centred.
        public let eyes: CGPoint
        public let gap: CGFloat
    }

    public static let art: [MascotShape: Art] = [
        .circle: Art(d: "M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z", eyes: CGPoint(x: 50, y: 52), gap: 11),
        .blob: Art(d: "M30 22C40 10 62 8 76 18C90 28 94 50 86 66C78 82 58 92 40 88C22 84 8 70 10 54C11 46 17 42 22 38C26 34 24 28 30 22z", eyes: CGPoint(x: 54, y: 50), gap: 11),
        .squircle: Art(d: "M30 10H70C82 10 90 18 90 30V70C90 82 82 90 70 90H30C18 90 10 82 10 70V30C10 18 18 10 30 10z", eyes: CGPoint(x: 50, y: 52), gap: 12),
        .pill: Art(d: "M30 26H70C83 26 94 37 94 50C94 63 83 74 70 74H30C17 74 6 63 6 50C6 37 17 26 30 26z", eyes: CGPoint(x: 50, y: 50), gap: 12),
        .triangle: Art(d: "M44 14C47 9 53 9 56 14L91 76C94 82 90 88 84 88H16C10 88 6 82 9 76z", eyes: CGPoint(x: 50, y: 64), gap: 10),
        .hexagon: Art(d: "M44 9C48 7 52 7 56 9L84 25C88 27 90 31 90 35V65C90 69 88 73 84 75L56 91C52 93 48 93 44 91L16 75C12 73 10 69 10 65V35C10 31 12 27 16 25z", eyes: CGPoint(x: 50, y: 52), gap: 12),
        .cloud: Art(d: "M24 82C13 82 6 74 6 64C6 54 13 47 22 46C22 32 33 22 46 22C55 22 63 27 67 35C70 33 74 32 78 32C88 32 96 41 95 52C94 60 90 66 84 68C88 72 86 82 78 82z", eyes: CGPoint(x: 50, y: 58), gap: 12),
        .drop: Art(d: "M50 6C58 22 82 42 82 62C82 80 68 92 50 92C32 92 18 80 18 62C18 42 42 22 50 6z", eyes: CGPoint(x: 50, y: 62), gap: 11),
    ]

    /// How a skin paints a shape (`shapeSkinPaint`).
    public struct Paint: Equatable, Sendable {
        public var fill: String
        public var stroke: String?
        public var strokeWidth: CGFloat
        public var eyes: String
        public var glow: String?
        public var shine: Bool
    }

    /// The shape's reading of a colour (`hexOf`): a name, a `#RRGGBB`, or green.
    public static func hex(_ color: String) -> String {
        MausColors.hex(for: color) ?? MausColors.hex["green"]!
    }

    /// Mixes a hex colour toward white (`tint` in ShapeMascot.tsx).
    public static func tint(_ hex: String, _ amount: Double) -> String {
        let c = RGB(hex: hex)
        func mix(_ v: Double) -> Double { (v + (255 - v) * amount).rounded() }
        return RGB(r: mix(c.r), g: mix(c.g), b: mix(c.b)).hex
    }

    public static func paint(_ skin: ShapeSkin, hex: String) -> Paint {
        switch skin {
        case .glossy:
            return Paint(fill: hex, stroke: nil, strokeWidth: 0, eyes: "#1B1F27", glow: nil, shine: true)
        case .outline:
            return Paint(fill: tint(hex, 0.92), stroke: hex, strokeWidth: 6, eyes: "#1B1F27", glow: nil, shine: false)
        case .neon:
            return Paint(fill: "#14161C", stroke: tint(hex, 0.15), strokeWidth: 4, eyes: tint(hex, 0.35), glow: tint(hex, 0.1), shine: false)
        case .pastel:
            return Paint(fill: tint(hex, 0.55), stroke: nil, strokeWidth: 0, eyes: "#3A3F4B", glow: nil, shine: false)
        case .night:
            return Paint(fill: "#1C2236", stroke: hex, strokeWidth: 2.5, eyes: "#F6F1E8", glow: nil, shine: false)
        case .plain:
            return Paint(fill: hex, stroke: nil, strokeWidth: 0, eyes: "#1B1F27", glow: nil, shine: false)
        }
    }

    /// The eyes' vertical look per mood: up while thinking, down asleep.
    public static func look(_ mood: ShapeMood) -> CGFloat {
        switch mood {
        case .thinking: return -4
        case .sleeping: return 2
        default: return 0
        }
    }

    /// The two eye centres' x for an art (`ex ∓ (gap / 2 + 4)`).
    public static func eyeXs(_ art: Art) -> (CGFloat, CGFloat) {
        (art.eyes.x - art.gap / 2 - 4, art.eyes.x + art.gap / 2 + 4)
    }
}

// MARK: - Trombi

public enum TrombiArt {
    /// viewBox -50 0 310 380.
    public static let viewBox = CGRect(x: -50, y: 0, width: 310, height: 380)
    /// Width over height of the drawing.
    public static let aspect: CGFloat = 310 / 380

    public static let wire = "M 48 164 L 48 266 A 46 46 0 0 0 140 266 L 140 94 A 38 38 0 0 0 64 94 L 64 236 A 30 30 0 0 0 124 236 L 124 156"
    public static let sheet = "M-40 338 L115 365 C165 318 222 222 248 156 C204 128 150 162 104 129 C78 180 -2 280 -40 338 Z"
    public static let ruled = [
        "M-30.8 324.4 L126.3 353.7", "M-20.7 309.8 L137.5 341.2", "M-9.8 294.5 L148.7 327.6",
        "M1.6 278.7 L159.6 313.3", "M13.2 262.8 L170.3 298.4", "M24.9 246.9 L180.5 283.2",
        "M36.3 231.2 L190.3 267.9", "M47.3 215.9 L199.6 252.7", "M57.7 201.3 L208.2 237.8",
        "M67.4 187.5 L216.2 223.3", "M76.2 174.5 L223.6 209.4", "M84.1 162.6 L230.1 196.2",
        "M90.9 152.0 L236.0 184.0", "M96.5 142.6 L241.0 172.9", "M101.0 134.7 L245.1 163.2",
    ]
    public static let margin = "M-21.4 341.2 L-13.6 330.1 L-5.0 318.2 L4.2 305.4 L13.9 292.1 L23.9 278.3 L34.2 264.1 L44.6 249.7 L55.0 235.3 L65.2 220.9 L75.1 206.6 L84.6 192.7 L93.6 179.2 L101.8 166.3 L109.3 154.1 L115.8 142.7 L121.3 132.2 M-17.5 341.9 L-9.7 330.9 L-1.1 318.9 L8.1 306.2 L17.8 292.9 L27.9 279.2 L38.1 265.0 L48.5 250.7 L58.8 236.2 L69.0 221.8 L78.9 207.5 L88.3 193.6 L97.2 180.1 L105.5 167.1 L112.9 154.8 L119.4 143.4 L124.9 132.9"
    public static let curl = "M222 170 Q240 166 248 156 Q242 172 234 182 Z"
    public static let eyeLeft = CGPoint(x: 58, y: 118)
    public static let eyeRight = CGPoint(x: 140, y: 118)
    public static let eyeRadius: CGFloat = 28
    /// The face's rotation pivot.
    public static let facePivot = CGPoint(x: 99, y: 118)

    public struct PoseShape: Sendable {
        public let tilt: CGFloat
        public let pupil: CGPoint
        public let browLeft: String
        public let browRight: String
    }

    public static let poses: [TrombiPose: PoseShape] = [
        .idle: PoseShape(tilt: -2, pupil: CGPoint(x: 1.7, y: 2.3), browLeft: "M34 83 Q58 62 80 81 Q58 75.5 34 83 Z", browRight: "M118 81 Q140 62 164 83 Q140 75.5 118 81 Z"),
        .speak: PoseShape(tilt: -3, pupil: CGPoint(x: -5.7, y: -1.1), browLeft: "M34 79 Q58 56 80 77 Q58 69.5 34 79 Z", browRight: "M118 77 Q140 56 164 79 Q140 69.5 118 77 Z"),
        .think: PoseShape(tilt: 2, pupil: CGPoint(x: 5.7, y: -9.2), browLeft: "M34 76 Q58 51 80 74 Q58 64.5 34 76 Z", browRight: "M118 85 Q140 69 164 85 Q140 82.5 118 85 Z"),
        .bored: PoseShape(tilt: -2, pupil: CGPoint(x: -8, y: 5.7), browLeft: "M34 85 Q58 69 80 84 Q58 82.5 34 85 Z", browRight: "M118 84 Q140 69 164 85 Q140 82.5 118 84 Z"),
        .sleep: PoseShape(tilt: 3, pupil: CGPoint(x: 0, y: 10.3), browLeft: "M34 86 Q58 70 80 85 Q58 83.5 34 86 Z", browRight: "M118 85 Q140 70 164 86 Q140 83.5 118 85 Z"),
        .celebrate: PoseShape(tilt: 0, pupil: CGPoint(x: 0, y: -3.4), browLeft: "M34 75 Q58 49 80 72 Q58 62.5 34 75 Z", browRight: "M118 72 Q140 49 164 75 Q140 62.5 118 72 Z"),
        .send: PoseShape(tilt: 2, pupil: CGPoint(x: 8, y: -5.7), browLeft: "M34 81 Q58 60 80 79 Q58 73.5 34 81 Z", browRight: "M118 76 Q140 55 164 78 Q140 68.5 118 76 Z"),
    ]

    /// A Trombi skin's CSS filter (`.trombi-skin-*` in shape-mascot.css), as
    /// a colour transform. Neon also glows, which a colour cannot carry: the
    /// renderer adds its two drop shadows.
    public static func filter(_ skin: TrombiSkin) -> [CSSColorFilter] {
        switch skin {
        case .classic: return []
        case .gold: return [.sepia(0.9), .saturate(2.4), .hueRotate(-12), .brightness(1.04)]
        case .neon: return [.saturate(1.6)]
        case .retro98: return [.grayscale(0.35), .contrast(1.15)]
        }
    }

    /// The avatar's Trombi: 78 % of the box wide, standing on its bottom edge.
    public static func avatarWidth(_ box: CGFloat) -> CGFloat { (box * 0.78).rounded() }
    public static func avatarHeight(_ box: CGFloat) -> CGFloat { (avatarWidth(box) / aspect).rounded() }
}

// MARK: - CSS colour filters

/// The CSS `filter` functions that only move colours, per Filter Effects 1
/// (shorthands run in sRGB, each step clamped).
public enum CSSColorFilter: Equatable, Sendable {
    case grayscale(Double)
    case sepia(Double)
    case saturate(Double)
    case hueRotate(Double)
    case brightness(Double)
    case contrast(Double)

    /// Applies the filters in order to an sRGB colour in 0...1.
    public static func apply(_ filters: [CSSColorFilter], r: Double, g: Double, b: Double) -> (Double, Double, Double) {
        var c = (r, g, b)
        for f in filters { c = f.apply(c) }
        return c
    }

    /// Applies the filters to a `#RRGGBB` and returns one.
    public static func apply(_ filters: [CSSColorFilter], hex: String) -> String {
        guard !filters.isEmpty else { return hex }
        let c = RGB(hex: hex)
        let (r, g, b) = apply(filters, r: c.r / 255, g: c.g / 255, b: c.b / 255)
        return RGB(r: r * 255, g: g * 255, b: b * 255).hex
    }

    func apply(_ c: (Double, Double, Double)) -> (Double, Double, Double) {
        func m(_ k: [Double]) -> (Double, Double, Double) {
            (k[0] * c.0 + k[1] * c.1 + k[2] * c.2,
             k[3] * c.0 + k[4] * c.1 + k[5] * c.2,
             k[6] * c.0 + k[7] * c.1 + k[8] * c.2)
        }
        let out: (Double, Double, Double)
        switch self {
        case let .grayscale(a):
            let s = 1 - min(1, max(0, a))
            out = m([0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
                     0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
                     0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s])
        case let .sepia(a):
            let s = 1 - min(1, max(0, a))
            out = m([0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s,
                     0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s,
                     0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s])
        case let .saturate(s):
            out = m([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
                     0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
                     0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s])
        case let .hueRotate(deg):
            let a = deg * .pi / 180, co = cos(a), si = sin(a)
            out = m([0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928,
                     0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283,
                     0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072])
        case let .brightness(a):
            out = (c.0 * a, c.1 * a, c.2 * a)
        case let .contrast(a):
            let i = 0.5 - 0.5 * a
            out = (c.0 * a + i, c.1 * a + i, c.2 * a + i)
        }
        func clamp(_ v: Double) -> Double { min(1, max(0, v)) }
        return (clamp(out.0), clamp(out.1), clamp(out.2))
    }
}

// MARK: - CSS keyframes

/// A CSS timing function.
public enum CSSTiming: Sendable {
    case linear
    case cubic(Double, Double, Double, Double)

    public static let ease = CSSTiming.cubic(0.25, 0.1, 0.25, 1)
    public static let easeIn = CSSTiming.cubic(0.42, 0, 1, 1)
    public static let easeOut = CSSTiming.cubic(0, 0, 0.58, 1)
    public static let easeInOut = CSSTiming.cubic(0.42, 0, 0.58, 1)

    /// Progress through one keyframe interval, eased.
    public func value(_ x: Double) -> Double {
        switch self {
        case .linear:
            return x
        case let .cubic(x1, y1, x2, y2):
            if x <= 0 { return 0 }
            if x >= 1 { return 1 }
            func bx(_ t: Double) -> Double { 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t }
            func by(_ t: Double) -> Double { 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t }
            // bisection: monotonic in t for valid timing functions
            var lo = 0.0, hi = 1.0, t = x
            for _ in 0..<30 {
                t = (lo + hi) / 2
                if bx(t) < x { lo = t } else { hi = t }
            }
            return by(t)
        }
    }
}

/// One CSS `@keyframes` rule over a vector of numbers (opacity, a translate,
/// a scale), evaluated the way a browser does: each interval eased by the
/// animation's timing function, offsets without a value skipped.
public struct CSSKeyframes: Sendable {
    public let frames: [(offset: Double, value: [Double])]

    public init(_ frames: [(Double, [Double])]) {
        self.frames = frames.sorted { $0.0 < $1.0 }.map { (offset: $0.0, value: $0.1) }
    }

    /// The value `t` seconds into an infinite animation of `duration` that
    /// starts after `delay`; nil while the delay runs (fill-mode none, so the
    /// element keeps its own still look). `alternate` plays every other cycle
    /// backwards.
    public func value(at t: Double, duration: Double, delay: Double = 0, timing: CSSTiming = .ease, alternate: Bool = false) -> [Double]? {
        guard duration > 0, t >= delay, let first = frames.first, let last = frames.last else { return nil }
        let elapsed = (t - delay) / duration
        var progress = elapsed - floor(elapsed)
        if alternate && Int(floor(elapsed)) % 2 == 1 { progress = 1 - progress }
        if progress <= first.offset { return first.value }
        if progress >= last.offset { return last.value }
        for i in 1..<frames.count where progress <= frames[i].offset {
            let a = frames[i - 1], b = frames[i]
            let span = b.offset - a.offset
            let k = timing.value(span > 0 ? (progress - a.offset) / span : 1)
            return zip(a.value, b.value).map { $0 + ($1 - $0) * k }
        }
        return last.value
    }
}
