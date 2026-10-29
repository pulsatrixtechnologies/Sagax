import XCTest
@testable import CompanionCore

/// The conversation bubbles (2026-10-28): the person's own message in the
/// accent with text at 4.5:1 or better, a bot's reply in a neutral grey; the
/// same derivation as the desktop's `src/lib/bubble-colors.ts`.
final class BubbleColorsTests: XCTestCase {
    func testThePersonsBubbleUsesTheAccentAndItsTextReadsOnEverySkinAndColour() {
        var failures: [String] = []
        for family in SkinFamily.all {
            for variant in family.variants {
                for scheme in variant.schemes {
                    let p = variant.look(scheme, depth: .accent).palette
                    let ratio = p.bubbleUserText.contrast(on: p.bubbleUser)
                    if ratio < BubbleColors.minimumContrast {
                        failures.append(String(format: "%@/%@ %@: %.2f", family.id.rawValue, variant.id, scheme.rawValue, ratio))
                    }
                    // the accent's own hue: the dominant channel stays the dominant one
                    let a = [p.accent.red, p.accent.green, p.accent.blue]
                    let u = [p.bubbleUser.red, p.bubbleUser.green, p.bubbleUser.blue]
                    if (a.max()! - a.min()!) > 0.2, a.firstIndex(of: a.max()!) != u.firstIndex(of: u.max()!) {
                        failures.append("\(family.id.rawValue)/\(variant.id) \(scheme.rawValue): hue moved")
                    }
                }
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testTheBotsBubbleIsANeutralGreyOffThePage() {
        for id in SkinID.allCases {
            let p = id.palette
            let bot = p.bubbleAssistant
            XCTAssertEqual(bot.red, bot.green, accuracy: 0.005, id.rawValue)
            XCTAssertEqual(bot.green, bot.blue, accuracy: 0.005, id.rawValue)
            XCTAssertNotEqual(bot, p.bg, id.rawValue)
            XCTAssertGreaterThanOrEqual(p.bubbleAssistantText.contrast(on: bot), 4.5, id.rawValue)
            XCTAssertNotEqual(bot, p.bubbleUser, id.rawValue)
        }
        // lighter than a dark page, darker than a light one
        XCTAssertGreaterThan(SkinPalette.black.bubbleAssistant.luminance, SkinPalette.black.bg.luminance)
        XCTAssertLessThan(SkinID.pulsatrixLight.palette.bubbleAssistant.luminance, SkinID.pulsatrixLight.palette.bg.luminance)
    }

    func testAnyAccentCarriesItsText() {
        var accents: [SkinColor] = [0xF97316, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFFFFFF, 0x000000, 0x808080, 0xE8E8E8].map { SkinColor($0) }
        for hue in stride(from: 0, to: 256, by: 11) { accents.append(SkinColor(UInt32(hue) << 16 | UInt32(255 - hue) << 8 | 0x80)) }
        for accent in accents {
            let u = BubbleColors.user(accent: accent)
            XCTAssertGreaterThanOrEqual(u.ink.contrast(on: u.fill), BubbleColors.minimumContrast, String(accent.hex, radix: 16))
        }
    }

    func testAnOrangeAccentTakesLightTextOnADarkenedOrange() {
        let u = BubbleColors.user(accent: SkinColor(0xF97316))
        XCTAssertEqual(u.ink, SkinColor(0xFFFFFF))
        XCTAssertGreaterThan(u.fill.red, u.fill.green)
        XCTAssertGreaterThan(u.fill.green, u.fill.blue)
    }

    func testAnAccentThatAlreadyCarriesWhiteIsUsedAsIs() {
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0x2F62DD)).fill, SkinColor(0x2F62DD))
    }

    /// Regression (2026-10-28): on Midnight the accent is near white, so my
    /// bubble was white in a 1:1. With a bot's colour it takes that colour's
    /// hue, with text at 4.5:1 or better, for every bot colour.
    func testMyBubbleInAOneToOneTakesTheBotsColour() {
        let midnight = SkinColor(0xF5F5F5)
        XCTAssertNil(BubbleColors.user(botColor: nil))
        XCTAssertNil(BubbleColors.user(botColor: "not-a-colour"))
        for name in ["red", "green", "blue", "purple", "orange"] {
            guard let paint = BubbleColors.user(botColor: name) else { XCTFail("no paint for \(name)"); continue }
            XCTAssertNotEqual(paint.fill, midnight, name)
            XCTAssertGreaterThanOrEqual(paint.ink.contrast(on: paint.fill), BubbleColors.minimumContrast, name)
            let bot = SkinColor(css: MausColors.hex(for: name)!)!
            let a = [bot.red, bot.green, bot.blue], u = [paint.fill.red, paint.fill.green, paint.fill.blue]
            XCTAssertEqual(a.firstIndex(of: a.max()!), u.firstIndex(of: u.max()!), "\(name): hue moved")
        }
    }
}
