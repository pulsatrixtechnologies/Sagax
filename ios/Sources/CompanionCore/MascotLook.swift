// A bot's character and its look, as the desktop stores them with the bot:
// `shared/mascot-look.ts` (owl, shape or Trombi, with each one's skin),
// `shared/mascot-skins.ts` (the owl's special editions), the twelve colours of
// `src/lib/mascot.ts` and the picture framing of `shared/bot-avatar.ts`.
//
// Everything here is cosmetic, so nothing here ever fails a decode: a value
// this build does not understand falls back to what the desktop falls back
// to (the owl, no skin, the centred picture), and the bot still loads.
import CoreGraphics
import Foundation

// MARK: - Colours

/// The twelve Sagax bot colours, `MAUS_COLORS` in `src/lib/mascot.ts`.
public enum MausColors {
    /// In the picker's order.
    public static let names = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "white", "black"]

    public static let hex: [String: String] = [
        "green": "#009957",
        "blue": "#377FE6",
        "red": "#D94B52",
        "orange": "#E78531",
        "purple": "#8057C8",
        "cyan": "#0EA5C6",
        "pink": "#D84F8B",
        "yellow": "#D8A729",
        "teal": "#01A492",
        "coral": "#E5634E",
        "white": "#F4F4F4",
        "black": "#1D1E22",
    ]

    /// `MAUS_INK`: black has no light of its own on a dark surface, so as text
    /// or a tint it reads as a cool slate.
    public static let ink: [String: String] = hex.merging(["black": "#8B93A3"]) { _, new in new }

    /// The hex for a colour name, or the value itself when it already is a
    /// `#RRGGBB` hex, or nil.
    public static func hex(for color: String) -> String? {
        if let named = hex[color] { return named }
        return isHex(color) ? color.uppercased() : nil
    }

    /// The owl's reading of a colour (`MAUS_COLORS[color] ?? color`): any hex
    /// passes through; anything else is green, the default bot.
    public static func owlHex(_ color: String) -> String {
        hex(for: color) ?? hex["green"]!
    }

    static func isHex(_ value: String) -> Bool {
        let chars = Array(value.utf8)
        guard chars.count == 7, chars[0] == UInt8(ascii: "#") else { return false }
        return chars.dropFirst().allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 70) || ($0 >= 97 && $0 <= 102) }
    }
}

/// sRGB in 0...255, the space the desktop's colour maths runs in.
public struct RGB: Equatable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(r: Double, g: Double, b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// `#RGB` or `#RRGGBB`; anything else is black, as `hexToRgb` reads it.
    public init(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard let n = UInt32(h, radix: 16), h.count == 6 else {
            self.init(r: 0, g: 0, b: 0)
            return
        }
        self.init(r: Double((n >> 16) & 255), g: Double((n >> 8) & 255), b: Double(n & 255))
    }

    /// `#RRGGBB`, rounded and clamped, upper case.
    public var hex: String {
        func c(_ v: Double) -> String {
            let byte = Int(min(255, max(0, v.rounded())))
            return String(format: "%02X", byte)
        }
        return "#\(c(r))\(c(g))\(c(b))"
    }
}

// MARK: - Character

public enum MascotCharacter: String, CaseIterable, Codable, Sendable {
    case owl, shape, trombi
}

public enum MascotStyle: String, CaseIterable, Codable, Sendable {
    case flat = "2d"
    case threeD = "3d"
}

/// The original shapes, in the picker's order.
public enum MascotShape: String, CaseIterable, Codable, Sendable {
    case circle, blob, squircle, pill, triangle, hexagon, cloud, drop
}

/// Skins for the original shapes; every one renders on every shape.
public enum ShapeSkin: String, CaseIterable, Codable, Sendable {
    case plain, glossy, outline, neon, pastel, night
}

/// Skins for Trombi.
public enum TrombiSkin: String, CaseIterable, Codable, Sendable {
    case classic, gold, neon, retro98
}

/// `mascotLook`: which character stands for the bot, and that character's
/// own look. Absent or malformed means the owl, exactly as
/// `botMascotLook` reads it: the desktop's schema is strict, so one unknown
/// value or key anywhere throws the whole look away rather than half-keeping it.
public struct MascotLook: Codable, Hashable, Sendable {
    public struct Skins: Codable, Hashable, Sendable {
        public var shape: ShapeSkin?
        public var trombi: TrombiSkin?

        public init(shape: ShapeSkin? = nil, trombi: TrombiSkin? = nil) {
            self.shape = shape
            self.trombi = trombi
        }
    }

    public var character: MascotCharacter
    public var style: MascotStyle?
    public var shape: MascotShape?
    public var skins: Skins?

