// iPad I1: the desktop's tokens per skin, for the desktop shell
// (docs/superpowers/specs/2026-10-02-ipad-desktop-parity-design.md, "Skins
// and tokens").
//
// The colour set is the desktop's own (`src/styles.css`, one `[data-skin]`
// block each): the shared part comes from CompanionCore's `DesktopSkins`
// table, the sidebar, hover and glow tokens below were read from the DOM
// dumps (`ios/parity/desktop/refs/desktop-*-03-main*.json`, `tokens`). The
// phone's own Black and Dim have no desktop twin: they are placed on the
// same roles from their phone palette, so every skin the Appearance picker
// offers dresses the desktop shell.
//
// Fonts: Pulsatrix and Pulsatrix Light set Geist Variable (OFL-1.1, bundled:
// Desktop/Fonts). Inter is not bundled: those skins read as the system face,
// as on the phone. Hibou 98 uses Verdana for Tahoma.
import SwiftUI
import UIKit
import CoreText
import CompanionCore

struct DesktopTheme: Equatable {
    enum Face: Equatable { case geist, system, retro }

    var skin: SkinID
    var dark: Bool

    // surfaces
    var app, panel, raised, raisedHover, card, menu, inset, control, composer: Color
    var sidebar, sidebarInk, sidebarInkSecondary, sidebarHover, sidebarSelected, sidebarHairline: Color
    var hairline: Color
    /// The composer's outer ring (Daylight, Hibou 98); clear elsewhere.
    var composerRing: Color

    // ink and accents
    var ink, inkSecondary, inkTertiary: Color
    var accent, accentBorder, accentText, focus, accentInk: Color
    var bubbleUser, bubbleUserInk: Color
    var success, danger, warning: Color

    /// `color-mix` of ink (src/styles.css:203-217), as alpha over the surface.
    var hairlineWeak: Color { ink.opacity(0.10) }
    var border: Color { ink.opacity(0.15) }
    var borderStrong: Color { ink.opacity(0.30) }
    /// `--color-elevated`: 3 % ink into panel.
    var elevated: Color
    /// `--color-hover` and `--color-selected` (the same on every skin).
    var hover: Color { Color(.sRGB, red: 0x77 / 255, green: 0x77 / 255, blue: 0x77 / 255, opacity: 0x2c / 255) }
    var selected: Color { Color(.sRGB, red: 0x77 / 255, green: 0x77 / 255, blue: 0x77 / 255, opacity: 0x52 / 255) }
    /// Tabs' selected fill (`elevated-hover`): about 10 % ink into the card.
    var elevatedHover: Color { ink.opacity(0.10) }
    /// Floating chat chrome (header pill, round buttons): the card, a hairline ring.
    var chrome: Color { card }

    /// The two radial accent glows from the top of the chat (`--app-glow`),
    /// as the accent's opacity in each; zero where the skin has none.
    var glow: (Double, Double)

    var radiusLg: CGFloat
    var radiusXl: CGFloat
    var face: Face

    static func == (a: DesktopTheme, b: DesktopTheme) -> Bool { a.skin == b.skin }

    // MARK: Fonts

