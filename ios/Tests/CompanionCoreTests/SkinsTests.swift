import XCTest
@testable import CompanionCore

final class SkinsTests: XCTestCase {
    /// WCAG AA for each skin's token pairs: 4.5:1 for body text, 3:1 for
    /// secondary text, large text and control fills.
    func testEverySkinClearsContrast() {
        var failures: [String] = []
        for id in SkinID.allCases {
            let p = id.palette
            let pairs: [(String, SkinColor, SkinColor, Double)] = [
                ("text on bg", p.textPrimary, p.bg, 4.5),
                ("text on card", p.textPrimary, p.card, 4.5),
                ("text on raised card", p.textPrimary, p.cardRaised, 4.5),
                ("secondary on card", p.textSecondary, p.card, 3),
                ("secondary on bg", p.textSecondary, p.bg, 3),
                ("assistant bubble text", p.bubbleAssistantText, p.bubbleAssistant, 4.5),
                ("user bubble text", p.bubbleUserText, p.bubbleUser, 4.5),
                ("approval text", p.attentionText, p.attentionSurface, 4.5),
                ("approval secondary", p.attentionSecondary, p.attentionSurface, 3),
                ("accent text on bg", p.accentText, p.bg, 3),
                ("accent text on card", p.accentText, p.card, 3),
                ("primary action ink", p.primaryInk, p.primaryFill, 3),
                ("text on glass", p.textPrimary, p.glassFill, 4.5),
                ("chip text", p.chipText, p.chip, 3),
                ("destructive on card", p.destructive, p.card, 3),
                ("code on inset", p.textPrimary, p.inset, 4.5),
                ("text on menu", p.textPrimary, p.menuGlass, 4.5),
            ]
            for (name, fg, bg, minimum) in pairs {
                let ratio = fg.contrast(on: bg)
                if ratio < minimum {
                    failures.append(String(format: "%@ %@: %.2f < %.1f", id.rawValue, name, ratio, minimum))
                }
            }
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testBotColoursAreDeepenedToReadOnLightSkins() {
        let cyan = SkinColor(0x0EA5C6)
        let white = SkinColor(0xFFFFFF)
        XCTAssertLessThan(cyan.contrast(on: white), 4.5)
        let ink = cyan.readable(on: white)
        XCTAssertGreaterThanOrEqual(ink.contrast(on: white), 4.5)
        XCTAssertGreaterThan(ink.blue, ink.red, "keeps its hue")
        XCTAssertEqual(SkinColor(0x0B1526).readable(on: white), SkinColor(0x0B1526), "already readable: unchanged")
    }

    func testContrastMaths() {
        XCTAssertEqual(SkinColor(0xFFFFFF).contrast(on: SkinColor(0x000000)), 21, accuracy: 0.01)
        XCTAssertEqual(SkinColor(0x777777).contrast(on: SkinColor(0xFFFFFF)), 4.48, accuracy: 0.01)
        // alpha composites over the ground
        XCTAssertEqual(SkinColor(0xFFFFFF, alpha: 0).contrast(on: SkinColor(0x202020)), 1, accuracy: 0.001)
        XCTAssertEqual(SkinColor(css: "#fcfcfc99"), SkinColor(0xFCFCFC, alpha: Double(0x99) / 255))
    }

    /// Black is the parity reference: its values never move.
    func testBlackKeepsTheParityValues() {
        let p = SkinPalette.black
        XCTAssertEqual(p.bg, SkinColor(0x141414))
        XCTAssertEqual(p.card, SkinColor(0x202020))
        XCTAssertEqual(p.bubbleUser, SkinColor(0x2E2E30))
        XCTAssertEqual(p.toggleOn, SkinColor(0x68CE67))
        XCTAssertEqual(p.textPrimary, SkinColor(0xFFFFFF))
        XCTAssertTrue(p.isDark)
        XCTAssertEqual(SkinPalette.dim.bg, SkinColor(0x1C1C1E))
    }

    func testLightAndDarkNature() {
        let light: Set<SkinID> = [.pulsatrixLight, .atelier, .lagoon, .linen, .daylight, .retro98]
        for id in SkinID.allCases {
            XCTAssertEqual(id.isDark, !light.contains(id), id.rawValue)
            // bubble text follows the surface it sits on, never the phone
            XCTAssertEqual(id.palette.bubbleAssistantText.luminance > 0.5, id.isDark || id.palette.bubbleAssistant.luminance < 0.2, id.rawValue)
        }
    }

    func testSelection() {
        var s = ThemeSelection()
        XCTAssertEqual(s.mode, .system, "Settings reads System · Black")
        XCTAssertEqual(s.skin(deviceDark: false), .black, "the default is the reference look, Black, on a light phone too")
        XCTAssertEqual(s.skin(deviceDark: true), .black)
        XCTAssertTrue(s.pinsAppearance, "Black twice pins the window dark: status bar and keyboard match the references")
        s.lightSkin = ThemeSelection.suggestedLight
        XCTAssertEqual(s.skin(deviceDark: true), .black)
        XCTAssertEqual(s.skin(deviceDark: false), .pulsatrixLight)
        XCTAssertFalse(s.pinsAppearance)
        s.mode = .fixed
        s.fixedSkin = .black
        XCTAssertEqual(s.skin(deviceDark: false), .black, "JC's case: a light phone keeps Black whole")
        XCTAssertTrue(s.pinsAppearance)
        s.mode = .computer
        XCTAssertEqual(s.skin(deviceDark: false), .pulsatrixLight, "no computer answer yet: follow the system pair")
        s.computerSkin = .foundry
        s.computerFont = .serif
        XCTAssertEqual(s.skin(deviceDark: false), .foundry)
        XCTAssertEqual(s.fontChoice(), .serif)
        XCTAssertEqual(SkinTypeface.resolve(skin: .retro98, font: .skin), .retro)
        XCTAssertEqual(SkinTypeface.resolve(skin: .black, font: .inter), .system)
    }

    func testMigration() {
        XCTAssertEqual(ThemeSelection.migrating(appearanceMode: nil, tone: nil).skin(deviceDark: false), .black, "never chose: Black")
        let dark = ThemeSelection.migrating(appearanceMode: "dark", tone: "dim")
        XCTAssertEqual(dark.mode, .fixed)
        XCTAssertEqual(dark.skin(deviceDark: false), .dim)
        let system = ThemeSelection.migrating(appearanceMode: "system", tone: "dim")
        XCTAssertEqual(system.mode, .system)
        XCTAssertEqual(system.skin(deviceDark: true), .dim)
        XCTAssertEqual(system.skin(deviceDark: false), .dim, "the earlier System wore its tone on a light phone too")
        XCTAssertTrue(system.pinsAppearance)
        XCTAssertEqual(ThemeSelection.migrating(appearanceMode: nil, tone: nil), ThemeSelection())
    }

    func testComputerAppearance() {
        let read = ComputerAppearance(preferences: ["omb-skin": "lagoon", "omb-font": "serif", "omb.retro98.unlocked": "1"])
        XCTAssertEqual(read, ComputerAppearance(skin: .lagoon, font: .serif, retroUnlocked: true))
        XCTAssertEqual(ComputerAppearance(preferences: [:]).skin, .pulsatrix, "the desktop's default")
        XCTAssertEqual(ComputerAppearance(preferences: ["omb-skin": "black"]).skin, .pulsatrix, "phone-only ids are not desktop skins")
        let written = ComputerAppearance.preferences(skin: .black, font: .skin, retroUnlocked: false)
        XCTAssertEqual(written["omb-skin"], "midnight")
        XCTAssertNil(written["omb.retro98.on"])
        XCTAssertEqual(ComputerAppearance.preferences(skin: .retro98, font: .skin, retroUnlocked: true)["omb.retro98.on"], "1")
    }

    func testSecretSkinIsHiddenUntilUnlocked() {
        XCTAssertFalse(SkinID.visible(retroUnlocked: false).contains(.retro98))
        XCTAssertTrue(SkinID.visible(retroUnlocked: false, active: .retro98).contains(.retro98))
        XCTAssertTrue(SkinID.visible(retroUnlocked: true).contains(.retro98))
        XCTAssertEqual(SkinID.visible(retroUnlocked: true).count, 13)
    }

    func testSharedDefaults() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "skins-tests-\(UUID().uuidString)"))
        XCTAssertEqual(SharedThemeKeys.skin(in: defaults, deviceDark: false), .black, "nothing written yet: the default, Black")
        var s = ThemeSelection(lightSkin: .atelier, darkSkin: .dusk)
        SharedThemeKeys.write(s, resolvedFixed: nil, to: defaults)
        XCTAssertEqual(SharedThemeKeys.skin(in: defaults, deviceDark: false), .atelier)
        XCTAssertEqual(SharedThemeKeys.skin(in: defaults, deviceDark: true), .dusk)
        s.mode = .fixed
        SharedThemeKeys.write(s, resolvedFixed: .black, to: defaults)
        XCTAssertEqual(SharedThemeKeys.skin(in: defaults, deviceDark: false), .black)
    }

    /// The copied desktop values match `src/styles.css`, when the repository
    /// is checked out around this package.
    func testDesktopTokensMatchStylesheet() throws {
        let css = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("src/styles.css")
        guard let text = try? String(contentsOf: css, encoding: .utf8) else {
            throw XCTSkip("src/styles.css is not next to this package")
        }
        for (skin, tokens) in DesktopSkins.table {
            guard let start = text.range(of: "\n[data-skin=\"\(skin)\"] {") else {
                XCTFail("no block for \(skin)"); continue
            }
            let rest = text[start.upperBound...]
            let block = rest[..<(rest.range(of: "\n}")?.lowerBound ?? rest.endIndex)]
            for key in DesktopSkins.keys {
                let name = key == "code-scheme" ? "--code-color-scheme" : "--color-\(key)"
                guard let line = block.range(of: "\(name):") else { XCTFail("\(skin) has no \(name)"); continue }
                let value = block[line.upperBound...].prefix { $0 != ";" }.trimmingCharacters(in: .whitespaces)
                XCTAssertEqual(tokens[key], value, "\(skin) \(name)")
            }
        }
    }
}
