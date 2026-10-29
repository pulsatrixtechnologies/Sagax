import XCTest
@testable import CompanionCore

/// A routine renamed in place (2026-10-29): trimmed, an empty name refused.
final class RoutineRenameTests: XCTestCase {
    func testTrimsTheName() {
        XCTAssertEqual(RoutineName.clean("  Project health watch \n"), "Project health watch")
    }

    func testRefusesAnEmptyName() {
        XCTAssertNil(RoutineName.clean(""))
        XCTAssertNil(RoutineName.clean("   \n\t"))
    }

    func testCapsALongName() {
        XCTAssertEqual(RoutineName.clean(String(repeating: "a", count: 300))?.count, RoutineName.max)
    }
}
