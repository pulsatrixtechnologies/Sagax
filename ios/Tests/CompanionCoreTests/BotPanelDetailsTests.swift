// WP7 of the iOS feature parity matrix: the bot panel's details, against the
// desktop's own logic (src/lib/bot-activity.ts, src/lib/activity-steps.ts,
// src/lib/chat-files.ts, src/lib/usage.ts, src/lib/primary-bot.ts,
// shared/achievements.ts) and the wire shapes of shared/bot-activity.ts.
import Foundation
import XCTest
@testable import CompanionCore

private final class PanelRequestStub: URLProtocol {
    static var responses: [String: (Int, String)] = [:]
    static var captured: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured.append(request)
        let path = request.url!.path
        let (status, body) = Self.responses[path] ?? (404, #"{"error":"not found"}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class BotPanelDetailsTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        PanelRequestStub.responses = [:]
        PanelRequestStub.captured = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PanelRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func item(_ id: String, _ status: BotActivityStatus, coding: Bool? = nil, kind: BotActivityKind = .session, started: Double = 0, updated: Double? = nil, title: String = "Task") -> BotActivityItem {
        BotActivityItem(id: id, kind: kind, botId: "b", title: title, status: status, startedAt: started, updatedAt: updated, threadId: "t-\(id)", coding: coding, canStop: true)
    }

    // MARK: Activity wire and requests

    func testDecodesTheListAndTheDetailAsTheServerSendsThem() throws {
        let list = try JSONDecoder().decode(BotActivityList.self, from: Data(#"""
        {"items":[{"id":"thread:t1","kind":"session","botId":"b1","title":"Fix the build","status":"running",
        "startedAt":1000,"updatedAt":2000,"threadId":"t1","coding":true,"currentStep":"Bash","canStop":true,"childCount":2},
        {"id":"run:r1","kind":"routine","botId":"b1","title":"Daily","status":"weird","startedAt":5,"updatedAt":6,
        "startedBy":{"kind":"routine","name":"Daily"}}],"subagents":[]}
        """#.utf8))
        XCTAssertEqual(list.items.count, 2)
        XCTAssertEqual(list.items[0].status, .running)
        XCTAssertTrue(list.items[0].stoppable)
        XCTAssertEqual(list.items[1].status, .finished, "an unknown status reads as finished")
        XCTAssertFalse(list.items[1].stoppable, "no thread, no Stop")

        PanelRequestStub.responses["/api/bots/b1/activity/item"] = (200, #"""
        {"item":{"id":"thread:t1","kind":"session","botId":"b1","title":"Fix","status":"running","startedAt":1,"updatedAt":2,
        "threadId":"t1","engine":{"instanceId":"claude","model":"opus"},"via":"owner-key","steps":[
        {"id":"s1","name":"Agent","at":1,"subagent":{"description":"check logs"}},
        {"id":"s2","name":"Read","at":2,"ok":true,"parentId":"s1","where":"server"},
        {"id":"s3","name":"mcp__sagax__run_command","at":3}],
        "stepsTruncated":true,"files":["/tmp/a.txt"],"children":[],"canStop":true}}
        """#)
        let expectation = expectation(description: "detail")
        Task {
            let detail = try await client.botActivityDetail(botId: "b1", itemId: "thread:t1")
            XCTAssertEqual(detail.via, .ownerKey)
            XCTAssertEqual(detail.engine?.model, "opus")
            XCTAssertTrue(detail.stoppable)
            XCTAssertTrue(detail.stepsTruncated)
            let tree = BotActivityStepLabel.tree(detail.steps)
            XCTAssertEqual(tree.top.map(\.id), ["s1", "s3"])
            XCTAssertEqual(tree.children["s1"]?.map(\.id), ["s2"])
            XCTAssertEqual(BotActivityStepLabel.of(detail.steps[0]), .subagent("check logs"))
            XCTAssertEqual(BotActivityStepLabel.of(detail.steps[1]), .readFile)
            XCTAssertEqual(BotActivityStepLabel.of(detail.steps[2]), .runCommand)
            XCTAssertEqual(detail.steps[1].where, .server)
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 5)
        let request = try XCTUnwrap(PanelRequestStub.captured.last)
        XCTAssertEqual(request.url?.query, "threadId=t1")
    }

    func testRequestsCarryTheFilterLimitAndTheEntryKind() throws {
        let list = try client.botActivityRequest(botId: "b1", filter: .coding, limit: 50)
        XCTAssertEqual(list.httpMethod, "GET")
        XCTAssertEqual(list.url?.path, "/api/bots/b1/activity")
        XCTAssertEqual(list.url?.query, "filter=coding&limit=50")
        let run = try client.botActivityDetailRequest(botId: "b1", itemId: "run:r-9")
        XCTAssertEqual(run.url?.query, "runId=r-9")
        XCTAssertThrowsError(try client.botActivityDetailRequest(botId: "b/1", itemId: "thread:x"))
        XCTAssertThrowsError(try client.botActivityDetailRequest(botId: "b1", itemId: "thread:"))
        let primary = try client.makePrimaryBotRequest(botId: "b1")
        XCTAssertEqual(primary.httpMethod, "POST")
        XCTAssertEqual(primary.url?.path, "/api/bots/b1/primary")
    }

    func testSteerSendsAMessageThatJoinsTheRunningTask() throws {
        PanelRequestStub.responses["/api/bots/b1/messages"] = (200, #"{"queued":false}"#)
        let done = expectation(description: "steer")
        Task {
            try await client.steerActivity(botId: "b1", threadId: "t1", text: "also check the tests")
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        let request = try XCTUnwrap(PanelRequestStub.captured.last)
        let body = try XCTUnwrap(request.httpBody ?? request.httpBodyStream.map { stream -> Data in
            stream.open(); defer { stream.close() }
            var data = Data(); var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 1024); if n <= 0 { break }; data.append(buffer, count: n) }
            return data
        })
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["busyMode"] as? String, "steer")
        XCTAssertEqual(json["threadId"] as? String, "t1")
        XCTAssertEqual(json["text"] as? String, "also check the tests")
        XCTAssertNotNil(json["sendId"] as? String)
    }

    // MARK: Activity lists

    func testCodingAndActivitySplitTheListNewestRunningFirst() {
        let items = [
            item("a", .finished, coding: true, updated: 9),
            item("b", .running, coding: true, updated: 1),
            item("c", .running, updated: 5),
            item("d", .queued, kind: .subagent, updated: 7),
        ]
        let sub = [item("d", .queued, kind: .subagent, updated: 7), item("e", .running, kind: .subagent, updated: 8)]
        XCTAssertEqual(BotActivityRules.codingLive(items).map(\.id), ["b", "a"])
        XCTAssertEqual(BotActivityRules.activityLive(items, subagents: sub).map(\.id), ["e", "d", "c"])
    }

    func testTheHistoryFiltersByStatusAndWordsNewestFirst() {
        let items = [
            item("a", .finished, started: 1, title: "Write the report"),
            item("b", .stopped, started: 3, title: "Deploy"),
            item("c", .failed, started: 2, title: "Deploy again"),
            item("d", .waiting, started: 4, title: "Ask about the report"),
        ]
        XCTAssertEqual(BotActivityRules.history(items, status: .all, search: "").map(\.id), ["d", "b", "c", "a"])
        XCTAssertEqual(BotActivityRules.history(items, status: .failed, search: "").map(\.id), ["b", "c"])
        XCTAssertEqual(BotActivityRules.history(items, status: .running, search: "").map(\.id), ["d"])
        XCTAssertEqual(BotActivityRules.history(items, status: .all, search: "  REPORT the ").map(\.id), ["d", "a"])
    }

    func testDurationsAndSubtitlesReadLikeTheDesktop() {
        XCTAssertEqual(BotActivityRules.duration(44_600), "45s")
        XCTAssertEqual(BotActivityRules.duration(12 * 60_000), "12m")
        XCTAssertEqual(BotActivityRules.duration(65 * 60_000), "1h 05m")
        var running = item("x", .running, kind: .hop, started: 0)
        running.startedBy = BotActivityActor(kind: .bot, name: "Atlas")
        running.currentStep = "Bash"
        running.childCount = 2
        XCTAssertEqual(
            BotActivitySubtitlePart.parts(for: running, now: 30_000),
            [.status(.running), .elapsed("30s"), .handedBy("Atlas"), .step("Bash"), .subagents(2)]
        )
        var done = item("y", .finished, kind: .routine)
        done.parallel = true
        XCTAssertEqual(BotActivitySubtitlePart.parts(for: done, now: 1), [.parallel, .status(.finished), .routine])
    }

    func testAFinishedJobLingersThenLeavesAndOneSeenSettledNeverShows() {
        var tracker = BotActivityLiveTracker()
        let start = Date(timeIntervalSince1970: 1000)
        tracker.update([item("a", .running), item("old", .finished)], at: start)
        XCTAssertTrue(tracker.visible(item("a", .running), at: start))
        XCTAssertFalse(tracker.visible(item("old", .finished), at: start))
        let settled = start.addingTimeInterval(2)
        tracker.update([item("a", .finished)], at: settled)
        XCTAssertTrue(tracker.visible(item("a", .finished), at: settled.addingTimeInterval(4)))
        XCTAssertFalse(tracker.fading(item("a", .finished), at: settled.addingTimeInterval(4)))
        XCTAssertTrue(tracker.fading(item("a", .finished), at: settled.addingTimeInterval(4.5)))
        XCTAssertFalse(tracker.visible(item("a", .finished), at: settled.addingTimeInterval(5)))
        XCTAssertEqual(tracker.nextChange(after: settled), settled.addingTimeInterval(4.3))
    }

    // MARK: Files

    private func file(_ name: String, _ source: ThreadFile.Source = .attachment, mime: String? = nil, at: Double, size: Int? = nil, path: String = "", local: String? = nil, available: Bool = true) -> ThreadFile {
        ThreadFile(id: name, source: source, name: name, mime: mime, at: at, size: size, available: available, path: path, localPath: local)
    }

    func testFilesClassifyByTypeThenExtension() {
        XCTAssertEqual(ThreadFileRules.kind(name: "a.bin", mime: "image/png; q=1"), .image)
        XCTAssertEqual(ThreadFileRules.kind(name: "notes.md", mime: "application/octet-stream"), .document)
        XCTAssertEqual(ThreadFileRules.kind(name: "Dockerfile", mime: nil), .code)
        XCTAssertEqual(ThreadFileRules.kind(name: "x.json", mime: "application/vnd.api+json"), .code)
        XCTAssertEqual(ThreadFileRules.kind(name: "a.zip", mime: nil), .archive)
        XCTAssertEqual(ThreadFileRules.filter(for: .archive), .other)
        XCTAssertEqual(ThreadFileRules.kind(name: ".hidden", mime: nil), .other)
    }

    func testFilesFilterSearchOriginAndSortAsTheDesktop() {
        let files = [
            file("b.png", .upload, at: 3, size: 10),
            file("a10.md", at: 2, size: nil),
            file("a9.md", at: 1, size: 500),
            file("c.zip", .written, at: 4, size: 100),
        ]
        let counts = ThreadFileRules.counts(files, origin: .all, search: "")
        XCTAssertEqual(counts[.all], 4)
        XCTAssertEqual(counts[.document], 2)
        XCTAssertEqual(counts[.other], 1)
        XCTAssertEqual(ThreadFileRules.visibleFilters(counts: counts, selected: .all), [.all, .image, .document, .other])
        XCTAssertEqual(ThreadFileRules.visibleFilters(counts: [.all: 2, .document: 2], selected: .all), [])
        XCTAssertEqual(ThreadFileRules.visible(files, query: ThreadFileQuery()).map(\.name), ["c.zip", "b.png", "a10.md", "a9.md"])
        XCTAssertEqual(ThreadFileRules.visible(files, query: ThreadFileQuery(sort: .name)).map(\.name), ["a9.md", "a10.md", "b.png", "c.zip"])
        XCTAssertEqual(ThreadFileRules.visible(files, query: ThreadFileQuery(sort: .size)).map(\.name), ["a9.md", "c.zip", "b.png", "a10.md"])
        XCTAssertEqual(ThreadFileRules.visible(files, query: ThreadFileQuery(origin: .you)).map(\.name), ["b.png"])
        XCTAssertEqual(ThreadFileRules.visible(files, query: ThreadFileQuery(filter: .document, search: "A1")).map(\.name), ["a10.md"])
    }

    func testOnlyAbsolutePathsAreOfferedToCopy() {
        XCTAssertEqual(ThreadFileRules.copyablePath("/Users/jc/a.txt"), "/Users/jc/a.txt")
        XCTAssertEqual(ThreadFileRules.copyablePath("C:\\work\\a.txt"), "C:\\work\\a.txt")
        XCTAssertEqual(ThreadFileRules.copyablePath("file:///Users/jc/My%20File.txt"), "/Users/jc/My File.txt")
        XCTAssertEqual(ThreadFileRules.copyablePath("file:///C:/work/a.txt"), "C:/work/a.txt")
        XCTAssertNil(ThreadFileRules.copyablePath("notes/a.txt"))
        XCTAssertEqual(ThreadFileRules.copyablePath(of: file("a", at: 0, path: "a", local: "/srv/a")), "/srv/a")
        XCTAssertNil(ThreadFileRules.copyablePath(of: file("a", at: 0, path: "/srv/a", available: false)))
    }

    func testThreadFilesDecodeTheirPaths() throws {
        let decoded = try JSONDecoder().decode(ThreadFile.self, from: Data(#"""
        {"id":"0123456789abcdef01234567","messageId":"m1","source":"written","path":"out/a.md","name":"a.md","at":5,
        "size":3,"available":true,"localPath":"/work/out/a.md"}
        """#.utf8))
        XCTAssertEqual(decoded.path, "out/a.md")
        XCTAssertEqual(decoded.localPath, "/work/out/a.md")
    }

    // MARK: Usage

    func testUsageSumsThreadsAndFormatsLikeTheDesktop() throws {
        let tasks = try JSONDecoder().decode([TaskUsage].self, from: Data(#"""
        [{"input":1000,"output":200,"cachedInput":400,"costUsd":0.004,"turns":2},
         {"input":12000,"output":400,"cachedInput":2000,"costUsd":0.5,"turns":3}]
        """#.utf8))
        let total = BotUsageTotal.sum(tasks)
        XCTAssertEqual(total.turns, 5)
        XCTAssertEqual(total.cachedInput, 2400)
        XCTAssertEqual(total.headlineTokens, 13000 - 2400 + 600)
        XCTAssertEqual(BotUsageTotal.formatUsd(total.costUsd!), "$0.50")
        XCTAssertEqual(BotUsageTotal.formatUsd(0.004), "$0.004")
        XCTAssertEqual(BotUsageTotal.formatUsd(0), "$0")
        XCTAssertEqual(BotUsageTotal.formatTokens(950), "950")
        XCTAssertEqual(BotUsageTotal.formatTokens(12_400), "12.4k")
        XCTAssertEqual(BotUsageTotal.formatTokens(2_000), "2k")
        XCTAssertEqual(BotUsageTotal.formatTokens(2_300_000), "2.3M")
        XCTAssertEqual(BotUsageTotal.formatTokens(150_000), "150k")
        let unknownCache = try JSONDecoder().decode([TaskUsage].self, from: Data(#"[{"input":10,"output":1,"turns":1},{"input":5,"output":1,"cachedInput":2,"turns":1}]"#.utf8))
        let mixed = BotUsageTotal.sum(unknownCache)
        XCTAssertNil(mixed.cachedInput, "an absent cache count is not zero")
        XCTAssertNil(mixed.costUsd)
        XCTAssertEqual(mixed.headlineTokens, 17)
    }

    // MARK: Primary Bot and notices

    private func bot(_ id: String, owner: String? = nil, primary: Bool = false, hidden: Bool = false, section: String? = nil, managed: [String]? = nil) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": primary, "hidden": hidden,
        ]
        if let owner { json["ownerUserId"] = owner }
        if let section { json["section"] = section }
        if let managed { json["managedSections"] = managed }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testThePrimaryBotMenuAndChoicesFollowOwnership() throws {
        let mine = try bot("mine", owner: "pr_me")
        let star = try bot("star", owner: "PR_ME", primary: true)
        let theirs = try bot("theirs", owner: "pr_other")
        let legacy = try bot("legacy", owner: "local-owner")
        let hidden = try bot("hidden", owner: "pr_me", hidden: true)
        XCTAssertEqual(PrimaryBotRules.menuAction(for: mine, viewerId: "pr_me"), .make)
        XCTAssertEqual(PrimaryBotRules.menuAction(for: star, viewerId: "pr_me"), .replace)
        XCTAssertNil(PrimaryBotRules.menuAction(for: theirs, viewerId: "pr_me"))
        XCTAssertEqual(PrimaryBotRules.menuAction(for: legacy, viewerId: "pr_me"), .make)
        XCTAssertNil(PrimaryBotRules.menuAction(for: hidden, viewerId: "pr_me"))
        XCTAssertEqual(PrimaryBotRules.choices([theirs, star, mine, hidden, legacy], viewerId: "pr_me", currentId: "star").map(\.id), ["legacy", "mine"])
        XCTAssertEqual(PrimaryBotRules.choices([mine, legacy], viewerId: "pr_me", currentId: nil, query: "leg").map(\.id), ["legacy"])
        var promoted = mine
        promoted.chiefOfStaff = true
        let fleet = PrimaryBotRules.withPrimary([mine, star, theirs], primary: promoted)
        XCTAssertEqual(fleet.map { $0.chiefOfStaff == true }, [true, false, false])
    }

    func testTheViewerIdComesFromThePrincipalThenTheEmail() throws {
        let principal = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"viewer":{"principalId":" PR_X ","botsReadOnly":true},"profile":{"name":"a","email":"a@b.c"}}"#.utf8))
        XCTAssertEqual(PrimaryBotRules.viewerId(config: principal), "pr_x")
        XCTAssertTrue(BotPanelNotices.botsReadOnly(principal))
        let email = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"profile":{"name":"a","email":"A@B.C"}}"#.utf8))
        XCTAssertEqual(PrimaryBotRules.viewerId(config: email), "a@b.c")
        XCTAssertFalse(BotPanelNotices.botsReadOnly(email))
        XCTAssertEqual(PrimaryBotRules.viewerId(config: nil), "local-owner")
    }

    func testAChiefCoversItsSectionAndTheSectionsItManages() throws {
        let target = try bot("target", section: "Ops")
        XCTAssertFalse(BotPanelNotices.chiefCovers(target, in: [target, try bot("x", section: "Ops")]))
        XCTAssertTrue(BotPanelNotices.chiefCovers(target, in: [target, try bot("chief", primary: true, section: " Ops ")]))
        XCTAssertTrue(BotPanelNotices.chiefCovers(target, in: [target, try bot("chief", primary: true, section: "Lead", managed: ["Ops"])]))
        XCTAssertFalse(BotPanelNotices.chiefCovers(target, in: [target, try bot("chief", primary: true, section: "Lead")]))
    }

    func testVoiceNotesEncodeAlone() throws {
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(BotProfileEdit(voiceNotes: false))) as? [String: Any]
        XCTAssertEqual(body?.count, 1)
        XCTAssertEqual(body?["voiceNotes"] as? Bool, false)
        XCTAssertFalse(BotProfileEdit(voiceNotes: true).isEmpty)
    }

    // MARK: Locks

    func testSkinLocksFollowTheEarnedRewardsAndTheWornSkinStays() {
        let earned = MascotUnlocks(enforced: true, keys: ["skin:owl:gold"])
        XCTAssertTrue(earned.skinUnlocked(.owl, skin: "carbon"), "Common comes with the character")
        XCTAssertTrue(earned.skinUnlocked(.owl, skin: "gold"))
        XCTAssertFalse(earned.skinUnlocked(.owl, skin: "inferno"))
        XCTAssertFalse(earned.skinLocked(.owl, skin: "inferno", current: "inferno"), "what the bot wears stays usable")
        XCTAssertTrue(earned.skinLocked(.owl, skin: "inferno", current: "none"))
        XCTAssertTrue(earned.characterLocked(.trombi, current: .owl))
        XCTAssertTrue(earned.characterLocked(.shape, current: .owl), "Shapes waits on a linked Grok account")
        XCTAssertFalse(earned.skinUnlocked(.shape, skin: "plain"), "a locked character's Common skins stay locked")
        XCTAssertFalse(earned.skinUnlocked(.trombi, skin: "classic"), "a locked character's Common skins stay locked")
        XCTAssertFalse(MascotUnlocks.nothingLocked.skinLocked(.trombi, skin: "neon", current: "classic"))
        XCTAssertEqual(MascotUnlocks.tier(.owl, skin: "lightning"), .epic)
        XCTAssertEqual(MascotUnlocks.tier(.shape, skin: "outline"), .rare)
        XCTAssertEqual(MascotUnlocks.tier(.trombi, skin: "retro98"), .common)
    }

    func testAServerWithoutAchievementsLocksNothing() throws {
        let missing = expectation(description: "404")
        Task {
            let unlocks = try await client.mascotUnlocks()
            XCTAssertEqual(unlocks, .nothingLocked)
            missing.fulfill()
        }
        wait(for: [missing], timeout: 5)
        PanelRequestStub.responses["/api/me/achievements"] = (200, #"{"points":1,"rewards":["character:trombi"],"items":[]}"#)
        let present = expectation(description: "200")
        Task {
            let unlocks = try await client.mascotUnlocks()
            XCTAssertTrue(unlocks.enforced)
            XCTAssertTrue(unlocks.characterUnlocked(.trombi))
            present.fulfill()
        }
        wait(for: [present], timeout: 5)
    }

    // MARK: Gate

    func testTheGateOpensTheWP7SurfacesPerPairing() {
        let sidecar = SurfaceGate(scope: .sidecar)
        let older = SurfaceGate(scope: .sidecar, sidecarRoutes: [])
        let client = SurfaceGate(scope: .serverClient)
        let admin = SurfaceGate(scope: .serverAdmin)
        for feature in [SurfaceFeature.botActivity, .primaryBot, .voiceNotesSetting] {
            XCTAssertTrue(sidecar.allows(feature), "\(feature)")
            XCTAssertFalse(older.allows(feature), "\(feature) waits on S1")
            XCTAssertTrue(admin.allows(feature), "\(feature)")
        }
        XCTAssertTrue(client.allows(.botActivity))
        XCTAssertTrue(client.allows(.primaryBot), "the handler checks the owner")
        XCTAssertFalse(client.allows(.voiceNotesSetting), "a member may not set voiceNotes")
        for feature in [SurfaceFeature.threadFiles, .routineDelete, .botUsage, .characterExtras] {
            XCTAssertTrue(older.allows(feature) && client.allows(feature) && admin.allows(feature), "\(feature)")
        }
    }
}
