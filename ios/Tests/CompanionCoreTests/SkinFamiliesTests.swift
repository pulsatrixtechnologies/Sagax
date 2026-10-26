import XCTest
@testable import CompanionCore

/// Skin families on the phone, the desktop's model (src/lib/skin-families.ts,
/// generated into SkinVariantsData.swift): every base skin is one family's
/// own look, each variant a base skin plus a tint, a saved selection reads
/// back as the look it wears, and a choice writes the same ThemeSelection
/// fields as before plus the tint.
final class SkinFamiliesTests: XCTestCase {
    func testEveryListedSkinHasItsFamilysOwnLook() {
        var seen: [SkinID] = []
        for family in SkinFamily.all where family.id != .retro98 {
            XCTAssertFalse(family.variants.isEmpty, family.name)
            for variant in family.variants {
                XCTAssertFalse(variant.schemes.isEmpty, variant.name)
                if variant.tint == nil { seen += [variant.light, variant.dark].compactMap { $0 } }
            }
        }
        XCTAssertEqual(Set(seen).count, seen.count, "a skin in two families' own looks")
        XCTAssertEqual(Set(seen), Set(SkinID.visible(retroUnlocked: false)))
        for skin in seen {
            let place = SkinPlace.of(skin)
            XCTAssertEqual(place.variant.skin(place.scheme), skin)
            XCTAssertNil(place.variant.tint)
        }
    }

    func testTheDesktopsVariants() {
        // the same model as src/lib/skin-families.ts
        let pulsatrix = SkinFamily.of(.pulsatrix)
        XCTAssertEqual(pulsatrix.variants.filter { $0.group == .color }.map(\.id), ["basic", "red", "pink", "green", "yellow"], "Pulsatrix has no Blue of its own")
        let studio = SkinFamily.of(.studio)
        XCTAssertEqual(studio.variants.filter { $0.group == .color }.map(\.id), ["basic", "red", "pink", "blue", "green", "yellow"])
        XCTAssertEqual(studio.variants.filter { $0.group == .duo }.map(\.id), ["aurore", "ocean", "neon", "foret"])
        XCTAssertEqual(studio.variants.filter { $0.group == .ambiance }.map(\.id), ["cyberpunk", "sunset", "nordic", "candy"])
        XCTAssertEqual(SkinFamily.of(.retro98).variants.map(\.id), ["classic", "xp", "vista", "win7", "win8", "win81", "win10", "win11"])
        XCTAssertEqual(SkinPlace.of(.pulsatrixLight).variant, SkinPlace.of(.pulsatrix).variant)
        XCTAssertEqual(SkinPlace.of(.daylight).variant, SkinPlace.of(.midnight).variant)
        XCTAssertEqual(SkinPlace.of(.atelier, tint: .ocean).variant.id, "ocean")
        XCTAssertEqual(SkinPlace.of(.dim).family.id, .phone)
    }

    func testLegacySkinsSitAtTheirMappedColour() {
        // LEGACY_SKINS: the near-duplicate skins are a base and a colour now
        XCTAssertEqual(SkinPlace.of(.graphite).variant, SkinPlace.of(.midnight, tint: .blue).variant)
        XCTAssertEqual(SkinPlace.of(.linen).variant.id, "blue")
        XCTAssertEqual(SkinPlace.of(.dusk).variant.id, "pink")
        XCTAssertEqual(SkinPlace.of(.dusk).family.id, .studio)
        XCTAssertEqual(SkinPlace.of(.lagoon).family.id, .atelier)
        XCTAssertEqual(SkinLook(skin: .lagoon).normalized, SkinLook(skin: .atelier, tint: .blue))
        // a tint the family lacks is dropped
        XCTAssertEqual(SkinLook(skin: .pulsatrix, tint: .blue).normalized.tint, nil)
        XCTAssertEqual(SkinLook(skin: .retro98, tint: .red).normalized.tint, nil)
        XCTAssertEqual(SkinLook(skin: .black, tint: .red).normalized.tint, nil)
    }

