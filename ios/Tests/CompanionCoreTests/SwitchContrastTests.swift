import XCTest
@testable import CompanionCore

/// Every skin, colour, Full colour, duo-tone, mood and Windows edition the
/// phone wears, plus a spread of bot colours: the white knob on both tracks
/// and each track (or its edge) on every surface hold 3:1 (WCAG 1.4.11).
final class SwitchContrastTests: XCTestCase {
    private func looks() -> [SkinLook] {
        var out: [SkinLook] = []
        for skin in SkinID.allCases {
            out.append(SkinLook(skin: skin))
            for tint in SkinTint.allCases where SkinVariants.offers(skin, tint) {
                for depth in SkinDepth.allCases {
                    let look = SkinLook(skin: skin, tint: tint, depth: depth).normalized
                    if !out.contains(look) { out.append(look) }
                }
            }
        }
        return out
    }

    private func failures(_ name: String, _ palette: SkinPalette) -> [String] {
        let colors = palette.switchColors
        let c = SwitchContrast.contrasts(colors, surfaces: palette.switchSurfaces)
        var out: [String] = []
        for (pair, value) in [("knobOn", c.knobOn), ("knobOff", c.knobOff), ("onGround", c.onGround), ("offGround", c.offGround)] where value < SwitchContrast.minimum {
            out.append("\(name): \(pair) \(String(format: "%.2f", value)):1")
        }
        return out
    }

    func testEveryLookHoldsThreeToOne() {
        let all = looks()
        XCTAssertGreaterThan(all.count, 60, "every skin and variant is measured")
        XCTAssertTrue(all.contains { $0.palette.isDark })
        XCTAssertTrue(all.contains { !$0.palette.isDark })
        let problems = all.flatMap { look in
            failures("\(look.skin.rawValue)+\(look.tint?.rawValue ?? "")+\(look.depth.rawValue)", look.palette)
        }
        XCTAssertEqual(problems, [])
    }

    func testBotColoursHoldThreeToOne() {
        let bots: [SkinColor] = [0xF5F5F5, 0xFACC15, 0x22D3EE, 0x4ADE80, 0xF472B6, 0x000080, 0x111111, 0xFF6600].map { SkinColor($0) }
        var problems: [String] = []
        for look in looks() {
            for bot in bots {
                problems += failures("\(look.skin.rawValue)+\(look.tint?.rawValue ?? "") bot \(String(bot.hex, radix: 16))", look.palette.withBotAccent(bot))
            }
        }
        XCTAssertEqual(problems, [])
    }

    func testKnobIsWhiteAndOnKeepsTheAccentHue() {
        XCTAssertEqual(SwitchContrast.knob, SkinColor(0xFFFFFF))
        // the grey-on-grey report: a near-white accent on a dark skin
        let grey = SwitchContrast.colors(accent: SkinColor(0xF5F5F5), ink: SkinColor(0xF5F5F5), surfaces: [SkinColor(0x121212), SkinColor(0x1F1F1F)], dark: true)
        XCTAssertGreaterThanOrEqual(SwitchContrast.knob.contrast(on: grey.on), 3)
        // a red accent stays red
        let red = SwitchContrast.colors(accent: SkinColor(0xF87171), ink: SkinColor(0xF5F5F5), surfaces: [SkinColor(0x121212)], dark: true)
        XCTAssertGreaterThan(red.on.red, red.on.green)
        XCTAssertGreaterThan(red.on.red, red.on.blue)
    }

    func testMidToneGroundGetsAnEdge() {
        let ground = [SkinColor(0x595959)]
        let colors = SwitchContrast.colors(accent: SkinColor(0x3C76F4), ink: SkinColor(0x000000), surfaces: ground, dark: true)
        XCTAssertNotNil(colors.onEdge)
        let c = SwitchContrast.contrasts(colors, surfaces: ground)
        XCTAssertGreaterThanOrEqual(c.onGround, 3)
        XCTAssertGreaterThanOrEqual(c.knobOn, 3)
    }

    /// In a bot's panel the on track is derived from the bot's colour, for
    /// every colour a bot can have, on every look: 3:1, same hue.
    func testBotPanelTrackFollowsTheBotAtThreeToOne() {
        var problems: [String] = []
        for look in looks() {
            let palette = look.palette
            for (name, hex) in MausColors.hex {
                guard let bot = SkinColor(css: hex) else { continue }
                let colors = palette.switchColors(bot: bot)
                let c = SwitchContrast.contrasts(colors, surfaces: palette.switchSurfaces)
                for (pair, value) in [("knobOn", c.knobOn), ("onGround", c.onGround)] where value < SwitchContrast.minimum {
                    problems.append("\(look.skin.rawValue) bot \(name): \(pair) \(String(format: "%.2f", value))")
                }
            }
        }
        XCTAssertEqual(problems, [])
    }

    func testBotColourKeepsItsHueAndOutsideAPanelNothingChanges() {
        let palette = SkinLook(skin: .midnight).palette
        guard let red = SkinColor(css: MausColors.hex["red"]!) else { return XCTFail("red") }
        let inPanel = palette.switchColors(bot: red)
        XCTAssertGreaterThan(inPanel.on.red, inPanel.on.green)
        XCTAssertGreaterThan(inPanel.on.red, inPanel.on.blue)
        // no bot open: the skin's own track, exactly
        XCTAssertEqual(palette.switchColors(bot: nil), palette.switchColors)
    }
}
