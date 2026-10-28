// The switch's colours on the phone, the same rules as the desktop's
// src/lib/switch-colors.ts (2026-10-28): a white knob in both states, the
// accent for on and a neutral grey for off, each at a lightness that holds
// 3:1 against the knob and against every surface a switch sits on (WCAG
// 1.4.11). When no lightness clears both, the track keeps the knob's
// contrast and a contrasting edge carries the surface's. The knob's
// position, not the colour, says on or off.
import Foundation

public struct SwitchColors: Equatable, Sendable {
    public var on: SkinColor
    public var off: SkinColor
    /// The on track's outline, nil when the track clears 3:1 by itself.
    public var onEdge: SkinColor?
    public var offEdge: SkinColor?
    public var knob: SkinColor { SwitchContrast.knob }
}

public enum SwitchContrast {
    public static let knob = SkinColor(0xFFFFFF)
    public static let minimum = 3.0
    /// A little over the minimum so an 8-bit channel never rounds below it.
    static let target = 3.1

    enum Pick { case closest, lightest, darkest }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [String: SwitchColors] = [:]

    /// Memoised: a view reads the switch's colours on every render.
    public static func colors(accent: SkinColor, ink: SkinColor, surfaces: [SkinColor], dark: Bool) -> SwitchColors {
        let key = ([accent, ink] + surfaces).map { "\($0.hex):\($0.alpha)" }.joined(separator: ",") + (dark ? "d" : "l")
        lock.lock()
        if let hit = cache[key] { lock.unlock(); return hit }
        lock.unlock()
        let value = derive(accent: accent, ink: ink, surfaces: surfaces, dark: dark)
        lock.lock()
        cache[key] = value
        lock.unlock()
        return value
    }

    static func derive(accent: SkinColor, ink: SkinColor, surfaces: [SkinColor], dark: Bool) -> SwitchColors {
        let grounds = surfaces.map { $0.alpha < 1 ? $0.over(SkinColor(dark ? 0x000000 : 0xFFFFFF)) : $0 }
        let inkOpaque = SkinColor(ink.hex)
        let on = fit(SkinColor(accent.hex), ink: inkOpaque, grounds: grounds, pick: .closest, saturation: nil)
        let off = fit(inkOpaque, ink: inkOpaque, grounds: grounds, pick: dark ? .darkest : .lightest, saturation: 0.12)
        return SwitchColors(on: on.track, off: off.track, onEdge: on.edge, offEdge: off.edge)
    }

    /// Each pair a switch shows: the knob on each track, and each track's
    /// outline (its edge, else the track) on the worst surface.
    public static func contrasts(_ c: SwitchColors, surfaces: [SkinColor]) -> (knobOn: Double, knobOff: Double, onGround: Double, offGround: Double) {
        func ground(_ track: SkinColor, _ edge: SkinColor?) -> Double {
            surfaces.map { (edge ?? track).contrast(on: $0) }.min() ?? 21
        }
        return (knob.contrast(on: c.on), knob.contrast(on: c.off), ground(c.on, c.onEdge), ground(c.off, c.offEdge))
    }

    // MARK: - Derivation

    static func ratio(_ a: SkinColor, _ b: SkinColor) -> Double { a.contrast(on: b) }

    static func minOver(_ c: SkinColor, _ grounds: [SkinColor]) -> Double {
        grounds.map { ratio(c, $0) }.min() ?? 21
    }

    static func fit(_ base: SkinColor, ink: SkinColor, grounds: [SkinColor], pick: Pick, saturation: Double?) -> (track: SkinColor, edge: SkinColor?) {
        let (h, s0, l0) = hsl(base)
        let s = saturation.map { min(s0, $0) } ?? s0
        let steps = (0...400).map { i -> (l: Double, c: SkinColor) in
            let l = Double(i) / 400
            return (l, color(h, s, l))
        }
        let carries = steps.filter { ratio(knob, $0.c) >= target }
        let clears = carries.filter { minOver($0.c, grounds) >= target }
        func choose(_ list: [(l: Double, c: SkinColor)]) -> SkinColor {
            switch pick {
            case .lightest: return list.last!.c
            case .darkest: return list.first!.c
            case .closest: return list.min { abs($0.l - l0) < abs($1.l - l0) }!.c
            }
        }
        if !clears.isEmpty {
            if pick == .closest, ratio(knob, base) >= target, minOver(base, grounds) >= target { return (base, nil) }
            return (choose(clears), nil)
        }
        let track = carries.isEmpty ? SkinColor(0x000000) : choose(carries)
        return (track, edge(track, ink: ink, grounds: grounds))
    }

    static func edge(_ track: SkinColor, ink: SkinColor, grounds: [SkinColor]) -> SkinColor {
        for i in 1...20 {
            let mixed = ink.opacity(Double(i) / 20).over(track)
            if minOver(mixed, grounds) >= target { return mixed }
        }
        let black = SkinColor(0x000000), white = SkinColor(0xFFFFFF)
        return minOver(black, grounds) >= minOver(white, grounds) ? black : white
    }

    static func hsl(_ c: SkinColor) -> (Double, Double, Double) {
        let r = c.red, g = c.green, b = c.blue
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        guard mx != mn else { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        if mx == r { h = (g - b) / d + (g < b ? 6 : 0) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
        h /= 6
        return (h, s, l)
    }

    static func color(_ h: Double, _ s: Double, _ l: Double) -> SkinColor {
        func byte(_ v: Double) -> UInt32 { UInt32(max(0, min(255, (v * 255).rounded()))) }
        guard s > 0 else { let v = byte(l); return SkinColor(v << 16 | v << 8 | v) }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        func hue(_ t0: Double) -> Double {
            var t = t0
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1.0 / 6 { return p + (q - p) * 6 * t }
            if t < 1.0 / 2 { return q }
            if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
            return p
        }
        return SkinColor(byte(hue(h + 1.0 / 3)) << 16 | byte(hue(h)) << 8 | byte(hue(h - 1.0 / 3)))
    }
}

public extension SkinPalette {
    /// The surfaces a switch is drawn on: the page, cards, raised rows, the inset and the menus.
    var switchSurfaces: [SkinColor] { [bg, card, cardRaised, inset, menuGlass] }

    /// The switch's colours on this palette, from its accent track (a bot's
    /// colour included) and its ink.
    var switchColors: SwitchColors {
        SwitchContrast.colors(accent: toggleOn, ink: textPrimary, surfaces: switchSurfaces, dark: isDark)
    }
}
