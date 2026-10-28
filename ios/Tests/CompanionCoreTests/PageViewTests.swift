// The page view (2026-10-28): the card's line, the preview address, the
// place a frame reports, Share's requests, the bot's line over the floating
// composer and the page a message is about. The desktop's own tests:
// src/components/PublishedPages.test.ts, src/components/PageShare.test.ts,
// src/components/PageComposerParts.test.ts, src/lib/open-page.test.ts,
// shared/data-context.test.ts.
import Foundation
import XCTest
@testable import CompanionCore

final class PageViewTests: XCTestCase {
    private func page(_ status: String = "draft", access: String = "private", current: Int? = nil,
                      versions: [(Int, String)] = [(1, "proposed")], expiresAt: Double? = nil,
                      botId: String = "bot-a", updatedAt: Double = 1, pinned: Bool = false) throws -> PublishedPageSummary {
        let list = versions.map { #"{"n":\#($0.0),"title":"Plan","state":"\#($0.1)"}"# }.joined(separator: ",")
        let json = #"""
        {"id":"page_id_1","title":"Plan","status":"\#(status)","access":"\#(access)",
         "currentVersion":\#(current.map(String.init) ?? "null"),"expiresAt":\#(expiresAt.map { String(Int($0)) } ?? "null"),
         "botId":"\#(botId)","threadId":"thread-a","updatedAt":\#(Int(updatedAt)),"pinned":\#(pinned),
         "versions":[\#(list)]}
        """#
        return try JSONDecoder().decode(PublishedPageSummary.self, from: Data(json.utf8))
    }

    private func message(_ role: String, _ kind: String = "text", at: Double, text: String?) throws -> Message {
        var object: [String: Any] = ["id": UUID().uuidString, "role": role, "kind": kind, "at": at]
        if let text { object["text"] = text }
        return try JSONDecoder().decode(Message.self, from: JSONSerialization.data(withJSONObject: object))
    }

    // MARK: Card

    func testTheCardLineSaysWhereTheVersionStands() throws {
        XCTAssertNil(PageViewRules.cardState(page: nil, version: 1))
        XCTAssertNil(PageViewRules.cardState(page: try page(), version: 4))
        XCTAssertEqual(PageViewRules.cardState(page: try page(), version: 1), .draft)
        XCTAssertEqual(PageViewRules.cardState(page: try page("published", current: 1, versions: [(1, "published")]), version: 1), .published)
        XCTAssertEqual(PageViewRules.cardState(page: try page("published", current: 1, versions: [(1, "published"), (2, "proposed")]), version: 2), .proposed)
        XCTAssertEqual(PageViewRules.cardState(page: try page(versions: [(1, "declined")]), version: 1), .declined)
        XCTAssertEqual(PageViewRules.cardState(page: try page("published", current: 2, versions: [(1, "proposed"), (2, "published")]), version: 1), .superseded)
        XCTAssertEqual(PageViewRules.cardState(page: try page(versions: [(1, "proposed"), (2, "proposed")]), version: 1), .superseded)
        XCTAssertEqual(PageViewRules.cardState(page: try page("revoked", versions: [(1, "proposed")]), version: 1), .revoked)
    }

    func testTheSummaryReadsItsBotPinAndInvites() throws {
        let json = #"{"id":"page_id_1","title":"Plan","botId":"bot-a","threadId":"t","pinned":true,"invites":{"people":["p1"],"teams":["t1"]}}"#
        let summary = try JSONDecoder().decode(PublishedPageSummary.self, from: Data(json.utf8))
        XCTAssertEqual(summary.botId, "bot-a")
        XCTAssertTrue(summary.pinned)
        XCTAssertEqual(summary.invites, PageInvites(people: ["p1"], teams: ["t1"]))
        let bare = try JSONDecoder().decode(PublishedPageSummary.self, from: Data(#"{"id":"page_id_1","invites":"x"}"#.utf8))
        XCTAssertEqual(bare.botId, "")
        XCTAssertFalse(bare.pinned)
        XCTAssertEqual(bare.invites, PageInvites.none)
    }

    // MARK: Preview address

    func testThePreviewAddressCarriesTheAppsLookOnly() {
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: true, theme: .dark, y: 340),
                       "/pages/preview/abcdefgh/2?bare=1&theme=dark&y=340")
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: true, theme: .light, y: 0),
                       "/pages/preview/abcdefgh/2?bare=1&theme=light&y=0")
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: false, theme: nil, y: nil), "/pages/preview/abcdefgh/2")
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: true, theme: nil, y: -1), "/pages/preview/abcdefgh/2?bare=1")
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: true, theme: nil, y: 10_000_001), "/pages/preview/abcdefgh/2?bare=1")
        for bad in ["/pages/preview/abcdefgh/2?x=1", "https://evil.example/pages/preview/abcdefgh/2", "/pages/frame/abcdefgh/2", ""] {
            XCTAssertNil(PageViewRules.previewSrc(bad, bare: true, theme: .dark, y: 0), bad)
        }
    }

    func testThePreviewRequestIsOnTheApiWithItsQuery() throws {
        let connection = Connection(id: "c", name: "c", host: "bot.example", port: 8799)
        let client = CompanionClient(connection: connection, token: "tok")
        let request = try client.pagePreviewRequest(path: "/pages/preview/abcdefgh/2", bare: true, theme: .dark, y: 12)
        let url = try XCTUnwrap(request.url)
        XCTAssertEqual(url.path, "/pages/preview/abcdefgh/2")
        XCTAssertEqual(url.query, "bare=1&theme=dark&y=12")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertThrowsError(try client.pagePreviewRequest(path: "/api/config", bare: true, theme: nil, y: nil))
    }

    // MARK: Scroll message

    func testAScrollReportIsOnlyAWholeNumber() {
        XCTAssertEqual(PageViewRules.parseScroll(["type": "sagax-page-scroll", "v": 1, "y": 420]), 420)
        XCTAssertEqual(PageViewRules.parseScroll(["type": "sagax-page-scroll", "v": 1, "y": 0]), 0)
        XCTAssertEqual(PageViewRules.parseScroll(["type": "sagax-page-scroll", "v": 1, "y": 420.0]), 420)
        for bad: Any? in [
            nil, "sagax-page-scroll", [1, 2],
            ["type": "sagax-page-scroll", "v": 2, "y": 1],
            ["type": "sagax-page-annotation", "v": 1, "y": 1],
            ["type": "sagax-page-scroll", "v": 1, "y": -1],
            ["type": "sagax-page-scroll", "v": 1, "y": 1.5],
            ["type": "sagax-page-scroll", "v": 1, "y": "12"],
            ["type": "sagax-page-scroll", "v": 1, "y": true],
            ["type": "sagax-page-scroll", "v": true, "y": 3],
            ["type": "sagax-page-scroll", "v": 1, "y": 10_000_001],
            ["type": "sagax-page-scroll", "v": 1, "y": Double.infinity],
        ] {
            XCTAssertNil(PageViewRules.parseScroll(bad), String(describing: bad))
        }
    }

    func testPlacesAreKeptPerPageAndBounded() {
        let places = PagePlaces()
        XCTAssertEqual(places.place("page_id_1"), 0)
        places.remember("page_id_1", y: 300)
        places.remember("bad", y: 10)
        places.remember("page_id_2", y: -4)
        XCTAssertEqual(places.place("page_id_1"), 300)
        XCTAssertEqual(places.place("bad"), 0)
        XCTAssertEqual(places.place("page_id_2"), 0)
        for index in 0..<(PagePlaces.maxPlaces + 5) { places.remember("page_id_x\(index)", y: index) }
        XCTAssertEqual(places.place("page_id_1"), 0)
        XCTAssertEqual(places.place("page_id_x\(PagePlaces.maxPlaces + 4)"), PagePlaces.maxPlaces + 4)
    }

    // MARK: Versions and title

    func testTheVersionShownFollowsTheBot() throws {
        let p = try page(versions: [(1, "proposed"), (2, "proposed")])
        XCTAssertEqual(PageViewRules.versionToShow(page: p, asked: 1), 1)
        XCTAssertEqual(PageViewRules.versionToShow(page: p, asked: 9), 2)
        XCTAssertEqual(PageViewRules.versionToShow(page: nil, asked: 3), 3)
        XCTAssertEqual(PageViewRules.newerVersion(shown: 1, latest: 2), 2)
        XCTAssertNil(PageViewRules.newerVersion(shown: 2, latest: 2))
        XCTAssertNil(PageViewRules.newerVersion(shown: 2, latest: nil))
        XCTAssertEqual(PageViewRules.newerVersion(shown: nil, latest: 1), 1)
        let a = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"a","role":"bot","kind":"text","at":1,"pagePublish":{"pageId":"page_id_1","version":1,"title":"P"}}"#.utf8))
        let b = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"b","role":"bot","kind":"text","at":2,"pagePublish":{"pageId":"page_id_1","version":3,"title":"P"}}"#.utf8))
        let c = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"c","role":"bot","kind":"text","at":3,"pagePublish":{"pageId":"page_id_2","version":7,"title":"P"}}"#.utf8))
        XCTAssertEqual(PageViewRules.latestVersion(in: [a, b, c], pageId: "page_id_1"), 3)
        XCTAssertNil(PageViewRules.latestVersion(in: [c], pageId: "page_id_1"))
    }

    func testARenameSendsOneTrimmedLine() {
        XCTAssertEqual(PageViewRules.renameTitle(draft: "  Weekly \n plan ", current: "Plan"), "Weekly plan")
        XCTAssertNil(PageViewRules.renameTitle(draft: "   ", current: "Plan"))
        XCTAssertNil(PageViewRules.renameTitle(draft: "Plan", current: "Plan"))
        XCTAssertEqual(PageViewRules.renameTitle(draft: String(repeating: "x", count: 300), current: "")?.count, 120)
    }

    // MARK: Status line

    func testTheBotLineSaysWorkingThenItsNewestReply() throws {
        let opened = 1_000.0
        XCTAssertEqual(PageViewRules.statusLine(messages: [], busy: true, openedAt: opened), .working)
        XCTAssertNil(PageViewRules.statusLine(messages: [], busy: false, openedAt: opened))
        let before = try message("bot", at: 900, text: "Earlier")
        XCTAssertNil(PageViewRules.statusLine(messages: [before], busy: false, openedAt: opened))
        let ask = try message("user", at: 1_100, text: "Make it blue")
        let reply = try message("bot", at: 1_200, text: "## Done\n\n**Blue** now, with `code`.")
        XCTAssertEqual(PageViewRules.statusLine(messages: [before, ask, reply], busy: false, openedAt: opened), .reply("Done Blue now, with code."))
        let tool = try message("bot", "activity", at: 1_300, text: "ran a tool")
        XCTAssertEqual(PageViewRules.statusLine(messages: [before, ask, reply, tool], busy: false, openedAt: opened), .reply("Done Blue now, with code."))
        let long = try message("bot", at: 1_400, text: String(repeating: "word ", count: 60))
        guard case let .reply(cut)? = PageViewRules.statusLine(messages: [long], busy: false, openedAt: opened) else { return XCTFail("no reply") }
        XCTAssertTrue(cut.hasSuffix("…"))
        XCTAssertLessThanOrEqual(cut.count, 160)
    }

    // MARK: Page context

    func testAMessageFromTheOpenPageCarriesThePage() throws {
        let open = OpenPageRef(pageId: "page_id_1", botId: "bot-a", threadId: "t", title: "Plan", version: 2, openedAt: 0)
        XCTAssertEqual(PageViewRules.pageContext(text: "Make it blue", page: open, title: "Plan v2", version: 2, botId: "bot-a"),
                       PageContextRef(pageId: "page_id_1", title: "Plan v2", version: 2))
        XCTAssertNil(PageViewRules.pageContext(text: "", page: open, title: "Plan", version: 2, botId: "bot-a"))
        XCTAssertNil(PageViewRules.pageContext(text: "hi", page: open, title: "Plan", version: 2, botId: "bot-b"))
        XCTAssertNil(PageViewRules.pageContext(text: "hi", page: nil, title: "Plan", version: 2, botId: "bot-a"))
        XCTAssertNil(PageViewRules.pageContext(text: "  /setup", page: open, title: "Plan", version: 2, botId: "bot-a"))
        XCTAssertNil(PageViewRules.pageContext(text: RunSteps.saveRunAsSkillLine + "\n1. x", page: open, title: "Plan", version: 2, botId: "bot-a"))
    }

    func testThePageTravelsOnTheBotRouteOnly() {
        let ref = PageContextRef(pageId: "page_id_1", title: "Plan", version: 2)
        var body: [String: Any] = [:]
        SendOptions(page: ref).apply(to: &body, destination: .bot(id: "b", threadId: "t"))
        let context = body["dataContext"] as? [String: Any]
        let page = context?["page"] as? [String: Any]
        XCTAssertEqual(page?["pageId"] as? String, "page_id_1")
        XCTAssertEqual(page?["title"] as? String, "Plan")
        XCTAssertEqual(page?["version"] as? Int, 2)
        var room: [String: Any] = [:]
        SendOptions(page: ref).apply(to: &room, destination: .room(id: "r", threadId: "t"))
        XCTAssertNil(room["dataContext"])
        var bad: [String: Any] = [:]
        SendOptions(page: PageContextRef(pageId: "../x", title: "x")).apply(to: &bad, destination: .bot(id: "b", threadId: "t"))
        XCTAssertNil(bad["dataContext"])
    }

    func testAMessageReadsItsPageContext() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"user","kind":"text","at":1,"text":"Make it blue","dataContext":{"page":{"pageId":"page_id_1","title":"Plan","version":2}}}
        """#.utf8))
        XCTAssertEqual(message.dataContext?.page, PageContextRef(pageId: "page_id_1", title: "Plan", version: 2))
        XCTAssertEqual(message.dataContext?.page?.isDrawable, true)
        let odd = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m","role":"user","kind":"text","at":1,"text":"x","dataContext":{"cardId":"c","page":"oops"}}"#.utf8))
        XCTAssertEqual(odd.text, "x")
        XCTAssertEqual(odd.dataContext?.cardId, "c")
        XCTAssertNotEqual(odd.dataContext?.page?.isDrawable, true)
    }

    // MARK: Share

    func testAPageNotSharedYetIsPublishedByTheGesture() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let draft = try page()
        XCTAssertEqual(PageShareRules.plan(page: draft, version: 2, change: .access(.org), now: now),
                       [PageShareStep(method: "POST", path: "/publish", body: ["version": 2, "access": "org", "expiresAt": NSNull()])])
        let invites = PageInvites(people: ["p1"], teams: [])
        XCTAssertEqual(PageShareRules.plan(page: draft, version: 2, change: .invites(invites), now: now), [
            PageShareStep(method: "POST", path: "/invite", body: ["people": ["p1"], "teams": [String]()]),
            PageShareStep(method: "POST", path: "/publish", body: ["version": 2, "access": "private", "expiresAt": NSNull()]),
        ])
        XCTAssertEqual(PageShareRules.plan(page: draft, version: 2, change: .link, now: now),
                       [PageShareStep(method: "POST", path: "/publish", body: ["version": 2, "access": "private", "expiresAt": NSNull()])])
        XCTAssertEqual(PageShareRules.plan(page: draft, version: 2, change: .expiry(hours: 24), now: now), [])
        XCTAssertEqual(PageShareRules.plan(page: draft, version: 2, change: .version, now: now), [])
        XCTAssertEqual(PageShareRules.plan(page: draft, version: 2, change: .stop, now: now), [])
    }

    func testASharedPageIsChangedInPlace() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let shared = try page("published", access: "org", current: 1, versions: [(1, "published"), (2, "proposed")], expiresAt: 5_000_000)
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .access(.org), now: now), [])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .access(.link), now: now),
                       [PageShareStep(method: "PATCH", path: "", body: ["access": "link"])])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .invites(.none), now: now),
                       [PageShareStep(method: "POST", path: "/invite", body: ["people": [String](), "teams": [String]()])])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .link, now: now), [])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .expiry(hours: 0), now: now),
                       [PageShareStep(method: "PATCH", path: "", body: ["expiresAt": NSNull()])])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .expiry(hours: 24), now: now),
                       [PageShareStep(method: "PATCH", path: "", body: ["expiresAt": 1_000_000 + 24 * 3_600_000])])
        // a newer version keeps the expiry still ahead
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .version, now: now),
                       [PageShareStep(method: "POST", path: "/publish", body: ["version": 2, "access": "org", "expiresAt": 5_000_000.0])])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 1, change: .version, now: now), [])
        XCTAssertEqual(PageShareRules.plan(page: shared, version: 2, change: .stop, now: now),
                       [PageShareStep(method: "POST", path: "/revoke", body: [:])])
        let lapsed = try page("published", access: "org", current: 1, versions: [(1, "published"), (2, "proposed")], expiresAt: 10)
        XCTAssertEqual(PageShareRules.plan(page: lapsed, version: 2, change: .version, now: now),
                       [PageShareStep(method: "POST", path: "/publish", body: ["version": 2, "access": "org", "expiresAt": NSNull()])])
    }

    func testInvitesAddAndRemoveOnce() {
        let one = PageShareRules.withInvite(nil, person: true, id: "P1", add: true)
        XCTAssertEqual(one, PageInvites(people: ["P1"], teams: []))
        let again = PageShareRules.withInvite(one, person: true, id: "p1", add: true)
        XCTAssertEqual(again, PageInvites(people: ["p1"], teams: []))
        let team = PageShareRules.withInvite(again, person: false, id: "t1", add: true)
        XCTAssertEqual(team, PageInvites(people: ["p1"], teams: ["t1"]))
        XCTAssertEqual(PageShareRules.withInvite(team, person: true, id: "P1", add: false), PageInvites(people: [], teams: ["t1"]))
    }

    func testTeamCandidatesAndTheAccessRows() throws {
        let teams = [OrgDirectoryTeam(id: "t1", name: "Design", members: ["a", "b"], managers: ["a"]), OrgDirectoryTeam(id: "t2", name: "Docs")]
        XCTAssertEqual(PageShareRules.teamCandidates(teams, invited: ["T1"], query: "d").map(\.id), ["t2"])
        XCTAssertEqual(PageShareRules.teamCandidates(teams, invited: [], query: "sign").map(\.id), ["t1"])
        XCTAssertEqual(teams[0].size, 2)
        let draft = try page(access: "org")
        XCTAssertEqual(PageShareRules.shownAccess(draft), .private)
        let shared = try page("published", access: "org", current: 1, versions: [(1, "published")])
        XCTAssertEqual(PageShareRules.shownAccess(shared), .org)
        XCTAssertTrue(PageShareRules.isOff(.link, page: shared, policy: PagesPolicy(linkSharing: false, readerComments: true)))
        XCTAssertFalse(PageShareRules.isOff(.link, page: shared, policy: .default))
        XCTAssertFalse(PageShareRules.isOff(.org, page: shared, policy: PagesPolicy(linkSharing: false, readerComments: true)))
        XCTAssertTrue(PageShareRules.needsLinkConfirm(from: .org, to: .link))
        XCTAssertFalse(PageShareRules.needsLinkConfirm(from: .link, to: .link))
        XCTAssertFalse(PageShareRules.needsLinkConfirm(from: .private, to: .org))
    }

    func testTheLibraryListsThisBotsPagesNewestFirst() throws {
        let a = try page(botId: "bot-a", updatedAt: 5)
        let b = try page(botId: "bot-b", updatedAt: 9)
        var c = try page(botId: "bot-a", updatedAt: 7)
        c.id = "page_id_2"
        XCTAssertEqual(PageLibraryRules.pages([a, b, c], botId: "bot-a").map(\.id), ["page_id_2", "page_id_1"])
    }
}

final class PageLibraryGroupTests: XCTestCase {
    func testPagesSitInPinnedAndThisWeek() throws {
        let day = 24 * 3_600_000.0
        let now = 30 * day
        func page(_ id: String, _ updatedAt: Double, pinned: Bool) throws -> PublishedPageSummary {
            try JSONDecoder().decode(PublishedPageSummary.self, from: Data(#"{"id":"\#(id)","title":"P","botId":"b","updatedAt":\#(Int(updatedAt)),"pinned":\#(pinned)}"#.utf8))
        }
        let pinned = try page("page_pin_1", now - 20 * day, pinned: true)
        let recent = try page("page_new_1", now - day, pinned: false)
        let old = try page("page_old_1", now - 10 * day, pinned: false)
        let groups = LibraryRules.groups(files: [], artifacts: [], pages: [pinned, recent, old], now: now)
        XCTAssertEqual(groups.pinned.map(\.id), ["page:page_pin_1"])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["page:page_new_1"])
        XCTAssertEqual(groups.older.map(\.id), ["page:page_old_1"])
    }
}
