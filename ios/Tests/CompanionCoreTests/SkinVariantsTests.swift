import XCTest
@testable import CompanionCore

/// The skin variants on the phone (desktop PR #843): a tint laid over its
/// base skin as the desktop's CSS lays its block, read from the generated
/// SkinVariantsData.swift (src/lib/ios-skin-variants-export.test.ts keeps it
/// equal to the stylesheets).
final class SkinVariantsTests: XCTestCase {
    func testAColourMovesOnlyTheAccentFamily() {
        let base = SkinPalette.of(.pulsatrix)
        let red = SkinLook(skin: .pulsatrix, tint: .red).palette
        XCTAssertEqual(red.accent, SkinColor(0xF87171))
        XCTAssertEqual(red.accentInk, SkinColor(0x1A0707))
        XCTAssertEqual(red.bubbleUser, SkinColor(0x3D1A22))
        XCTAssertEqual(red.bg, base.bg, "the ground stays the family's")
        XCTAssertEqual(red.card, base.card)
        XCTAssertEqual(red.textPrimary, base.textPrimary)
        XCTAssertEqual(red.tint, .red)
        XCTAssertTrue(red.accentGradient.isEmpty)
    }

    func testFullReachesEverySurface() {
        let accent = SkinLook(skin: .pulsatrix, tint: .red).palette
        let full = SkinLook(skin: .pulsatrix, tint: .red, depth: .full).palette
        XCTAssertEqual(full.bg, SkinColor(0x160509))
        XCTAssertEqual(full.card, SkinColor(0x290F18))
        XCTAssertEqual(full.accent, accent.accent, "the accent family stays the tint block's")
        XCTAssertEqual(full.depth, .full)
        // Full only on a plain colour: a duo-tone keeps its own surfaces
        XCTAssertEqual(SkinLook(skin: .midnight, tint: .aurore, depth: .full).normalized.depth, .accent)
        XCTAssertEqual(SkinLook(skin: .midnight, tint: .aurore, depth: .full).palette.bg, SkinPalette.of(.midnight).bg)
    }

    func testDuoTonesAndMoodsCarryTheirGradient() {
        let aurore = SkinLook(skin: .midnight, tint: .aurore).palette
        XCTAssertEqual(aurore.accentGradient, [SkinColor(0xF472B6), SkinColor(0xFB923C)])
        let cyberpunk = SkinLook(skin: .midnight, tint: .cyberpunk).palette
        XCTAssertEqual(cyberpunk.accentGradient.count, 3)
        XCTAssertEqual(cyberpunk.bg, SkinColor(0x0D0718), "a mood repaints the whole palette")
    }

    func testWindowsEditionsArePalettesOverHibou98() {
        let xp = SkinLook(skin: .retro98, tint: .xp).palette
        XCTAssertEqual(xp.accent, SkinColor(0x316AC5))
        XCTAssertEqual(xp.bg, SkinColor(0xECE9D8), "the window face is the ground, as the 98 grey")
        XCTAssertEqual(xp.typeface, .retro)
        XCTAssertFalse(xp.bevelled, "the bevels are the classic look's")
        XCTAssertTrue(SkinPalette.of(.retro98).bevelled)
        XCTAssertEqual(SkinLook(skin: .retro98, texture: .grid).normalized.texture, .none, "never a texture under Hibou 98")
    }

    func testTexturesHaveTheirLayers() {
        XCTAssertEqual(SkinTexture.grain.layers.count, 4)
        XCTAssertEqual(SkinTexture.grid.layers.map(\.kind), [.vertical, .horizontal])
        XCTAssertEqual(SkinTexture.dots.layers.first?.tileWidth, 18)
        XCTAssertEqual(SkinTexture.lines.layers.first?.kind, .diagonal)
        XCTAssertTrue(SkinTexture.none.layers.isEmpty)
        XCTAssertEqual(SkinLook(skin: .black, texture: .dots).palette.texture, .dots)
    }

    /// WCAG AA on the main pairs of every variant as the phone places it.
    func testEveryVariantClearsContrast() {
        var failures: [String] = []
        for family in SkinFamily.all {
            for variant in family.variants {
                for scheme in variant.schemes {
                    for depth in variant.hasDepth ? [SkinDepth.accent, .full] : [.accent] {
                        let p = variant.look(scheme, depth: depth).palette
                        let pairs: [(String, SkinColor, SkinColor, Double)] = [
                            ("text on bg", p.textPrimary, p.bg, 4.5),
                            ("text on card", p.textPrimary, p.card, 4.5),
                            ("secondary on bg", p.textSecondary, p.bg, 3),
                            ("user bubble text", p.bubbleUserText, p.bubbleUser, 4.5),
                            ("accent text on bg", p.accentText, p.bg, 3),
                            ("primary action ink", p.primaryInk, p.primaryFill, 3),
                        ]
                        for (name, fg, bg, minimum) in pairs where fg.contrast(on: bg) < minimum {
                            failures.append(String(format: "%@/%@ %@ %@: %.2f < %.1f", family.id.rawValue, variant.id, scheme.rawValue, depth.rawValue, name, fg.contrast(on: bg), minimum))
                        }
                    }
                }
            }
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testSharedDefaultsCarryTheVariant() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "skin-variants-tests-\(UUID().uuidString)"))
        let s = ThemeSelection(mode: .system, lightSkin: .daylight, darkSkin: .midnight, tint: .ocean, texture: .grain)
        SharedThemeKeys.write(s, resolvedFixed: nil, to: defaults)
        XCTAssertEqual(SharedThemeKeys.look(in: defaults, deviceDark: true), SkinLook(skin: .midnight, tint: .ocean, texture: .grain))
        var computer = s
        computer.mode = .computer
        computer.computerSkin = .foundry
        computer.computerTint = .red
        computer.computerDepth = .full
        SharedThemeKeys.write(computer, resolvedFixed: .foundry, to: defaults)
        XCTAssertEqual(SharedThemeKeys.look(in: defaults, deviceDark: false), SkinLook(skin: .foundry, tint: .red, depth: .full))
    }
}