    func testSavedSelectionsReadBackUnchanged() {
        // the default: Black twice, pinned dark
        let base = ThemeSelection()
        XCTAssertEqual(base.skinChoice(deviceDark: false).place.variant.id, "black")
        XCTAssertEqual(base.skinChoice(deviceDark: false).mode, .dark)
        // a fixed legacy skin: worn as its base and colour
        let fixed = ThemeSelection(mode: .fixed, fixedSkin: .graphite)
        XCTAssertEqual(fixed.skinChoice(deviceDark: false).place.variant.id, "blue")
        XCTAssertEqual(fixed.look(deviceDark: false), SkinLook(skin: .midnight, tint: .blue))
        XCTAssertEqual(fixed.skinChoice(deviceDark: false).mode, .dark)
        // a family pair following the phone is Auto, with its tint
        let auto = ThemeSelection(mode: .system, lightSkin: .daylight, darkSkin: .midnight, tint: .neon)
        XCTAssertEqual(auto.skinChoice(deviceDark: true).mode, .auto)
        XCTAssertEqual(auto.skinChoice(deviceDark: true).place.variant.id, "neon")
        XCTAssertEqual(auto.look(deviceDark: false), SkinLook(skin: .daylight, tint: .neon))
        // an older mixed pair keeps wearing its skins, shown by the worn one
        let mixed = ThemeSelection(mode: .system, lightSkin: .pulsatrixLight, darkSkin: .black)
        XCTAssertEqual(mixed.skinChoice(deviceDark: false).place.family.id, .pulsatrix)
        XCTAssertEqual(mixed.skinChoice(deviceDark: false).mode, .light)
        XCTAssertEqual(mixed.skinChoice(deviceDark: true).place.family.id, .phone)
        XCTAssertEqual(mixed.skin(deviceDark: true), .black)
    }

    func testChoosingWritesTheSameFieldsAndTheTint() {
        let studio = SkinFamily.of(.studio)
        let basic = studio.variants[0]
        let auto = ThemeSelection().choosing(basic, mode: .auto)
        XCTAssertEqual(auto.mode, .system)
        XCTAssertEqual(auto.skin(deviceDark: false), .daylight)
        XCTAssertEqual(auto.skin(deviceDark: true), .midnight)
        XCTAssertNil(auto.tint)
        let red = studio.variants.first { $0.id == "red" }!
        let light = auto.choosing(red, mode: .light)
        XCTAssertEqual(light.mode, .fixed)
        XCTAssertEqual(light.fixedSkin, .daylight)
        XCTAssertEqual(light.tint, .red)
        // a mood with one scheme: Cyberpunk is dark only, Candy light only
        let cyberpunk = studio.variants.first { $0.id == "cyberpunk" }!
        XCTAssertEqual(ThemeSelection().choosing(cyberpunk, mode: .light).fixedSkin, .midnight)
        XCTAssertEqual(ThemeSelection().choosing(cyberpunk, mode: .auto).fixedSkin, .midnight)
        XCTAssertEqual(ThemeSelection.carry(.auto, to: cyberpunk, worn: .light), .dark)
        let candy = studio.variants.first { $0.id == "candy" }!
        XCTAssertEqual(ThemeSelection.carry(.dark, to: candy, worn: .dark), .light)
        XCTAssertEqual(ThemeSelection.carry(.auto, to: basic, worn: .dark), .auto)
        // back to the family's own look clears the tint
        XCTAssertNil(light.choosing(basic, mode: .light).tint)
    }

    func testEverySlotHasTheAppearanceOfItsSkin() {
        for family in SkinFamily.all {
            for variant in family.variants {
                if variant.light != nil { XCTAssertFalse(variant.look(.light).palette.isDark, "\(family.id)/\(variant.id) light") }
                if variant.dark != nil { XCTAssertTrue(variant.look(.dark).palette.isDark, "\(family.id)/\(variant.id) dark") }
            }
        }
    }

    func testThePickerOffersOnlyTheVariantsOfTheSchemeWorn() {
        let studio = SkinFamily.of(.studio)
        XCTAssertFalse(studio.variants(for: .dark).contains { $0.id == "candy" })
        XCTAssertFalse(studio.variants(for: .light).contains { $0.id == "cyberpunk" })
        for family in SkinFamily.all {
            for scheme in [SkinScheme.light, .dark] {
                for variant in family.variants(for: scheme) {
                    XCTAssertEqual(variant.skin(scheme).isDark, scheme == .dark, "\(family.id)/\(variant.id)")
                }
            }
        }
        // Hibou 98 has only a light look, the phone family only a dark one
        XCTAssertTrue(SkinFamily.of(.retro98).variants(for: .dark).isEmpty)
        XCTAssertTrue(SkinFamily.of(.phone).variants(for: .light).isEmpty)
        // the worn variant stays listed
        let candy = studio.variants.first { $0.id == "candy" }!
        XCTAssertTrue(studio.variants(for: .dark, keeping: candy).contains(candy))
    }
}
