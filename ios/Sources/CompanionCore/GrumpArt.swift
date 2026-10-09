// Grump's colours on the phone: a port of `grumpPalette` (src/components/
// grump-art.ts) and of the skins whose palette follows the bot colour
// (`grumpSkinPaint` in skin-fx/grump-skins.tsx: Plain, Void, Neon, Retro 98),
// flattened like `grumpFlatPalette`. The skins with a palette of their own
// come generated in `GrumpStillArt.skinPalettes`; the drawing itself is
// `GrumpStillArt`. Checked against the desktop by
// Fixtures/grump-palettes.json (GrumpArtTests).
import Foundation

public enum GrumpArt {
    /// `GRUMP_DEFAULT_HEX`: the warm brown Grump shows where no bot gives one.
    public static let defaultHex = "#8B5E3C"
    static let cream = "#F4E7CF"
    static let dark = "#2a1a12"
    /// `MASK_DEPTH`, `MASK_MIN_CONTRAST`.
    static let maskDepth = 0.42
    static let maskMinContrast = 2.2

    /// The bot colour's hex (`grumpHexOf`): a name, a hex, else the warm brown.
    public static func hex(_ color: String) -> String {
        MausColors.hex(for: color) ?? defaultHex
    }

    static func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// `grumpCream`: the fur, tinted by the markings.
    public static func furCream(_ mask: String) -> String { ShapeArt.mix(cream, mask, 0.08) }

    /// `grumpMask`: the bot colour deepened like a colourpoint cat's, darker on a light colour so the mask reads.
    public static func mask(_ hex: String) -> String {
        var mask = ShapeArt.mix(hex, dark, maskDepth)
        var k = maskDepth + 0.04
        while k <= 0.8, MascotInk.contrast(mask, furCream(mask)) < maskMinContrast {
            mask = ShapeArt.mix(hex, dark, round2(k))
            k += 0.04
        }
        return mask
    }

    /// `grumpPalette`: the plain palette for a bot colour.
    public static func plain(_ hex: String) -> [GrumpRole: String] {
        let coat = mask(hex)
        let fur = furCream(coat)
        let light = ShapeArt.mix(coat, cream, 0.55)
        return [
            .coat: coat,
            .shade: ShapeArt.mix(coat, "#120a06", 0.3),
            .line: ShapeArt.mix(coat, "#120a06", 0.62),
            .cream: fur,
            .creamShade: ShapeArt.mix("#E2CCA6", coat, 0.14),
            .muzzle: "#FFFCF6",
            .muzzleShade: ShapeArt.mix("#EADFCF", coat, 0.06),
            .blaze: fur,
            .earIn: light,
            .brow: light,
            .lid: coat,
            .white: "#ffffff",
            .iris: "#7DB7E8",
            .pupil: "#22170F",
            .ink: "#22170F",
            .spec: "#ffffff",
            .mouth: "#4A1F1A",
            .tongue: "#F07F86",
            .tongueLine: "#C9545E",
            .fang: "#ffffff",
            .blush: "#F39A8C",
            .sweat: "#9CD3F5",
            .nose: "#C98686",
        ]
    }

    /// `voidGlow`: the bot colour lifted toward white; a dark or dull one glows a cat's yellow green.
    public static func voidGlow(_ hex: String) -> String {
        let glow = ShapeArt.mix(hex, "#ffffff", 0.25)
        return MascotInk.luminance(glow) < 0.3 ? "#D8FF4A" : glow
    }

    /// `vgaColor` (skin-fx/shiba-skins.tsx): each channel snapped to four levels, a 64-colour 98-era display; black and white step inside.
    public static func vgaColor(_ hex: String) -> String {
        let c = RGB(hex: hex)
        func level(_ v: Double) -> Int { Int(min(3, (v / 85).rounded())) * 85 }
        let out = String(format: "#%02x%02x%02x", level(c.r), level(c.g), level(c.b))
        return out == "#000000" ? "#555555" : out == "#ffffff" ? "#aaaaaa" : out
    }

    /// A skin's palette for a bot colour, flattened (the phone draws flat).
    public static func palette(skin: String, hex: String) -> [GrumpRole: String] {
        let base = plain(hex)
        switch skin {
        case "void":
            let glow = voidGlow(hex)
            let rim = ShapeArt.mix(glow, "#121217", 0.62)
            return plain("#121217").merging([
                .coat: "#121217", .shade: "#060608", .line: rim, .cream: "#16161c", .creamShade: "#0b0b0f", .muzzle: "#1d1d25", .muzzleShade: "#121218",
                .blaze: "#16161c", .earIn: "#2a2a34", .brow: "#2a2a34", .lid: "#121217", .white: glow, .iris: ShapeArt.mix(glow, "#ffffff", 0.45),
                .pupil: "#060608", .ink: rim, .spec: "#ffffff", .mouth: "#060608", .tongue: ShapeArt.mix(glow, "#ff5fa2", 0.5), .tongueLine: "#060608", .fang: glow, .nose: "#2a2a34",
            ]) { _, new in new }
        case "neon":
            let tube = ShapeArt.mix(hex, "#ffffff", 0.2)
            let glow = ShapeArt.mix(hex, "#ffffff", 0.45)
            return base.merging([
                .coat: "#07080c", .lid: "#07080c", .shade: "#030305", .line: tube, .cream: "#0d0f15", .creamShade: "#08090d", .muzzle: "#161a26", .muzzleShade: "#10131c",
                .blaze: glow, .earIn: ShapeArt.mix(hex, "#0d0f15", 0.6), .brow: glow, .ink: glow, .iris: glow, .pupil: "#0d0f15", .white: "#eafcff", .mouth: "#07080c", .fang: "#eafcff", .nose: glow, .spec: "#ffffff",
            ]) { _, new in new }
        case "retro98":
            let coat = vgaColor(hex)
            let own = plain(coat)
            return own.merging([
                .coat: coat, .lid: coat, .shade: ShapeArt.mix(coat, "#000000", 0.5), .line: "#000000", .cream: "#c0c0c0", .creamShade: "#c0c0c0", .muzzle: "#ffffff", .muzzleShade: "#c0c0c0",
                .blaze: "#ffffff", .earIn: "#ffffff", .brow: "#ffffff", .iris: "#00ffff", .pupil: "#000000", .ink: "#000000", .mouth: "#800000", .tongue: "#ff00ff", .tongueLine: "#800080", .blush: "#ff00ff", .sweat: "#00ffff", .nose: "#ff00ff",
            ]) { _, new in new }
        case "plain":
            return base
        default:
            return GrumpStillArt.skinPalettes[skin] ?? base
        }
    }
}
