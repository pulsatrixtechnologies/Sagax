import XCTest
@testable import CompanionCore

/// Neutral provider badges (App Store 5.2): letters and our own tones only.
final class EngineMonogramTests: XCTestCase {
    func testKnownDriversHaveDistinctLetters() {
        let kinds = ["claudeAgent", "codex", "grok", "cursorAgent", "piAgent", "qwenAgent", "kimiAgent", "opencodeGo", "mistral"]
        let letters = kinds.compactMap { EngineMonogram(driverKind: $0, preset: nil)?.letters }
        XCTAssertEqual(letters, ["Cl", "Cx", "Gk", "Cu", "Pi", "Qw", "Ki", "OC", "Mi"])
        XCTAssertEqual(Set(letters).count, letters.count, "no two providers share a badge")
        XCTAssertEqual(EngineMonogram(driverKind: "grokAgent", preset: nil)?.letters, "Gk")
    }

    func testPresetWinsOverDriver() {
        XCTAssertEqual(EngineMonogram(driverKind: "piAgent", preset: "openrouter")?.letters, "OR")
        XCTAssertEqual(EngineMonogram(driverKind: "piAgent", preset: "anthropic")?.letters, "Cl")
        XCTAssertEqual(EngineMonogram(driverKind: "piAgent", preset: "unknown")?.letters, "Pi", "an unknown preset falls back to the driver")
        XCTAssertNil(EngineMonogram(driverKind: "someAgent", preset: nil))
    }

    func testInitialsFromAnyName() {
        XCTAssertEqual(EngineMonogram.initials("Open Code"), "OC")
        XCTAssertEqual(EngineMonogram.initials("linear"), "Li")
        XCTAssertEqual(EngineMonogram.initials("my-server"), "MS")
        XCTAssertEqual(EngineMonogram.initials("X"), "X")
        XCTAssertEqual(EngineMonogram.initials("42 atlas"), "At")
        XCTAssertNil(EngineMonogram.initials(""))
        XCTAssertNil(EngineMonogram.initials("  -- "))
    }

    func testNameToneIsStableAndInRange() {
        let a = EngineMonogram(name: "Atlas")
        XCTAssertEqual(a, EngineMonogram(name: "atlas"))
        XCTAssertEqual(a?.letters, "At")
        for name in ["Atlas", "Scout", "github", "notion", "slack"] {
            let tone = EngineMonogram(name: name)!.tone
            XCTAssertTrue((0..<EngineMonogram.toneCount).contains(tone))
        }
        XCTAssertEqual(EngineMonogram(letters: "Zz", tone: -1).tone, EngineMonogram.toneCount - 1)
    }
}
