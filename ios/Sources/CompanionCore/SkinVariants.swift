// Skin variants on the phone (desktop PR #843, src/lib/skin-families.ts): a
// look is a base skin plus an optional TINT (a colour, a duo-tone, a mood or,
// under Hibou 98, a Windows edition), how far a colour reaches (Accent or
// Full) and a light texture over the ground.
//
// Every colour comes from SkinVariantsData.swift, GENERATED from the desktop's
// stylesheets (src/lib/ios-skin-variants-export.test.ts). A tint is laid over
// the base skin's desktop tokens as the CSS lays its block over the base
// block: only the tokens the block declares move (the accent family for a
// colour, every surface for Full and the moods), then the phone places the
// result on its own roles exactly as it does for a base skin
// (`SkinPalette.derived`).
import Foundation

/// What the phone wears: a base skin and its variant choices.
public struct SkinLook: Equatable, Hashable, Sendable {
    public var skin: SkinID
    public var tint: SkinTint?
    public var depth: SkinDepth
    public var texture: SkinTexture

    public init(skin: SkinID, tint: SkinTint? = nil, depth: SkinDepth = .accent, texture: SkinTexture = .none) {
        self.skin = skin
        self.tint = tint
        self.depth = depth
        self.texture = texture
    }

    /// The look as worn: a legacy skin (Graphite, Linen, Dusk, Lagoon) as its
    /// mapped base and colour, a tint the skin's family has no variant for
    /// dropped, Full only on a plain colour, and no texture under Hibou 98
    /// (the desktop's `normalizeWorn` and skin-texture.css).
    public var normalized: SkinLook {
        var out = self
        if let legacy = SkinVariants.legacy[skin.rawValue] {
            out.skin = legacy.skin
            out.tint = legacy.tint
        }
        if let tint = out.tint, !SkinVariants.offers(out.skin, tint) { out.tint = nil }
        if out.depth == .full, out.tint?.group != .color { out.depth = .accent }
        if out.skin == .retro98 { out.texture = .none }
        return out
    }

    /// The key of the generated tables: "skin+tint", "skin+tint+full".
    var key: String? {
        guard let tint else { return nil }
        return "\(skin.rawValue)+\(tint.rawValue)" + (depth == .full ? "+full" : "")
    }

    public var palette: SkinPalette { SkinPalette.of(self) }
}

public extension SkinTint {
    /// The picker row this tint sits in.
    var group: SkinVariantGroup {
        for family in DesktopSkinVariantData.families {
            if let variant = family.variants.first(where: { $0.tint == self }) { return variant.group }
        }
        return .color
    }

    /// English name; the app localizes it.
    var name: String { DesktopSkinVariantData.variantNames[rawValue] ?? rawValue }
}

public extension SkinVariantGroup {
    /// English row label ("Colour", "Duo-tone", "Mood", "Edition").
    var name: String { DesktopSkinVariantData.groupNames[rawValue] ?? rawValue }
}

public extension SkinDepth {
    var name: String { DesktopSkinVariantData.depthNames[rawValue] ?? rawValue }
    static var label: String { DesktopSkinVariantData.depthLabel }
}

public extension SkinTexture {
    var name: String { DesktopSkinVariantData.textureNames[rawValue] ?? rawValue }
    static var label: String { DesktopSkinVariantData.textureLabel }
    /// The texture's layers, as skin-texture.css draws them; empty for none.
    var layers: [SkinTextureLayer] { DesktopSkinVariantData.textures[rawValue] ?? [] }
}

/// Lookups over the generated tables.
public enum SkinVariants {
    /// LEGACY_SKINS, as phone ids (Meadow, which the phone never had, included).
    public static let legacy: [String: (skin: SkinID, tint: SkinTint)] = {
        var out: [String: (skin: SkinID, tint: SkinTint)] = [:]
        for (raw, mapped) in DesktopSkinVariantData.legacy {
            if let skin = SkinID(rawValue: mapped.skin) { out[raw] = (skin, mapped.tint) }
        }
        return out
    }()

    /// The tints each base skin can wear (`tintsBySkin`).
    private static let tintsBySkin: [String: Set<SkinTint>] = {
        var out: [String: Set<SkinTint>] = [:]
        for family in DesktopSkinVariantData.families {
            for variant in family.variants {
                guard let tint = variant.tint else { continue }
                for skin in [variant.light, variant.dark].compactMap({ $0 }) { out[skin, default: []].insert(tint) }
            }
        }
        return out
    }()

    public static func offers(_ skin: SkinID, _ tint: SkinTint) -> Bool {
        tintsBySkin[skin.rawValue]?.contains(tint) == true
    }