    /// The skin's face at a desktop size. Sizes are fixed (the desktop's
    /// metrics), not Dynamic Type.
    func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        switch face {
        case .geist: return DesktopFonts.geist(size, weight)
        case .system: return .system(size: size, weight: weight)
        case .retro:
            let bold = weight == .semibold || weight == .bold || weight == .heavy || weight == .black
            return .custom(bold ? "Verdana-Bold" : "Verdana", fixedSize: size * 0.9)
        }
    }

    // MARK: Per skin

    static func of(_ skin: SkinID) -> DesktopTheme {
        if let tokens = DesktopSkins.tokens(skin), let extra = extras[skin] {
            return DesktopTheme(skin: skin, tokens: tokens, extra: extra)
        }
        return phone(skin.palette)
    }

    /// What the shared table does not hold: sidebar, ring, glow, radii, face.
    private struct Extra {
        var sidebar, sidebarInk, sidebarInkSecondary, sidebarHover, sidebarSelected, sidebarHairline: String
        var composerRing: String?
        var glow: (Double, Double) = (0, 0)
        var radii: (CGFloat, CGFloat)
        var face: Face
    }

    private static let extras: [SkinID: Extra] = [
        .pulsatrix: Extra(sidebar: "#060f20", sidebarInk: "#eef2fb", sidebarInkSecondary: "#9aa6c2", sidebarHover: "#eef2fb0d",
                          sidebarSelected: "#4f86f729", sidebarHairline: "#223353", glow: (0.16, 0.09), radii: (8, 12), face: .geist),
        .pulsatrixLight: Extra(sidebar: "#24324d", sidebarInk: "#eef2fb", sidebarInkSecondary: "#c3cce0", sidebarHover: "#eef2fb12",
                               sidebarSelected: "#6b9bff38", sidebarHairline: "#41526f", glow: (0.08, 0.05), radii: (8, 12), face: .geist),
        .midnight: Extra(sidebar: "#111111", sidebarInk: "#fcfcfc", sidebarInkSecondary: "#fcfcfc99", sidebarHover: "#7777772c",
                         sidebarSelected: "#77777752", sidebarHairline: "#363636", radii: (8, 12), face: .system),
        .atelier: Extra(sidebar: "#fbf8f2", sidebarInk: "#1a1a18", sidebarInkSecondary: "#6b6559", sidebarHover: "#7777772c",
                        sidebarSelected: "#77777752", sidebarHairline: "#c8bda8", radii: (6, 10), face: .system),
        .foundry: Extra(sidebar: "#171410", sidebarInk: "#f4efe4", sidebarInkSecondary: "#b0a696", sidebarHover: "#7777772c",
                        sidebarSelected: "#77777752", sidebarHairline: "#3d3529", radii: (4, 8), face: .system),
        .lagoon: Extra(sidebar: "#ecf4f3", sidebarInk: "#14201f", sidebarInkSecondary: "#4d5c5b", sidebarHover: "#7777772c",
                       sidebarSelected: "#77777752", sidebarHairline: "#aebfbd", radii: (8, 14), face: .system),
        .graphite: Extra(sidebar: "#181a1d", sidebarInk: "#f2f4f7", sidebarInkSecondary: "#b3b8c2", sidebarHover: "#7777772c",
                         sidebarSelected: "#77777752", sidebarHairline: "#3b4048", radii: (6, 10), face: .system),
        .linen: Extra(sidebar: "#f5f6f8", sidebarInk: "#1d2229", sidebarInkSecondary: "#59616c", sidebarHover: "#7777772c",
                      sidebarSelected: "#77777752", sidebarHairline: "#b4bbc5", radii: (8, 12), face: .system),
        .dusk: Extra(sidebar: "#19161c", sidebarInk: "#f4eff6", sidebarInkSecondary: "#b9afbd", sidebarHover: "#7777772c",
                     sidebarSelected: "#77777752", sidebarHairline: "#403847", radii: (8, 12), face: .system),
        .daylight: Extra(sidebar: "#f7f7f7", sidebarInk: "#0d0d0d", sidebarInkSecondary: "#575757", sidebarHover: "#7777772c",
                         sidebarSelected: "#77777752", sidebarHairline: "#c8c8c8", composerRing: "#e4e4e4", radii: (8, 14), face: .system),
        .retro98: Extra(sidebar: "#c0c0c0", sidebarInk: "#000000", sidebarInkSecondary: "#3c3c3c", sidebarHover: "#00008014",
                        sidebarSelected: "#00008033", sidebarHairline: "#808080", composerRing: "#808080", radii: (0, 0), face: .retro),
    ]

    private init(skin: SkinID, tokens t: DesktopSkinTokens, extra e: Extra) {
        func css(_ value: String) -> Color { (SkinColor(css: value) ?? SkinColor(0xFF00FF)).color }
        self.skin = skin
        dark = t.dark
        app = t.app.color; panel = t.panel.color; raised = t.raised.color; raisedHover = t.raisedHover.color
        card = t.card.color; menu = t.menu.color; inset = t.inset.color; control = t.control.color; composer = t.composer.color
        sidebar = css(e.sidebar); sidebarInk = css(e.sidebarInk); sidebarInkSecondary = css(e.sidebarInkSecondary)
        sidebarHover = css(e.sidebarHover); sidebarSelected = css(e.sidebarSelected); sidebarHairline = css(e.sidebarHairline)
        hairline = t.hairline.color
        composerRing = e.composerRing.map(css) ?? .clear
        ink = t.ink.color; inkSecondary = t.inkSecondary.color; inkTertiary = t.inkTertiary.color
        accent = t.accent.color; accentBorder = t.accentBorder.color; accentText = t.accentText.color
        focus = t.focus.color; accentInk = t.accentInk.color
        bubbleUser = t.bubbleUser.color; bubbleUserInk = t.bubbleUserInk.color
        success = t.success.color; danger = t.danger.color; warning = t.warning.color
        elevated = t.ink.opacity(0.03).over(t.panel).color
        glow = e.glow
        radiusLg = e.radii.0
        radiusXl = e.radii.1
        face = e.face
    }

    /// Black and Dim: the phone palette placed on the desktop roles.
    private static func phone(_ p: SkinPalette) -> DesktopTheme {
        DesktopTheme(
            skin: p.id, dark: p.isDark,
            app: p.bg.color, panel: p.inset.color, raised: p.cardRaised.color, raisedHover: p.menuGlass.color,
            card: p.card.color, menu: p.menuGlass.color, inset: p.inset.color, control: p.cardRaised.color,
            composer: p.card.color,
            sidebar: p.inset.color, sidebarInk: p.textPrimary.color, sidebarInkSecondary: p.textSecondary.color,
            sidebarHover: p.textPrimary.opacity(0.05).color, sidebarSelected: p.textPrimary.opacity(0.10).color,
            sidebarHairline: p.hairline.color,
            hairline: p.hairline.color, composerRing: .clear,
            ink: p.textPrimary.color, inkSecondary: p.textSecondary.color, inkTertiary: p.textTertiary.color,
            accent: p.accent.color, accentBorder: p.accent.color, accentText: p.accentText.color,
            focus: p.focus.color, accentInk: p.accentInk.color,
            bubbleUser: p.bubbleUser.color, bubbleUserInk: p.bubbleUserText.color,
            success: p.success.color, danger: p.danger.color, warning: p.warning.color,
            elevated: p.textPrimary.opacity(0.03).over(p.inset).color,
            glow: (0, 0), radiusLg: 8, radiusXl: 12, face: .system
        )
    }

    private init(
        skin: SkinID, dark: Bool,
        app: Color, panel: Color, raised: Color, raisedHover: Color, card: Color, menu: Color, inset: Color,
        control: Color, composer: Color,
        sidebar: Color, sidebarInk: Color, sidebarInkSecondary: Color, sidebarHover: Color, sidebarSelected: Color,
        sidebarHairline: Color, hairline: Color, composerRing: Color,
        ink: Color, inkSecondary: Color, inkTertiary: Color,
        accent: Color, accentBorder: Color, accentText: Color, focus: Color, accentInk: Color,
        bubbleUser: Color, bubbleUserInk: Color, success: Color, danger: Color, warning: Color,
        elevated: Color, glow: (Double, Double), radiusLg: CGFloat, radiusXl: CGFloat, face: Face
    ) {
        self.skin = skin; self.dark = dark
        self.app = app; self.panel = panel; self.raised = raised; self.raisedHover = raisedHover
        self.card = card; self.menu = menu; self.inset = inset; self.control = control; self.composer = composer
        self.sidebar = sidebar; self.sidebarInk = sidebarInk; self.sidebarInkSecondary = sidebarInkSecondary
        self.sidebarHover = sidebarHover; self.sidebarSelected = sidebarSelected; self.sidebarHairline = sidebarHairline
        self.hairline = hairline; self.composerRing = composerRing
        self.ink = ink; self.inkSecondary = inkSecondary; self.inkTertiary = inkTertiary
        self.accent = accent; self.accentBorder = accentBorder; self.accentText = accentText
        self.focus = focus; self.accentInk = accentInk
        self.bubbleUser = bubbleUser; self.bubbleUserInk = bubbleUserInk
        self.success = success; self.danger = danger; self.warning = warning
        self.elevated = elevated; self.glow = glow
        self.radiusLg = radiusLg; self.radiusXl = radiusXl; self.face = face
    }
}

