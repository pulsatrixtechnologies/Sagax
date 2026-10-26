// Skin families on the phone, the desktop's model (src/lib/skin-families.ts,
// 2026-10-19): the skins that only differed by a tint or by light and
// dark are the variants of one family, chosen with a swatch, and the mode
// is Light, Dark or Auto (follows the phone).
//
// Nothing stored moved: a ThemeSelection keeps its mode and skins. A family,
// a variant and a mode are read from it, and a choice writes it back:
// Auto is `.system` with the variant's light and dark skins, Light or Dark
// is `.fixed` with one of them. A pair saved before (Pulsatrix Light by day,
// Black at night, say) still wears the same skins until the person picks
// again in the new picker.
import Foundation

public enum SkinScheme: String, CaseIterable, Sendable {
    case light, dark
}

/// What the person picked: one scheme, or Auto (follow the phone).
public enum SkinModeChoice: String, CaseIterable, Identifiable, Sendable {
    case light, dark, auto
    public var id: String { rawValue }
}

public struct SkinVariant: Equatable, Hashable, Identifiable, Sendable {
    /// The desktop's variant id (`basic`, `red`, `aurore`, `xp`…), or the phone's own (`black`, `dim`).
    public let id: String
    /// English name; the app localizes it.
    public let name: String
    public let light: SkinID?
    public let dark: SkinID?
    /// Laid over the skin; nil on the family's own look.
    public let tint: SkinTint?
    /// The picker row it sits in.
    public let group: SkinVariantGroup

    public init(id: String, name: String, light: SkinID?, dark: SkinID?, tint: SkinTint? = nil, group: SkinVariantGroup = .color) {
        self.id = id
        self.name = name
        self.light = light
        self.dark = dark
        self.tint = tint
        self.group = group
    }

    public var schemes: [SkinScheme] {
        var out: [SkinScheme] = []
        if light != nil { out.append(.light) }
        if dark != nil { out.append(.dark) }
        return out
    }

    /// True when the variant has a light and a dark skin, so Auto can follow the phone.
    public var followsSystem: Bool { light != nil && dark != nil }

    /// Intensity (Accent or Full) reaches the plain colours only; the moods and duo-tones colour everything already.
    public var hasDepth: Bool { group == .color && tint != nil }

    /// The variant's skin for a scheme, or the one scheme it has.
    public func skin(_ scheme: SkinScheme) -> SkinID {
        // every variant declares at least one (SkinFamiliesTests)
        (scheme == .light ? light : dark) ?? light ?? dark ?? .black
    }

    /// The variant's look in a scheme, with this phone's intensity and texture.
    public func look(_ scheme: SkinScheme, depth: SkinDepth = .accent, texture: SkinTexture = .none) -> SkinLook {
        SkinLook(skin: skin(scheme), tint: tint, depth: hasDepth ? depth : .accent, texture: texture).normalized
    }
}

public enum SkinFamilyID: String, CaseIterable, Identifiable, Sendable {
    case phone, pulsatrix, studio, atelier, retro98
    public var id: String { rawValue }
}

public struct SkinFamily: Equatable, Identifiable, Sendable {
    public let id: SkinFamilyID
    public let name: String
    /// One line, English; the app localizes it.
    public let tagline: String
    public let variants: [SkinVariant]
    /// Hibou 98: listed only while worn (the computer's choice or the
    /// composer's hidden line); the phone never offers it for itself.
    public var secret: Bool { id == .retro98 }

    /// The phone's families: the phone's own Black and Dim, then the
    /// desktop's families with every variant (SkinVariantsData.swift,
    /// generated from src/lib/skin-families.ts): its own look, the colours,
    /// the duo-tones and the moods, and Hibou 98's Windows editions.
    public static let all: [SkinFamily] = {
        let phone = SkinFamily(
            id: .phone, name: "Black", tagline: "The phone's own look. Near-black, quiet greys.",
            variants: [
                SkinVariant(id: "black", name: "Black", light: nil, dark: .black),
                SkinVariant(id: "dim", name: "Dim", light: nil, dark: .dim),
            ]
        )
        let desktop = DesktopSkinVariantData.families.compactMap { family -> SkinFamily? in
            guard let id = SkinFamilyID(rawValue: family.id) else { return nil }
            let variants = family.variants.map { v in
                SkinVariant(
                    id: v.id, name: DesktopSkinVariantData.variantNames[v.id] ?? v.id,
                    light: v.light.flatMap(SkinID.init(rawValue:)), dark: v.dark.flatMap(SkinID.init(rawValue:)),
                    tint: v.tint, group: v.group
                )
            }
            return SkinFamily(id: id, name: family.name, tagline: family.tagline, variants: variants)
        }
        return [phone] + desktop
    }()

