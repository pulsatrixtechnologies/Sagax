// Settings > Appearance > "Use bot color as accent" (src/lib/bot-accent.ts,
// synced as `sagax.botAccent.v1`): while a bot is open, the app's accent
// follows its mascot colour. Off by default; the skin's accent stays when
// no bot is open or the bot has no colour.
//
// A bot colour is chosen for a mascot, not for text: before it becomes the
// accent it is darkened (light skins) or lifted (dark skins) until it holds
// 3:1 as a fill and 4.5:1 as text on the skin's panel, and the text drawn on
// it is white or black, whichever reads (WCAG AA). Same steps as the desktop.
import Foundation

/// The accent family a bot colour gives on one skin.
public struct BotAccentColors: Equatable, Hashable, Sendable {
    /// `--color-accent`, `--color-accent-border` and `--color-focus`.
    public var fill: SkinColor
    /// `--color-accent-text`.
    public var text: SkinColor
    /// `--color-accent-ink`: drawn on the fill.
    public var ink: SkinColor
}

public enum BotAccent {
    /// The synced preference: "1" is on, anything else off.
    public static let key = "sagax.botAccent.v1"

    /// WCAG contrast between two opaque colours (`contrast`).
    static func contrast(_ a: SkinColor, _ b: SkinColor) -> Double {
        let la = a.luminance, lb = b.luminance
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// `holdContrast`: `color` mixed toward black (a light surface) or white
    /// (a dark one) in 40 steps until it holds `ratio` against `surface`.
    public static func holdContrast(_ color: SkinColor, on surface: SkinColor, ratio: Double) -> SkinColor {
        if contrast(color, surface) >= ratio { return color }
        let target: (Double, Double, Double) = surface.luminance > 0.18 ? (0, 0, 0) : (255, 255, 255)
        let from = (color.red * 255, color.green * 255, color.blue * 255)
        func hex(_ r: Double, _ g: Double, _ b: Double) -> SkinColor {
            func c(_ v: Double) -> UInt32 { UInt32(min(255, max(0, v.rounded()))) }
            return SkinColor(c(r) << 16 | c(g) << 8 | c(b))
        }
        for step in 1...40 {
            let t = Double(step) / 40
            let mixed = hex(from.0 + (target.0 - from.0) * t, from.1 + (target.1 - from.1) * t, from.2 + (target.2 - from.2) * t)
            if contrast(mixed, surface) >= ratio { return mixed }
        }
        return hex(target.0, target.1, target.2)
    }

    /// `inkOn`: white or black, whichever reads on `fill`.
    public static func ink(on fill: SkinColor) -> SkinColor {
        contrast(SkinColor(0xFFFFFF), fill) >= contrast(SkinColor(0x000000), fill) ? SkinColor(0xFFFFFF) : SkinColor(0x000000)
    }

    /// `botAccentVars`: the accent for a bot colour on a skin whose panel is
    /// `panel`; nil (keep the skin's accent) when the colour is not one.
    public static func colors(for color: SkinColor?, panel: SkinColor) -> BotAccentColors? {
        guard let color else { return nil }
        let opaque = SkinColor(color.hex)
        let fill = holdContrast(opaque, on: panel, ratio: 3)
        return BotAccentColors(fill: fill, text: holdContrast(opaque, on: panel, ratio: 4.5), ink: ink(on: fill))
    }
}

public extension SkinPalette {
    /// The skin with a bot's colour as its accent (nil colour: unchanged).
    /// `panel` is the skin's `--color-panel` (the phone's inset on its own skins).
    func withBotAccent(_ color: SkinColor?, panel: SkinColor? = nil) -> SkinPalette {
        guard let colors = BotAccent.colors(for: color, panel: panel ?? inset) else { return self }
        var next = self
        next.botAccent = colors
        next.accent = colors.fill
        next.accentText = colors.text
        next.accentInk = colors.ink
        next.focus = colors.fill
        next.caret = colors.fill
        // a filled call to action wears the accent on a desktop skin
        if primaryFill == accent { next.primaryFill = colors.fill; next.primaryInk = colors.ink }
        if toggleOn == accent { next.toggleOn = colors.fill }
        if routineActive == accent { next.routineActive = colors.fill }
        next.attentionBorder = colors.fill.opacity(0.4)
        return next
    }
}
