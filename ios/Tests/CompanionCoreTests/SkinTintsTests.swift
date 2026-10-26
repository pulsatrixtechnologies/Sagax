import XCTest
@testable import CompanionCore

/// The computer's colour variant (`omb-skin-tint`, `omb-skin-depth`) on the
/// phone's palette (R4).
final class SkinTintsTests: XCTestCase {
    func testAColourMovesTheAccentOnly() throws {
        let base = SkinPalette.of(.pulsatrix)
        let red = SkinPalette.of(.pulsatrix, tint: .red, depth: .accent)
        XCTAssertEqual(red.accent, SkinColor(css: "#f87171"))
        XCTAssertEqual(red.accentText, SkinColor(css: "#fca5a5"))
        XCTAssertEqual(red.unreadDot, SkinColor(css: "#f87171"))
        XCTAssertEqual(red.bubbleUser, SkinColor(css: "#3d1a22"))
        XCTAssertEqual(red.bg, base.bg, "the surfaces stay the skin's")
        XCTAssertEqual(red.tint, .red)
    }

    func testFullDepthReachesTheSurfacesAndKeepsTheTintAccent() {
        let base = SkinPalette.of(.pulsatrix)
        let full = SkinPalette.of(.pulsatrix, tint: .red, depth: .full)
        XCTAssertEqual(full.bg, SkinColor(css: "#160509"))
        XCTAssertNotEqual(full.bg, base.bg)
        XCTAssertEqual(full.accent, SkinColor(css: "#f87171"))
        XCTAssertEqual(full.depth, .full)
    }

    func testMoodsAndDuoTonesLayTheirSolidTokens() {
        let mood = SkinPalette.of(.pulsatrix, tint: .cyberpunk, depth: .full)
        XCTAssertEqual(mood.accent, SkinColor(css: "#ff4fd8"))
        XCTAssertEqual(mood.bg, SkinColor(css: "#0d0718"))
        XCTAssertEqual(mood.depth, .accent, "only a plain colour has a depth")
        XCTAssertEqual(SkinPalette.of(.midnight, tint: .aurore, depth: .accent).accent, SkinColor(css: "#f472b6"))
    }

    func testATintTheFamilyLacksIsIgnored() {
        // Pulsatrix is already blue: no Blue variant; the phone's own skins take none
        XCTAssertNil(SkinTints.tint("blue", on: .pulsatrix))
        XCTAssertEqual(SkinPalette.of(.pulsatrix, tint: .blue, depth: .accent), SkinPalette.of(.pulsatrix))
        XCTAssertEqual(SkinPalette.of(.black, tint: .red, depth: .full), SkinPalette.of(.black))
        XCTAssertNil(SkinTints.tint("xp", on: .retro98))
        XCTAssertEqual(SkinTints.depth("full"), .full)
        XCTAssertEqual(SkinTints.depth("deep"), .accent)
    }

    func testTheComputerAppearanceReadsAndWritesTheTint() {
        let read = ComputerAppearance(preferences: ["omb-skin": "midnight", "omb-skin-tint": "green", "omb-skin-depth": "full"])
        XCTAssertEqual(read.tint, .green)
        XCTAssertEqual(read.depth, .full)
        XCTAssertNil(ComputerAppearance(preferences: ["omb-skin": "pulsatrix", "omb-skin-tint": "blue"]).tint)
        // a font change keeps the colour; a skin picked on the phone writes none
        XCTAssertEqual(ComputerAppearance.preferences(skin: .midnight, font: .serif, retroUnlocked: false, tint: .green)["omb-skin-tint"], "green")
        XCTAssertNil(ComputerAppearance.preferences(skin: .midnight, font: .skin, retroUnlocked: false)["omb-skin-tint"])
    }

    /// The table is the stylesheets' own blocks, value for value.
    func testTintTableMatchesTheStylesheets() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let files = ["src/styles.css", "src/styles/skin-depth.css", "src/styles/skin-duo.css", "src/styles/skin-ambiance.css"]
        var text = ""
        for file in files {
            guard let part = try? String(contentsOf: root.appendingPathComponent(file), encoding: .utf8) else {
                throw XCTSkip("\(file) is not next to this package")
            }
            text += "\n" + part
        }
        for (key, tokens) in SkinTints.table {
            let parts = key.split(separator: "|").map(String.init)
            var selector = "[data-skin=\"\(parts[0])\"][data-skin-tint=\"\(parts[1])\"]"
            if parts.count == 3 { selector += "[data-skin-depth=\"full\"]" }
            guard let start = text.range(of: "\n\(selector) {") else { XCTFail("no block for \(key)"); continue }
            let rest = text[start.upperBound...]
            let block = rest[..<(rest.range(of: "\n}")?.lowerBound ?? rest.endIndex)]
            for (name, value) in tokens {
                guard let line = block.range(of: "--color-\(name):") else { XCTFail("\(key) has no --color-\(name)"); continue }
                let stored = block[line.upperBound...].prefix { $0 != ";" }.trimmingCharacters(in: .whitespaces).lowercased()
                XCTAssertEqual(stored, value, "\(key) --color-\(name)")
            }
        }
    }
}

extension SkinTintsTests {
    func testSameAsMyComputerWearsTheComputersTint() {
        var selection = ThemeSelection(mode: .computer, computerSkin: .midnight)
        selection.computerTint = .green
        XCTAssertEqual(selection.palette(deviceDark: true).accent, SkinColor(css: "#4ade80"))
        // the phone's own pick never takes the computer's colour
        selection.mode = .fixed
        selection.fixedSkin = .midnight
        XCTAssertNil(selection.palette(deviceDark: true).tint)
    }
}
