import XCTest
@testable import CompanionCore

final class UltracodeEffortTests: XCTestCase {
    func testPickerAddsUltracode() {
        let native = ["low", "medium", "high", "max"]
        XCTAssertEqual(UltracodeEffort.pickerLevels(native), native + [UltracodeEffort.id])
        XCTAssertTrue(UltracodeEffort.accepts(effort: UltracodeEffort.id, in: native))
        XCTAssertFalse(UltracodeEffort.accepts(effort: UltracodeEffort.id, in: []))
    }
}
