import Foundation

/// The colours of the conversation bubbles (2026-10-28), the same derivation
/// as the desktop's `src/lib/bubble-colors.ts`: the person's own message is
/// filled with the accent, and the text on it reaches 4.5:1; a bot's reply is
/// a neutral grey a step off the page.
///
/// - the text on the accent bubble is white. When the accent cannot carry it
///   its lightness moves (the hue stays) to the nearest one that does; an
///   accent too pale to carry white without a large shift takes dark text;
/// - the grey is neutral in every skin, lighter than a dark page and darker
///   than a light one.
public enum BubbleColors {
    /// WCAG 1.4.3, normal text.
    public static let minimumContrast = 4.5
    /// What the derivation aims at, a little over the minimum.
    private static let target = 4.6
    private static let lightInk = SkinColor(0xFFFFFF)
    private static let darkInk = SkinColor(0x111111)
    /// How far (HSL lightness) an accent may move to carry white before dark text is used.
    private static let maxShift = 0.28

    /// The person's bubble and the text on it, for an accent.
    public static func user(accent: SkinColor) -> (fill: SkinColor, ink: SkinColor) {
        let light = fit(accent, ink: lightInk)
        let dark = fit(accent, ink: darkInk)
        if let light, light.shift <= maxShift || dark == nil || light.shift <= dark!.shift {
            return (light.color, lightInk)
        }
        return (dark?.color ?? accent, darkInk)
    }

    /// The bot's grey: the page's lightness, neutral, a step lighter (dark) or darker (light).
    public static func bot(app: SkinColor, dark: Bool) -> SkinColor {
        let l = hsl(app).l
        let next = dark ? min(1, l + 0.075) : max(0, l - 0.065)
        return fromHSL(0, 0, next)
    }

    private static func fit(_ accent: SkinColor, ink: SkinColor) -> (color: SkinColor, shift: Double)? {
        if ink.contrast(on: accent) >= target { return (accent, 0) }
        let (h, s, l0) = hsl(accent)
        var best: (color: SkinColor, shift: Double)?
        for i in 0...400 {
            let l = Double(i) / 400
            let color = fromHSL(h, s, l)
            guard ink.contrast(on: color) >= target else { continue }
            let shift = abs(l - l0)
            if best == nil || shift < best!.shift { best = (color, shift) }
        }
        return best
    }

    private static func hsl(_ c: SkinColor) -> (h: Double, s: Double, l: Double) {
        let (r, g, b) = (c.red, c.green, c.blue)
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        if mx == mn { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        if mx == r { h = (g - b) / d + (g < b ? 6 : 0) }
        else if mx == g { h = (b - r) / d + 2 }
        else { h = (r - g) / d + 4 }
        h /= 6
        return (h, s, l)
    }

    private static func fromHSL(_ h: Double, _ s: Double, _ l: Double) -> SkinColor {
        func byte(_ v: Double) -> UInt32 { UInt32(min(255, max(0, (v * 255).rounded()))) }
        if s == 0 { let v = byte(l); return SkinColor(v << 16 | v << 8 | v) }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        func channel(_ t: Double) -> Double {
            let u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
            if u < 1.0 / 6 { return p + (q - p) * 6 * u }
            if u < 1.0 / 2 { return q }
            if u < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - u) * 6 }
            return p
        }
        return SkinColor(byte(channel(h + 1.0 / 3)) << 16 | byte(channel(h)) << 8 | byte(channel(h - 1.0 / 3)))
    }
}

public extension SkinPalette {
    /// This palette with the bubbles drawn from its accent and its page.
    func bubbled() -> SkinPalette {
        var p = self
        let user = BubbleColors.user(accent: accent)
        p.bubbleUser = user.fill
        p.bubbleUserText = user.ink
        p.bubbleAssistant = BubbleColors.bot(app: bg, dark: isDark)
        p.bubbleAssistantText = textPrimary
        return p
    }
}