    /// The owl, what every bot wore before characters existed.
    public static let owl = MascotLook(character: .owl)

    public init(character: MascotCharacter, style: MascotStyle? = nil, shape: MascotShape? = nil, skins: Skins? = nil) {
        self.character = character
        self.style = style
        self.shape = shape
        self.skins = skins
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: Decoder) throws {
        self = (try? Self.strict(decoder)) ?? .owl
    }

    private struct Malformed: Error {}

    /// zod's `.strict()`: the known keys only, each of the right type; an
    /// explicit null is not "absent" to zod either.
    private static func strict(_ decoder: Decoder) throws -> MascotLook {
        let container = try decoder.container(keyedBy: Key.self)
        let allowed: Set<String> = ["character", "style", "shape", "skins"]
        guard container.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else { throw Malformed() }
        func optional<T: Decodable>(_ type: T.Type, _ key: String) throws -> T? {
            let k = Key(key)
            guard container.contains(k) else { return nil }
            if try container.decodeNil(forKey: k) { throw Malformed() }
            return try container.decode(T.self, forKey: k)
        }
        guard let character = try optional(MascotCharacter.self, "character") else { throw Malformed() }
        let style = try optional(MascotStyle.self, "style")
        let shape = try optional(MascotShape.self, "shape")
        var skins: Skins?
        if container.contains(Key("skins")) {
            if try container.decodeNil(forKey: Key("skins")) { throw Malformed() }
            let nested = try container.nestedContainer(keyedBy: Key.self, forKey: Key("skins"))
            guard nested.allKeys.allSatisfy({ $0.stringValue == "shape" || $0.stringValue == "trombi" }) else { throw Malformed() }
            func skin<T: Decodable>(_ type: T.Type, _ key: String) throws -> T? {
                let k = Key(key)
                guard nested.contains(k) else { return nil }
                if try nested.decodeNil(forKey: k) { throw Malformed() }
                return try nested.decode(T.self, forKey: k)
            }
            skins = Skins(shape: try skin(ShapeSkin.self, "shape"), trombi: try skin(TrombiSkin.self, "trombi"))
        }
        return MascotLook(character: character, style: style, shape: shape, skins: skins)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(character, forKey: Key("character"))
        try container.encodeIfPresent(style, forKey: Key("style"))
        try container.encodeIfPresent(shape, forKey: Key("shape"))
        if let skins, skins.shape != nil || skins.trombi != nil {
            var nested = container.nestedContainer(keyedBy: Key.self, forKey: Key("skins"))
            try nested.encodeIfPresent(skins.shape, forKey: Key("shape"))
            try nested.encodeIfPresent(skins.trombi, forKey: Key("trombi"))
        }
    }

    /// `completeMascotLook`: every choice filled in.
    public var complete: CompleteMascotLook {
        CompleteMascotLook(
            character: character,
            style: style ?? .flat,
            shape: shape ?? .circle,
            shapeSkin: skins?.shape ?? .plain,
            trombiSkin: skins?.trombi ?? .classic
        )
    }
}

/// A look with every choice made, what the renderers draw from.
public struct CompleteMascotLook: Hashable, Sendable {
    public var character: MascotCharacter
    public var style: MascotStyle
    public var shape: MascotShape
    public var shapeSkin: ShapeSkin
    public var trombiSkin: TrombiSkin

    public init(character: MascotCharacter, style: MascotStyle = .flat, shape: MascotShape = .circle, shapeSkin: ShapeSkin = .plain, trombiSkin: TrombiSkin = .classic) {
        self.character = character
        self.style = style
        self.shape = shape
        self.shapeSkin = shapeSkin
        self.trombiSkin = trombiSkin
    }

    /// Back to a stored look, every choice explicit (what the editor saves).
    public var stored: MascotLook {
        MascotLook(character: character, style: style, shape: shape, skins: .init(shape: shapeSkin, trombi: trombiSkin))
    }
}

// MARK: - Owl skins

/// `mascotSkin`: the owl's special editions. Missing, legacy or junk values
/// (a number, an object, the wrong case) all wear `none`.
public enum MascotSkin: String, CaseIterable, Codable, Sendable {
    case none, lightning, gold, neon, inferno, frost, carbon

    public init(from decoder: Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = raw.flatMap(Self.init(rawValue:)) ?? .none
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    /// `botMascotSkin`.
    public static func resolve(_ raw: String?) -> MascotSkin {
        raw.flatMap(Self.init(rawValue:)) ?? .none
    }
}

// MARK: - Picture framing

/// `shared/bot-avatar.ts`: how an uploaded picture sits in its crop.
public enum AvatarFraming {
    public static let zoomMin: Double = 1
    public static let zoomMax: Double = 3
    public static let focusCenter: Double = 0.5

