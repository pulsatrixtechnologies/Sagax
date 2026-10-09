import Foundation
import XCTest
@testable import CompanionCore

/// DC29 follow-up: on a light skin every character wears the desktop's
/// silhouette drop shadow (`--mascot-filter`, src/styles.css); dark skins
/// wear none. The tones are read back from the desktop's own stylesheet.
final class MascotShadowTests: XCTestCase {
    private func styles() throws -> String {
        // ios/Tests/CompanionCoreTests/<this file> -> the repository root
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("src/styles.css"), encoding: .utf8)
    }

    /// `rgba(r,g,b,a)` of a custom property inside one skin's block.
    private func rgba(_ property: String, skin: String, in css: String) -> (UInt32, Double)? {
        guard let start = css.range(of: "[data-skin=\"\(skin)\"] {"),
              let end = css.range(of: "}", range: start.upperBound..<css.endIndex) else { return nil }
        let block = String(css[start.upperBound..<end.lowerBound])
        guard let line = block.components(separatedBy: "\n").first(where: { $0.contains("\(property):") }),
              let open = line.range(of: "rgba("), let close = line.range(of: ")", range: open.upperBound..<line.endIndex) else { return nil }
        let parts = line[open.upperBound..<close.lowerBound].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 4, let r = UInt32(parts[0]), let g = UInt32(parts[1]), let b = UInt32(parts[2]), let a = Double(parts[3]) else { return nil }
        return (r << 16 | g << 8 | b, a)
    }

    func testLightSkinsWearTheDesktopShadowAndDarkSkinsNone() throws {
        let css = try styles()
        for id in SkinID.allCases {
            let tone = SkinPalette.of(id).mascotShadow
            if SkinPalette.of(id).isDark {
                XCTAssertNil(tone, "\(id.rawValue) is dark: no shadow")
                continue
            }
            let shadow = try XCTUnwrap(tone, "\(id.rawValue) is light: a shadow")
            let color = try XCTUnwrap(rgba("--mascot-shadow-color", skin: id.rawValue, in: css), "\(id.rawValue) in styles.css")
            let wide = try XCTUnwrap(rgba("--mascot-shadow-wide", skin: id.rawValue, in: css))
            XCTAssertEqual(shadow.color.hex, color.0, id.rawValue)
            XCTAssertEqual(shadow.color.alpha, color.1, accuracy: 1e-9, id.rawValue)
            XCTAssertEqual(shadow.wide.hex, wide.0, id.rawValue)
            XCTAssertEqual(shadow.wide.alpha, wide.1, accuracy: 1e-9, id.rawValue)
        }
    }

    func testTheFilterHasTheDesktopsThreeLayers() throws {
        let css = try styles()
        XCTAssertTrue(css.contains("--mascot-filter: drop-shadow(0 0 1px var(--mascot-shadow-color)) drop-shadow(0 1px 2px var(--mascot-shadow-color)) drop-shadow(0 3px 8px var(--mascot-shadow-wide));"))
        XCTAssertEqual(MascotShadowTone.layers.map(\.y), [0, 1, 3])
        XCTAssertEqual(MascotShadowTone.layers.map(\.blur), [1, 2, 8])
        XCTAssertEqual(MascotShadowTone.layers.map(\.wide), [false, false, true])
    }
}
