import XCTest
@testable import CompanionCore

/// The default team's name reads in the app's language on the home (Grok Bot
/// iOS 1.14 writes "My Team"); every other section name stays as typed.
final class MyTeamSectionNameTests: XCTestCase {
    func testMyTeamIsRecognisedWhateverItsCaseAndSpaces() {
        XCTAssertTrue(isMyTeamSectionName("My team"))
        XCTAssertTrue(isMyTeamSectionName("my team"))
        XCTAssertTrue(isMyTeamSectionName("MY TEAM"))
        XCTAssertTrue(isMyTeamSectionName("  My Team \n"))
    }

    func testOtherNamesAreNotMyTeam() {
        XCTAssertFalse(isMyTeamSectionName("My teams"))
        XCTAssertFalse(isMyTeamSectionName("Built-in"))
        XCTAssertFalse(isMyTeamSectionName("Mon équipe"))
        XCTAssertFalse(isMyTeamSectionName(""))
    }
}
