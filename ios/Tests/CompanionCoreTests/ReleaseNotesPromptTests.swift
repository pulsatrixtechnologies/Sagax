import XCTest
@testable import CompanionCore

/// The "What's new" decision and the seen record, as src/lib/release-notes.ts
/// decides and stores them (the cases of src/lib/release-notes.test.ts).
final class ReleaseNotesPromptTests: XCTestCase {
    func testStaysQuietOnAFreshInstallAndRecordsTheVersion() {
        let decision = ReleaseNotes.whatsNew(version: "0.4.5", dev: false, seen: nil, previouslyInstalled: false)
        XCTAssertFalse(decision.show)
        XCTAssertEqual(decision.seen, "0.4.5")
    }

    func testStaysQuietInDevAndForANonReleaseVersionWithoutARecord() {
        let dev = ReleaseNotes.whatsNew(version: "0.4.5", dev: true, seen: nil, previouslyInstalled: true)
        XCTAssertFalse(dev.show)
        XCTAssertNil(dev.seen)
        let odd = ReleaseNotes.whatsNew(version: "dev", dev: false, seen: nil, previouslyInstalled: true)
        XCTAssertFalse(odd.show)
        XCTAssertNil(odd.seen)
    }

    func testShowsOncePerVersionAfterAnUpdateIncludingTheFirstLaunchOfThisFeature() {
        XCTAssertEqual(ReleaseNotes.whatsNew(version: "0.4.5", dev: false, seen: "0.4.4", previouslyInstalled: true).show, true)
        XCTAssertEqual(ReleaseNotes.whatsNew(version: "0.4.5", dev: false, seen: nil, previouslyInstalled: true).show, true)
        let again = ReleaseNotes.whatsNew(version: "0.4.5", dev: false, seen: "0.4.5", previouslyInstalled: true)
        XCTAssertFalse(again.show)
        XCTAssertEqual(again.seen, "0.4.5")
        XCTAssertTrue(ReleaseNotes.isReleaseVersion("0.4.16"))
        XCTAssertTrue(ReleaseNotes.isReleaseVersion("1.0.0-beta.2"))
        XCTAssertFalse(ReleaseNotes.isReleaseVersion("0.4"))
    }

    func testTheSeenRecordRoundTripsAndReadsThePhonesPlainRecord() {
        XCTAssertEqual(ReleaseNotesSeen.read(ReleaseNotesSeen(version: "0.4.5").json), ReleaseNotesSeen(version: "0.4.5"))
        XCTAssertEqual(ReleaseNotesSeen.read(ReleaseNotesSeen(version: "0.4.5", previous: "0.4.2").json)?.previous, "0.4.2")
        XCTAssertEqual(ReleaseNotesSeen(version: "0.4.5", previous: "0.4.2").json, #"{"previous":"0.4.2","version":"0.4.5"}"#)
        XCTAssertNil(ReleaseNotesSeen(version: "0.4.5", previous: "0.4.5").previous)
        // the phone's first record was the plain version
        XCTAssertEqual(ReleaseNotesSeen.read("0.4.14"), ReleaseNotesSeen(version: "0.4.14"))
        XCTAssertNil(ReleaseNotesSeen.read("not json"))
        XCTAssertNil(ReleaseNotesSeen.read(nil))
    }

    func testSeeingANewVersionKeepsTheOneBeforeForChangesSince() {
        let seen = ReleaseNotesSeen(version: "0.4.14").seeing("0.4.16")
        XCTAssertEqual(seen, ReleaseNotesSeen(version: "0.4.16", previous: "0.4.14"))
        XCTAssertEqual(seen.lastVersion(before: "0.4.16"), "0.4.14")
        XCTAssertEqual(seen.seeing("0.4.16"), seen)
        XCTAssertEqual(ReleaseNotesSeen(version: "0.4.14").lastVersion(before: "0.4.16"), "0.4.14")
    }
}
