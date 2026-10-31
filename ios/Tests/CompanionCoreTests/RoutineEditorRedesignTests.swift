import Foundation
import XCTest
@testable import CompanionCore

/// "Edit routine", simplified (2026-10-29): the summary line, "Not saved",
/// More options' summary, "When a webhook arrives" in Repeat, and the
/// routine's own webhook (address, key, curl, reveal or rotate).
final class RoutineEditorRedesignTests: XCTestCase {
    private func routine(_ schedule: String, extra: String = "") throws -> Routine {
        let json = #"{"id":"r1","name":"Digest","prompt":"p","botId":"b1","runOn":"maus","enabled":true,"schedule":"# + schedule + #","durationMinutes":30,"createdAt":1,"updatedAt":2"# + extra + "}"
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    private let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }()

    // MARK: Summary line

    func testTheSummaryLineJoinsWhatIsKnownInOrder() {
        XCTAssertEqual(
            RoutineEditorRules.summary(schedule: "Weekdays at 9:00 AM", results: "Results in the main thread", runAs: "As Alex"),
            "Weekdays at 9:00 AM · Results in the main thread · As Alex"
        )
        XCTAssertEqual(RoutineEditorRules.summary(schedule: "Every hour", results: "Results in Reports", runAs: nil), "Every hour · Results in Reports")
        XCTAssertEqual(RoutineEditorRules.summary(schedule: nil, results: "  ", runAs: "As Alex"), "As Alex")
        XCTAssertEqual(RoutineEditorRules.summary(schedule: nil, results: nil, runAs: nil), "")
    }

    func testResultsGoToTheMainThreadUnlessAThreadIsChosen() throws {
        let titles = ["t1": "Weekly report"]
        let kept = try routine(#"{"type":"daily","time":"09:00","weekdays":[1]}"#, extra: #","resultsThreadId":"t1""#)
        XCTAssertEqual(RoutineEditorRules.resultsPlace(.newThread, original: kept) { titles[$0] }, .main)
        XCTAssertEqual(RoutineEditorRules.resultsPlace(.thread("t1"), original: nil) { titles[$0] }, .thread("Weekly report"))
        XCTAssertEqual(RoutineEditorRules.resultsPlace(.keep, original: kept) { titles[$0] }, .thread("Weekly report"))
        // a thread that is gone reads as the main thread
        XCTAssertEqual(RoutineEditorRules.resultsPlace(.thread("gone"), original: nil) { titles[$0] }, .main)
    }

    // MARK: More options

    func testMoreOptionsSaysTheLimitAndOverlapOnlyOnTheClock() {
        XCTAssertEqual(RoutineEditorRules.moreSummary(timeoutMinutes: nil, overlap: "skip", recurrence: .daily), [.noLimit, .overlapSkip])
        XCTAssertEqual(RoutineEditorRules.moreSummary(timeoutMinutes: 45, overlap: "queue", recurrence: .interval), [.limit(minutes: 45), .overlapQueue])
        XCTAssertEqual(RoutineEditorRules.moreSummary(timeoutMinutes: nil, overlap: "skip", recurrence: .none), [.noLimit])
        XCTAssertEqual(RoutineEditorRules.moreSummary(timeoutMinutes: 30, overlap: "skip", recurrence: .webhook), [.limit(minutes: 30)])
    }

    // MARK: Not saved

    private func snapshot(name: String = "Digest", form: RoutineScheduleForm, botId: String = "b1", alias: String = "") -> RoutineEditorSnapshot {
        RoutineEditorSnapshot(
            name: name, prompt: "p", botId: botId, target: "bot", groupId: "", runOn: "maus", form: form,
            durationMinutes: 30, timeoutMinutes: nil, overlap: "skip", results: .keep, attachmentIds: [], runAs: nil,
            onlyWhenPresent: false, postResults: false, deleteWhenFinished: false, autoPauseAfter: 5, continuity: false, mailAlias: alias,
            watch: RoutineWatchDraft(precheck: nil)
        )
    }

    func testNotSavedFollowsEveryChangeAndClearsWhenUndone() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let form = RoutineScheduleForm(schedule: .daily(time: "09:00", weekdays: [1, 2, 3, 4, 5]), seedAt: now, now: now, calendar: calendar)
        let opened = snapshot(form: form)
        XCTAssertFalse(snapshot(form: form).differs(from: opened))
        XCTAssertTrue(snapshot(name: "Digest 2", form: form).differs(from: opened))
        XCTAssertFalse(snapshot(name: "Digest", form: form).differs(from: opened))
        XCTAssertTrue(snapshot(form: form, alias: "reports").differs(from: opened))
        var webhook = form
        webhook.select(.webhook)
        XCTAssertTrue(snapshot(form: webhook).differs(from: opened))
        webhook.select(.weekdays)
        XCTAssertFalse(snapshot(form: webhook).differs(from: opened))
    }