// MARK: - Environment

private struct DesktopThemeKey: EnvironmentKey {
    static let defaultValue = DesktopTheme.of(.pulsatrix)
}

extension EnvironmentValues {
    /// The desktop shell's tokens (set by `DesktopShell` from the active skin).
    var desktopTheme: DesktopTheme {
        get { self[DesktopThemeKey.self] }
        set { self[DesktopThemeKey.self] = newValue }
    }
}

// MARK: - Geist

/// Geist Variable, bundled (Desktop/Fonts/Geist-Variable.ttf, the Latin
/// subset of `@fontsource-variable/geist` 5.3.0 as TrueType; OFL-1.1 beside
/// it). Registered for the process on first use; each weight is the `wght`
/// axis set on a descriptor, so 500 is the font's real medium.
enum DesktopFonts {
    private static let registered: Bool = {
        guard let url = Bundle.main.url(forResource: "Geist-Variable", withExtension: "ttf") else { return false }
        var error: Unmanaged<CFError>?
        let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        // already registered (a second scene) is fine
        return ok || UIFont(name: "Geist-Regular", size: 12) != nil
    }()

    /// True when the bundled face is available.
    static var available: Bool { registered }

    private static var cache: [String: Font] = [:]

    static func geist(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        guard registered else { return .system(size: size, weight: weight) }
        let value = wght(weight)
        let key = "\(size)-\(value)"
        if let font = cache[key] { return font }
        let variation = UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String)
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: "Geist-Regular",
            variation: [0x7767_6874 as NSNumber: value as NSNumber],
        ])
        let font = Font(UIFont(descriptor: descriptor, size: size) as CTFont)
        cache[key] = font
        return font
    }

    /// CSS weight for a SwiftUI weight.
    static func wght(_ weight: Font.Weight) -> Double {
        switch weight {
        case .ultraLight: 200
        case .thin: 100
        case .light: 300
        case .medium: 500
        case .semibold: 600
        case .bold: 700
        case .heavy: 800
        case .black: 900
        default: 400
        }
    }
}
