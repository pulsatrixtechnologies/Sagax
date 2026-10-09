// Ogre, the big green ogre: how the phone colours it and which face it
// wears, a port of `ogrePalette` (src/components/ogre-art.ts), the skins'
// own colours (`ogreSkinPaint` in skin-fx/ogre-skins.tsx, generated into
// `OgreStillArt.skins`) and `ogreExpressionFor` (Avatar.tsx). The drawing
// itself is `OgreStillArt`, generated from the desktop's art.
import Foundation

public enum OgreArt {
    /// The archetype's green, its vest and its tunic.
    public static let skin = "#9DBE4A"
    public static let vest = "#7A5232"
    public static let tunic = "#F1E6CB"
    /// How much of the bot colour the green skin takes (`SKIN_TINT`).
    public static let skinTint = 0.24
    /// How far the vest leans toward brown leather (`VEST_LEATHER`).
    public static let vestLeather = 0.42
    /// The least contrast between the vest and the tunic (`VEST_MIN_CONTRAST`).
    public static let vestMinContrast = 1.6

    /// The colour Ogre shows where no bot gives one (`OGRE_DEFAULT_COLOR`): green.
    public static func hex(_ color: String) -> String {
        MausColors.hex(for: color) ?? MausColors.hex(for: "green") ?? "#009957"
    }

    // MARK: colours

    static func hsl(_ hex: String) -> (h: Double, s: Double, l: Double) {
        let c = RGB(hex: hex)
        let r = c.r / 255, g = c.g / 255, b = c.b / 255
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        let d = mx - mn
        if d == 0 { return (0, 0, l) }
        let s = d / (1 - abs(2 * l - 1))
        var h: Double
        if mx == r { h = ((g - b) / d + 6).truncatingRemainder(dividingBy: 6) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
        h *= 60
        return (h, s, l)
    }

    static func fromHsl(_ h: Double, _ s: Double, _ l: Double) -> String {
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        let (r, g, b): (Double, Double, Double) = h < 60 ? (c, x, 0) : h < 120 ? (x, c, 0) : h < 180 ? (0, c, x) : h < 240 ? (0, x, c) : h < 300 ? (x, 0, c) : (c, 0, x)
        func ch(_ v: Double) -> Double { (min(1, max(0, v + m)) * 255).rounded() }
        return RGB(r: ch(r), g: ch(g), b: ch(b)).hex
    }

    /// `tintColor`: a base tone tinted by a colour; the hue and lightness move, the saturation stays the base's.
    public static func tint(_ base: String, _ color: String, _ t: Double) -> String {
        let m = hsl(ShapeArt.mix(base, color, t))
        let b = hsl(base)
        return fromHsl(m.h, max(m.s, b.s * 0.92), (m.l + b.l) / 2)
    }

    /// `ogreSkin`: the green a quarter toward the bot colour.
    public static func skin(for hex: String?) -> String {
        guard let hex else { return skin }
        return tint(skin, hex, skinTint)
    }

    /// `ogreVest`: the bot colour as leather, darkened until the tunic reads.
    public static func vest(for hex: String?) -> String {
        guard let hex else { return vest }
        let base = ShapeArt.mix(hex, "#3a2410", vestLeather)
        var vest = base
        var k = 0.04
        while k <= 0.7 && MascotInk.contrast(vest, tunic) < vestMinContrast {
            vest = ShapeArt.mix(base, "#1a1008", (k * 100).rounded() / 100)
            k += 0.04
        }
        return vest
    }

    /// `ogrePalette`: every paint role for a bot colour (nil: the archetype's).
    public static func palette(hex: String?, skin skinOverride: String? = nil, vest vestOverride: String? = nil) -> [String: String] {
        let skin = skinOverride ?? skin(for: hex)
        let vest = vestOverride ?? vest(for: hex)
        let skinDark = ShapeArt.mix(skin, "#14200a", 0.52)
        return [
            "skin": skin,
            "skinShade": ShapeArt.mix(skin, "#1f3a10", 0.3),
            "line": ShapeArt.mix(skin, "#14200a", 0.74),
            "earIn": skinDark,
            "brow": skinDark,
            "lid": skin,
            "tunic": tunic,
            "tunicShade": ShapeArt.mix("#E2D0A8", vest, 0.12),
            "vest": vest,
            "vestShade": ShapeArt.mix(vest, "#1a0e06", 0.28),
            "pants": "#4E3A2A",
            "boot": "#2E2219",
            "buckle": "#D9B45A",
            "ink": "#22180F",
            "pupil": "#22180F",
            "white": "#FFFFFF",
            "spec": "#FFFFFF",
            "mouth": "#4A1F1A",
            "tongue": "#F07F86",
            "teeth": "#FFF8E6",
            "blush": "#E9877A",
            "sweat": "#9CD3F5",
            "nostril": "#22180F",
            "log": "#8A5A34",
            "logShade": "#5E3B20",
            "logEnd": "#D9B27C",
            "mark": skinDark,
        ]
    }

    /// A skin's palette and marks: the plain palette for the bot colour, under the skin's own colours.
    public static func paint(_ skin: OgreSkin, hex: String) -> (palette: [String: String], marks: String?) {
        let own = OgreStillArt.skins[skin.rawValue] ?? (colors: [:], marks: nil)
        var palette = palette(hex: hex, skin: own.colors["skin"], vest: own.colors["vest"])
        for (role, color) in own.colors { palette[role] = color }
        return (palette, own.marks)
    }

    // MARK: faces

    /// `ogreExpressionFor`: the app's mascot states, as the sixteen faces.
    public static func expression(for state: String) -> String {
        switch state {
        case "sleeping", "drowsy", "powering-down": return "sleepy"
        case "thinking", "searching", "loading", "curious": return "curious"
        case "listening", "dictating", "waking", "working", "progress", "orbit", "radar", "writing", "uploading", "sending", "receiving", "humming": return "attentive"
        case "excited", "celebrate", "playful", "bouncing": return "excited"
        case "surprised", "alerting", "notifying": return "surprised"
        case "happy", "suspicious", "angry", "confused", "bored", "proud", "shy", "sad", "laughing", "scared": return state
        default: return "neutral"
        }
    }

    // MARK: geometry

    /// The bust crop under 48 points (`OGRE_BUST`).
    public static let bust = (x: 5.0, y: 12.0, w: 90.0, h: 90.0)
    public static let bustMax = 48.0

    /// `ogreOutline`: 1.9 units, never under 1.6 points on screen.
    public static func outline(size: Double) -> Double {
        let box = size <= bustMax ? bust.w : 100
        return (max(1.9, 1.6 * box / max(1, size)) * 100).rounded() / 100
    }

    /// The operations of the still drawing for a face, in paint order (body, ears, head, face, extras).
    public static func ops(expression: String, size: Double, marks: String?) -> [OgreStillArt.Op] {
        let parts = OgreStillArt.parts[marks ?? "plain"] ?? OgreStillArt.parts["plain"] ?? [:]
        let face = OgreStillArt.faces[expression] ?? OgreStillArt.faces["neutral"]
        var ops: [OgreStillArt.Op] = []
        for key in ["body", "earL", "earR", "head"] { ops += parts[key] ?? [] }
        if let face { ops += face.brows + face.eyeL + face.eyeR }
        ops += parts["nose"] ?? []
        if let face { ops += face.mouth + (size <= bustMax ? face.bustExtras : face.extras) }
        return ops
    }
}