    /// A desktop skin id as the phone wears it: a legacy id (Meadow, Graphite…)
    /// mapped to its base and colour, else the phone's own id.
    public static func read(skin raw: String?, tint rawTint: String?) -> (skin: SkinID, tint: SkinTint?)? {
        guard let raw else { return nil }
        if let legacy = legacy[raw] { return (legacy.skin, legacy.tint) }
        guard let skin = SkinID(rawValue: raw) else { return nil }
        return (skin, rawTint.flatMap(SkinTint.init(rawValue:)))
    }

    /// The base skin's desktop tokens with the tint (and Full) block laid over them.
    public static func tokens(_ look: SkinLook) -> [String: String]? {
        guard var raw = DesktopSkins.table[look.skin.rawValue] else { return nil }
        if let tint = look.tint {
            let base = "\(look.skin.rawValue)+\(tint.rawValue)"
            raw.merge(DesktopSkinVariantData.overrides[base] ?? [:]) { $1 }
            if look.depth == .full { raw.merge(DesktopSkinVariantData.overrides[base + "+full"] ?? [:]) { $1 } }
        }
        return raw
    }

    /// The accent's gradient stops (duo-tones and moods), or empty.
    public static func gradient(_ look: SkinLook) -> [SkinColor] {
        guard let tint = look.tint else { return [] }
        return (DesktopSkinVariantData.gradients["\(look.skin.rawValue)+\(tint.rawValue)"] ?? []).compactMap { SkinColor(css: $0) }
    }

    /// The top glow as colour and opacity, when the variant sets its own (nil: the base skin's).
    public static func glow(_ look: SkinLook) -> [(SkinColor, Double)]? {
        guard let key = look.key else { return nil }
        return DesktopSkinVariantData.glows[key]?.compactMap { hex, alpha in SkinColor(css: hex).map { ($0, alpha) } }
    }

    /// The swatch's colour: the variant's own, else the base skin's.
    public static func swatch(skin: SkinID, tint: SkinTint?) -> SkinColor? {
        let key = tint.map { "\(skin.rawValue)+\($0.rawValue)" }
        let hex = key.flatMap { DesktopSkinVariantData.swatches[$0] } ?? DesktopSkinVariantData.baseSwatches[skin.rawValue]
        return hex.flatMap(SkinColor.init(css:))
    }
}

public extension SkinPalette {
    /// A look on the phone: the base skin's palette, or, with a tint, the
    /// desktop's tokens with the tint's block laid over them, placed on the
    /// phone's roles like any desktop skin.
    static func of(_ look: SkinLook) -> SkinPalette {
        let worn = look.normalized
        guard worn.tint != nil, let raw = SkinVariants.tokens(worn), let tokens = DesktopSkins.tokens(from: raw) else {
            var p = of(worn.skin)
            p.texture = worn.texture
            return p
        }
        var p = derived(worn.skin, tokens)
        if worn.skin == .retro98 {
            // A Windows edition, placed as the 98 look is on the phone: the
            // window face (panel) is the ground and the white fields are the
            // cards, in the era's face. The bevels and the teal desktop are
            // the classic look's alone.
            p.typeface = .retro
            p.bg = tokens.panel
            p.desktop = tokens.panel
            p.card = tokens.app
            p.bubbleAssistant = tokens.app
            p.attentionSurface = tokens.app
            p.glassFill = tokens.raised
        }
        p.tint = worn.tint
        p.depth = worn.depth
        p.texture = worn.texture
        p.accentGradient = SkinVariants.gradient(worn)
        return p
    }
}

public extension DesktopSkins {
    /// The tokens of a raw `[name: value]` table (a base block, or one with a tint laid over it).
    static func tokens(from raw: [String: String]) -> DesktopSkinTokens? {
        func c(_ key: String) -> SkinColor {
            var value = raw[key] ?? "#ff00ff"
            if value.hasPrefix("var(--color-"), value.hasSuffix(")") {
                value = raw[String(value.dropFirst("var(--color-".count).dropLast())] ?? "#ff00ff"
            }
            return SkinColor(css: value) ?? SkinColor(0xFF00FF)
        }
        guard raw["app"] != nil else { return nil }
        return DesktopSkinTokens(
            app: c("app"), panel: c("panel"), raised: c("raised"), raisedHover: c("raised-hover"),
            card: c("card"), menu: c("menu"), inset: c("inset"), control: c("control"), hairline: c("hairline"),
            ink: c("ink"), inkSecondary: c("ink-secondary"), inkTertiary: c("ink-tertiary"),
            accent: c("accent"), accentBorder: c("accent-border"), accentText: c("accent-text"),
            focus: c("focus"), accentInk: c("accent-ink"),
            bubbleUser: c("bubble-user"), bubbleUserInk: c("bubble-user-ink"),
            success: c("success"), danger: c("danger"), dangerInk: c("danger-ink"),
            successInk: c("success-ink"), warning: c("warning"), composer: c("composer"),
            unread: c("unread"),
            dark: raw["code-scheme"] == "dark"
        )
    }
}