    func testTheBotPickedOnAppearIsNotAChange() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let form = RoutineScheduleForm(schedule: nil, seedAt: now, now: now, calendar: calendar)
        let opened = snapshot(form: form, botId: "")
        XCTAssertFalse(snapshot(form: form, botId: "b1").differs(from: opened))
        XCTAssertTrue(snapshot(name: "New", form: form, botId: "b1").differs(from: opened))
    }

    // MARK: When a webhook arrives

    func testRepeatOffersTheWebhookToABotRoutineOnly() {
        XCTAssertEqual(RoutineEditorRules.repeatChoices(current: .daily, teamGoal: false).last, .webhook)
        XCTAssertFalse(RoutineEditorRules.repeatChoices(current: .daily, teamGoal: true).contains(.webhook))
        XCTAssertFalse(RoutineEditorRules.repeatChoices(current: .daily, teamGoal: false).contains(.email))
        XCTAssertTrue(RoutineEditorRules.repeatChoices(current: .email, teamGoal: false).contains(.email))
        XCTAssertTrue(RoutineEditorRules.repeatChoices(current: .advanced, teamGoal: false).contains(.advanced))
        XCTAssertFalse(RoutineEditorRules.repeatChoices(current: .hourly, teamGoal: false).contains(.advanced))
    }

    func testAWebhookRoutineOpensOnItsChoiceAndSavesAsAWebhook() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let original = try routine(#"{"type":"webhook"}"#)
        XCTAssertEqual(original.schedule.type, .webhook)
        XCTAssertTrue(original.schedule.isTrigger)
        let form = RoutineScheduleForm(schedule: original.schedule, seedAt: now, now: now, calendar: calendar)
        XCTAssertEqual(form.recurrence, .webhook)
        XCTAssertFalse(form.recurrence.repeatsOnClock)
        XCTAssertTrue(form.isValid)
        let saved = try form.schedule(savedAt: now)
        XCTAssertEqual(saved.type, .webhook)
        XCTAssertNil(saved.timing)
        // untouched, nothing is sent; the body is the server's strict shape
        let input = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: saved, completeSchedule: true)
        XCTAssertNil(RoutinePatch.body(original: original, input: input)["schedule"])
        XCTAssertEqual(RoutinePatch.scheduleBody(saved).keys.sorted(), ["type"])
    }

    func testSwitchingADailyRoutineToAWebhookSendsOnlyTheType() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let original = try routine(#"{"type":"daily","time":"09:00","weekdays":[1,2,3,4,5]}"#)
        var form = RoutineScheduleForm(schedule: original.schedule, seedAt: now, now: now, calendar: calendar)
        form.timing = .flexible
        form.select(.webhook)
        let saved = try form.schedule(savedAt: now)
        let input = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: saved, completeSchedule: true)
        let sent = try XCTUnwrap(RoutinePatch.body(original: original, input: input)["schedule"] as? [String: Any])
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent["type"] as? String, "webhook")
    }

    func testAnEmailRoutineIsKeptAsItIs() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let original = try routine(#"{"type":"event","source":"email"}"#)
        let form = RoutineScheduleForm(schedule: original.schedule, seedAt: now, now: now, calendar: calendar)
        XCTAssertEqual(form.recurrence, .email)
        let saved = try form.schedule(savedAt: now)
        XCTAssertEqual(saved.type, .event)
        XCTAssertEqual(saved.source, "email")
        let input = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: saved, completeSchedule: true)
        XCTAssertNil(RoutinePatch.body(original: original, input: input)["schedule"])
        XCTAssertEqual(RoutinePatch.scheduleBody(saved)["source"] as? String, "email")
    }

    func testRememberTheLastRunAndTheMailTagAreSentWhenChanged() throws {
        let original = try routine(#"{"type":"daily","time":"09:00","weekdays":[1]}"#, extra: #","mailAlias":"reports""#)
        var input = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: original.schedule)
        input.continuity = false
        input.mailAlias = "Reports!"
        XCTAssertTrue(RoutinePatch.body(original: original, input: input).isEmpty)
        input.continuity = true
        input.mailAlias = ""
        let body = RoutinePatch.body(original: original, input: input)
        XCTAssertEqual(body["continuity"] as? Bool, true)
        XCTAssertTrue(body["mailAlias"] is NSNull)
        input.mailAlias = "Weekly 2"
        XCTAssertEqual(RoutinePatch.body(original: original, input: input)["mailAlias"] as? String, "weekly2")
        var created = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: original.schedule)
        created.continuity = true
        created.mailAlias = "ops"
        XCTAssertEqual(RoutinePatch.createBody(created)["continuity"] as? Bool, true)
        XCTAssertEqual(RoutinePatch.createBody(created)["mailAlias"] as? String, "ops")
        XCTAssertEqual(RoutineMailTag.clean("Hé-llo_World 123456789012345678901234567890"), "hlloworld12345678901234567890123")
    }

    // MARK: The routine page

    func testThePageSaysTriggerNextRunAndBotOnOneLine() {
        XCTAssertEqual(RoutineEditorRules.pageSummary(trigger: "Every Monday at 7:02 AM", nextRun: "in 3 days", bot: "Ara"),
                       "Every Monday at 7:02 AM · in 3 days · Ara")
        XCTAssertEqual(RoutineEditorRules.pageSummary(trigger: "When a webhook fires", nextRun: nil, bot: "Ara"), "When a webhook fires · Ara")
        XCTAssertEqual(RoutineEditorRules.pageSummary(trigger: "Every hour", nextRun: "Paused", bot: nil), "Every hour · Paused")
    }

    func testSomeoneElsesRoutineOpensReadOnly() throws {
        XCTAssertFalse(RoutineEditorRules.readOnly(nil))
        XCTAssertFalse(RoutineEditorRules.readOnly(try routine(#"{"type":"webhook"}"#)))
        XCTAssertFalse(RoutineEditorRules.readOnly(try routine(#"{"type":"webhook"}"#, extra: #","canEdit":true"#)))
        let foreign = try routine(#"{"type":"webhook"}"#, extra: #","canEdit":false,"owner":{"id":"pr_2","name":"Sam"}"#)
        XCTAssertTrue(RoutineEditorRules.readOnly(foreign))
        XCTAssertEqual(foreign.foreignOwnerName, "Sam")
        XCTAssertTrue(RoutineEditorRules.readOnly(try routine(#"{"type":"webhook"}"#, extra: #","redacted":true"#)))
    }

    // MARK: The routine's webhook

    private func listing() throws -> WebhooksResponse {
        let json = #"""
        {"webhooks":[
          {"id":"w0","endpointId":"ep_0","name":"Standalone","botId":"b1","enabled":true,"deliveryCount":0},
          {"id":"w1","endpointId":"ep_1","name":"Digest","botId":"b1","routineId":"r1","enabled":true,"deliveryCount":3,
           "lastReceivedAt":1800000000000,"tokenLast4":"a1b2","tokenPending":false,"verifiedAt":1}
        ],"ingress":{"available":true,"baseUrl":"https://hooks.example.test/"}}
        """#
        return try JSONDecoder().decode(WebhooksResponse.self, from: Data(json.utf8))
    }

    func testTheRoutineFindsItsWebhookAndItsAddress() throws {
        let list = try listing()
        let hook = try XCTUnwrap(RoutineWebhook.webhook(for: "r1", in: list.webhooks))
        XCTAssertEqual(hook.id, "w1")
        XCTAssertEqual(hook.tokenLast4, "a1b2")
        XCTAssertNil(RoutineWebhook.webhook(for: "other", in: list.webhooks))
        XCTAssertNil(RoutineWebhook.webhook(for: nil, in: list.webhooks))
        XCTAssertEqual(RoutineWebhook.url(baseURL: list.ingress?.baseUrl, webhook: hook), "https://hooks.example.test/hooks/ep_1")
    }

    func testTheKeyIsMaskedAndTheCurlUsesItOnlyWhenShown() {
        let masked = RoutineWebhook.masked(tokenLast4: "a1b2")
        XCTAssertEqual(masked, "whsec_\u{2022}\u{2022}\u{2022}\u{2022}a1b2")
        XCTAssertEqual(RoutineWebhook.header(masked), "Authorization: Bearer whsec_\u{2022}\u{2022}\u{2022}\u{2022}a1b2")
        let url = "https://hooks.example.test/hooks/ep_1"
        XCTAssertEqual(
            RoutineWebhook.curl(url: url, token: nil),
            #"curl -X POST https://hooks.example.test/hooks/ep_1 -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"text":"hello"}'"#
        )
        XCTAssertTrue(RoutineWebhook.curl(url: url, token: "whsec_full").contains("Bearer whsec_full"))
    }

    func testTheEyeRevealsAWaitingKeyElseRotatesAndTheStatusReads() throws {
        var hook = try XCTUnwrap(try listing().webhooks.last)
        XCTAssertEqual(RoutineWebhook.keyAction(hook), .rotate)
        XCTAssertEqual(RoutineWebhook.status(hook), .active)
        hook.tokenPending = true
        XCTAssertEqual(RoutineWebhook.keyAction(hook), .reveal)
        hook.enabled = false
        XCTAssertEqual(RoutineWebhook.status(hook), .ready)
        hook.verifiedAt = nil
        XCTAssertEqual(RoutineWebhook.status(hook), .paused)
        hook.verificationPending = true
        XCTAssertEqual(RoutineWebhook.status(hook), .waiting)
    }

    func testRevealRotateAndCreateUseTheDesktopRoutes() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RoutineWebhookStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        RoutineWebhookStub.body = Data(#"""
        {"webhook":{"id":"w1","endpointId":"ep_1","name":"Digest","botId":"b1","routineId":"r1","enabled":true,"deliveryCount":3,"tokenLast4":"zz99"},
         "ingress":{"available":true,"baseUrl":"https://hooks.example.test"},
         "credential":{"endpointUrl":"https://hooks.example.test/hooks/ep_1","token":"whsec_new_zz99","command":"curl ..."}}
        """#.utf8)
        let rotated = try await client.webhookKey(id: "w1", action: .rotate)
        XCTAssertEqual(RoutineWebhookStub.captured?.url?.path, "/api/webhooks/w1/rotate")
        XCTAssertEqual(RoutineWebhookStub.captured?.httpMethod, "POST")
        XCTAssertEqual(rotated.credential?.token, "whsec_new_zz99")
        XCTAssertEqual(rotated.webhook.tokenLast4, "zz99")
        _ = try await client.webhookKey(id: "w1", action: .reveal)
        XCTAssertEqual(RoutineWebhookStub.captured?.url?.path, "/api/webhooks/w1/reveal")

        RoutineWebhookStub.body = Data(#"""
        {"routine":{"id":"r1","name":"Digest","prompt":"p","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"webhook"},"durationMinutes":30,"createdAt":1,"updatedAt":3}}
        """#.utf8)
        let routine = try await client.createRoutineWebhook(routineId: "r1")
        XCTAssertEqual(routine.schedule.type, .webhook)
        XCTAssertEqual(RoutineWebhookStub.captured?.url?.path, "/api/routines/r1")
        XCTAssertEqual(RoutineWebhookStub.captured?.httpMethod, "PATCH")
        let sent = (try? JSONSerialization.jsonObject(with: RoutineWebhookStub.capturedBody) as? [String: Any]) ?? [:]
        XCTAssertEqual((sent["schedule"] as? [String: Any])?["type"] as? String, "webhook")
        XCTAssertEqual(sent.count, 1)
    }
}

private final class RoutineWebhookStub: URLProtocol {
    static var captured: URLRequest?
    static var capturedBody = Data()
    static var body = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        if let data = request.httpBody {
            Self.capturedBody = data
        } else if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 1024)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            Self.capturedBody = data
        } else {
            Self.capturedBody = Data()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