    /// `clampAvatarZoom`: 1...3, to the hundredth; missing or non-finite is 1.
    public static func clampZoom(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return zoomMin }
        return (min(zoomMax, max(zoomMin, value)) * 100).rounded() / 100
    }

    /// `clampAvatarFocus`: 0...1, to the thousandth; missing or non-finite is the centre.
    public static func clampFocus(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return focusCenter }
        return (min(1, max(0, value)) * 1000).rounded() / 1000
    }

    /// Where the picture lands in a square box of side `box`: the desktop's
    /// `object-fit: cover` with `object-position: focus`, then
    /// `scale(zoom)` about that same focus point. The box clips the result.
    public static func imageRect(imageSize: CGSize, box: CGFloat, zoom: Double?, focusX: Double?, focusY: Double?) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, box > 0 else {
            return CGRect(x: 0, y: 0, width: box, height: box)
        }
        let z = CGFloat(clampZoom(zoom))
        let fx = CGFloat(clampFocus(focusX)), fy = CGFloat(clampFocus(focusY))
        let cover = max(box / imageSize.width, box / imageSize.height)
        let w = imageSize.width * cover, h = imageSize.height * cover
        let x = (box - w) * fx, y = (box - h) * fy
        let ox = fx * box, oy = fy * box
        return CGRect(x: ox + (x - ox) * z, y: oy + (y - oy) * z, width: w * z, height: h * z)
    }

    /// The crop's corner radius for a box: a circle, 22 %, or square corners.
    public static func cornerRadius(_ crop: AvatarCrop, box: CGFloat) -> CGFloat {
        switch crop {
        case .circle: return box / 2
        case .rounded: return box * 0.22
        case .square, .mascot: return 0
        }
    }
}

// MARK: - States for the characters

/// The app's mascot states (`MausState`, the desktop's 39 engine states and
/// the ten legacy names older bots still carry), as the characters read them.
public enum MascotStates {
    /// The desktop's legacy face names (`LEGACY_STATES` in `src/lib/mascot.ts`).
    public static let legacy: [String: String] = [
        "deadpan": "idle", "friendly": "happy", "focused": "working", "thinking": "thinking",
        "excited": "excited", "sleepy": "drowsy", "surprised": "surprised", "skeptical": "suspicious",
        "worried": "scared", "mischievous": "playful",
    ]

    /// All 39 current states.
    public static let all: Set<String> = [
        "sleeping", "waking", "idle", "listening", "thinking", "searching", "working",
        "excited", "surprised", "suspicious", "angry", "drowsy", "happy", "curious", "confused",
        "bored", "proud", "shy", "sad", "laughing", "scared", "playful", "celebrate",
        "orbit", "radar", "progress",
        "spawning", "humming", "loading", "dictating", "writing", "sending", "receiving",
        "uploading", "notifying", "alerting", "dragging", "bouncing", "powering-down",
    ]

    /// `normalizeState`: a current state, a legacy name, or nil.
    public static func normalize(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        if all.contains(value) { return value }
        return legacy[value]
    }
}

/// `ShapeMood` in `ShapeMascot.tsx`.
public enum ShapeMood: String, CaseIterable, Sendable {
    case idle, thinking, working, happy, sleeping

    /// `shapeMoodFor` in `Avatar.tsx`.
    public static func forState(_ state: String?) -> ShapeMood {
        guard let state else { return .idle }
        if ["thinking", "searching", "loading", "curious", "confused"].contains(state) { return .thinking }
        if ["working", "progress", "orbit", "radar", "writing", "uploading", "sending", "receiving", "dictating", "humming"].contains(state) { return .working }
        if ["happy", "celebrate", "proud", "laughing", "excited", "playful"].contains(state) { return .happy }
        if ["sleeping", "drowsy", "powering-down"].contains(state) { return .sleeping }
        return .idle
    }
}

/// Trombi's poses (`TrombiPose` in `trombi-art.ts`).
public enum TrombiPose: String, CaseIterable, Sendable {
    case idle, speak, think, bored, sleep, celebrate, send

    /// `trombiPoseFor` in `Avatar.tsx`.
    public static func forState(_ state: String?) -> TrombiPose {
        let mood = ShapeMood.forState(state)
        if mood == .thinking || mood == .working { return .think }
        if mood == .happy { return .celebrate }
        if mood == .sleeping { return .sleep }
        if state == "listening" || state == "notifying" { return .speak }
        return .idle
    }
}