    /// The variants the picker offers for the scheme worn now: those with a
    /// skin in it (Cyberpunk and Black are dark only, Candy and the Windows
    /// editions light only), so a dark phone never lists a light look and the
    /// reverse. `keeping` is the variant worn now, always listed.
    public func variants(for scheme: SkinScheme, keeping worn: SkinVariant? = nil) -> [SkinVariant] {
        variants.filter { $0 == worn || $0.schemes.contains(scheme) }
    }

    public static func of(_ id: SkinFamilyID) -> SkinFamily {
        all.first { $0.id == id } ?? all[0]
    }
}

/// Where a look sits: its family, its variant and its scheme.
public struct SkinPlace: Equatable, Sendable {
    public let family: SkinFamily
    public let variant: SkinVariant
    public let scheme: SkinScheme

    /// Every skin has one place (Hibou 98 in its own secret family). A
    /// legacy skin sits at its mapped base and colour; a tint the family
    /// lacks is ignored.
    public static func of(_ skin: SkinID, tint: SkinTint? = nil) -> SkinPlace {
        let worn = SkinLook(skin: skin, tint: tint).normalized
        for family in SkinFamily.all {
            for variant in family.variants where variant.tint == worn.tint {
                if variant.light == worn.skin { return SkinPlace(family: family, variant: variant, scheme: .light) }
                if variant.dark == worn.skin { return SkinPlace(family: family, variant: variant, scheme: .dark) }
            }
        }
        let pulsatrix = SkinFamily.of(.pulsatrix)
        return SkinPlace(family: pulsatrix, variant: pulsatrix.variants[0], scheme: .light)
    }

    public static func of(_ look: SkinLook) -> SkinPlace { of(look.skin, tint: look.tint) }
}

public extension ThemeSelection {
    /// The picker's state for a phone in `deviceDark` appearance: the place
    /// of the skin worn now, and Auto when the pair is that variant's own.
    func skinChoice(deviceDark: Bool) -> (place: SkinPlace, mode: SkinModeChoice) {
        let place = SkinPlace.of(look(deviceDark: deviceDark))
        if mode == .system, place.variant.followsSystem, lightSkin == place.variant.light, darkSkin == place.variant.dark {
            return (place, .auto)
        }
        return (place, place.scheme == .light ? .light : .dark)
    }

    /// This selection with a family's variant worn in a mode (local modes;
    /// the computer's own choice goes through the computer). A mode the
    /// variant lacks falls to the one it has.
    func choosing(_ variant: SkinVariant, mode choice: SkinModeChoice) -> ThemeSelection {
        var next = self
        next.tint = variant.tint
        if choice == .auto, variant.followsSystem, let light = variant.light, let dark = variant.dark {
            next.mode = .system
            next.lightSkin = light
            next.darkSkin = dark
        } else {
            let scheme: SkinScheme = choice == .light ? .light : choice == .dark ? .dark : (variant.schemes.first ?? .dark)
            next.mode = .fixed
            next.fixedSkin = variant.skin(scheme)
        }
        return next
    }

    /// The mode a newly picked variant keeps: Auto where it can follow the
    /// phone, else the scheme worn now when it has it, else the one it has.
    static func carry(_ choice: SkinModeChoice, to variant: SkinVariant, worn scheme: SkinScheme) -> SkinModeChoice {
        if choice == .auto { return variant.followsSystem ? .auto : (variant.schemes.first == .light ? .light : .dark) }
        let wanted: SkinScheme = choice == .light ? .light : .dark
        if variant.schemes.contains(wanted) { return choice }
        let fallback = variant.schemes.contains(scheme) ? scheme : (variant.schemes.first ?? .dark)
        return fallback == .light ? .light : .dark
    }
}
