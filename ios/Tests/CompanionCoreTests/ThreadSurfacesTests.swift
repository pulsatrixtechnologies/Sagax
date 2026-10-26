// Show threads off (TestFlight 79, 0.8.3): threads still showed on the
// iPhone with the switch off. The chat header's "All threads" button and the
// thread list it opens ignored the switch, and so did a group's thread
// entries and Search's Threads scope. Every thread element now asks one
// value (`ThreadSurfaces`), and these tests hold each surface to it.
import XCTest
@testable import CompanionCore

final class ThreadSurfacesTests: XCTestCase {
    private func surfaces(_ values: [String: String], location: ThreadsLocation = .header) -> ThreadSurfaces {
        ThreadSurfaces(prefs: SidebarPrefs(values: values), location: location)
    }

    func testThreadsOffDrawsNoThreadElementAnywhere() {
        for location in ThreadsLocation.allCases {
            let off = surfaces([SidebarPrefKey.showThreads: "0"], location: location)
            for surface in ThreadSurface.allCases {
                XCTAssertFalse(off.allows(surface), "\(surface) shown with threads off (\(location))")
            }
            XCTAssertNil(off.headerButtonCount(threadCount: 5), "header threads button with threads off")
            XCTAssertFalse(off.nameMenuThreads(isBot: true))
            XCTAssertFalse(off.nameMenuThreads(isBot: false), "a group's Threads with threads off")
            XCTAssertEqual(off.rowThreadCount(4), 0)
            XCTAssertEqual(off.placement, ThreadsPlacement(inSidebar: false, inHeader: false))
        }
    }

    func testNeverChosenIsOffAsOnTheDesktop() {
        let unset = surfaces([:])
        XCTAssertFalse(unset.shown)
        XCTAssertTrue(ThreadSurface.allCases.allSatisfy { !unset.allows($0) })
    }

    func testThreadsOnKeepsTheirSurfacesAndTheLocationRule() {
        let header = surfaces([SidebarPrefKey.showThreads: "1"], location: .header)
        XCTAssertTrue(header.allows(.headerPicker))
        XCTAssertFalse(header.allows(.sidebarTree))
        XCTAssertEqual(header.headerButtonCount(threadCount: 3), 3)
        XCTAssertNil(header.headerButtonCount(threadCount: 1), "one thread: the chat is all there is")
        XCTAssertTrue(header.nameMenuThreads(isBot: false))

        let sidebar = surfaces([SidebarPrefKey.showThreads: "1"], location: .sidebar)
        XCTAssertTrue(sidebar.allows(.sidebarTree))
        XCTAssertFalse(sidebar.allows(.headerPicker))
        XCTAssertFalse(sidebar.nameMenuThreads(isBot: true))
        XCTAssertEqual(sidebar.rowThreadCount(4), 4)
        for surface in [ThreadSurface.headerButton, .roomThreads, .newThread, .threadList, .transcriptReceipts, .search] {
            XCTAssertTrue(sidebar.allows(surface), "\(surface)")
        }
    }

    /// The desktop turns threads off: the `preferences` frame the phone
    /// receives flips every surface at once, without a relaunch.
    func testAPreferencesFrameFromTheDesktopTurnsEverySurfaceOffLive() {
        let before = SidebarPrefs(values: [SidebarPrefKey.showThreads: "1"])
        XCTAssertTrue(ThreadSurfaces(prefs: before, location: .header).allows(.headerButton))
        let after = before.receiving([SidebarPrefKey.showThreads: "0"], pending: [])
        let live = ThreadSurfaces(prefs: after, location: .header)
        XCTAssertTrue(ThreadSurface.allCases.allSatisfy { !live.allows($0) })
        // and back on the same way
        let again = after.receiving([SidebarPrefKey.showThreads: "1"], pending: [])
        XCTAssertTrue(ThreadSurfaces(prefs: again, location: .header).allows(.threadList))
    }

    /// A switch flipped on this phone wins over an older frame until saved.
    func testALocalChangeNotYetSavedIsNotUndoneByAFrame() {
        var prefs = SidebarPrefs(values: [SidebarPrefKey.showThreads: "1"])
        prefs.setShowThreads(false)
        let kept = prefs.receiving([SidebarPrefKey.showThreads: "1"], pending: [SidebarPrefKey.showThreads])
        XCTAssertFalse(ThreadSurfaces(prefs: kept, location: .header).shown)
    }

    func testSearchHasNoThreadsScopeWithThreadsOff() {
        XCTAssertFalse(SearchCatalog.scopes(mode: .search, organization: true, showThreads: false).contains(.threads))
        XCTAssertFalse(SearchCatalog.scopes(mode: .search, organization: false, showThreads: false).contains(.threads))
        XCTAssertTrue(SearchCatalog.scopes(mode: .search, organization: true, showThreads: true).contains(.threads))
        XCTAssertEqual(SearchCatalog.scopes(mode: .search, organization: false, showThreads: false), [.bots, .groups, .messages])
    }

    func testTheChatDrawsNoThreadReceiptWithThreadsOff() throws {
        func decode(_ json: String) throws -> Message { try JSONDecoder().decode(Message.self, from: Data(json.utf8)) }
        let receipt = try decode(#"{"id":"th","role":"bot","kind":"activity","at":1,"tool":{"name":"Opened thread"},"threadRef":{"botId":"b","threadId":"t","title":"Opened"}}"#)
        let reply = try decode(#"{"id":"txt","role":"bot","kind":"text","at":2,"text":"Done"}"#)
        let off = surfaces([SidebarPrefKey.showThreads: "0"])
        let rows = transcriptRows([receipt, reply], detail: .full, showThreads: off.allows(.transcriptReceipts))
        XCTAssertEqual(rows.map(\.head.id), ["txt"])
        XCTAssertEqual(chatMessages([receipt, reply], showThreads: off.allows(.transcriptReceipts)).map(\.id), ["txt"])
    }
}
