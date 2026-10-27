// "Reach me" (#1187) on the phone: the contract of server/routes/reach-me.ts
// and shared/reach-me.ts, decoded and encoded as the desktop sends it, the
// form's draft, and the four calls.
import Foundation
import XCTest
@testable import CompanionCore

private final class ReachMeStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured = request
        Self.capturedBody = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ReachMeTests: XCTestCase {
    private let answer = #"""
    {"saved":true,
     "settings":{"channels":["push","sms","telegram"],"smsNumber":"+15145550123",
                 "hours":{"always":false,"timeZone":"America/Toronto","ranges":[{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"},{"days":[5],"start":"22:00","end":"07:00"}]}},
     "channels":{"push":{"ready":true,"devices":2},
                 "sms":{"ready":false,"reason":"No verified number."},
                 "teams":{"ready":false},
                 "telegram":{"ready":true,"connected":true,"username":"helper_bot","linking":false},
                 "whatsapp":{"ready":false,"reason":"WhatsApp comes later."},
                 "pager":{"ready":true}}}
    """#

    private func decode(_ text: String) throws -> ReachMeView {
        try JSONDecoder().decode(ReachMeView.self, from: Data(text.utf8))
    }

    // MARK: Contract

    func testDecodesTheRoutesAnswer() throws {
        let view = try decode(answer)
        XCTAssertTrue(view.saved)
        XCTAssertEqual(view.settings.channels, ["push", "sms", "telegram"])
        XCTAssertEqual(view.settings.smsNumber, "+15145550123")
        XCTAssertEqual(view.settings.hours.timeZone, "America/Toronto")
        XCTAssertEqual(view.settings.hours.rangeList, [
            ReachHoursRange(days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00"),
            ReachHoursRange(days: [5], start: "22:00", end: "07:00"),
        ])
        XCTAssertEqual(view.channel(.push).devices, 2)
        XCTAssertEqual(view.channel(.sms).reason, "No verified number.")
        XCTAssertEqual(view.channel(.telegram).username, "helper_bot")
        XCTAssertEqual(view.channel(.telegram).connected, true)
        XCTAssertEqual(view.channels.count, ReachChannelID.allCases.count, "an unknown channel is not shown")
    }

    func testTheDefaultAndMissingChannelsReadAsNotReady() throws {
        let view = try decode(#"{"saved":false,"settings":{"channels":["push"],"hours":{"always":true}}}"#)
        XCTAssertFalse(view.saved)
        XCTAssertEqual(view.settings, .default)
        for id in ReachChannelID.allCases { XCTAssertFalse(view.channel(id).ready, "\(id)") }
    }

    func testHoursReadAsTheServerReadsThem() throws {
        let any = try JSONDecoder().decode(ReachHours.self, from: Data(#"{"always":"yes"}"#.utf8))
        XCTAssertEqual(any, .always, "anything but always:false is any time")
        let missing = try JSONDecoder().decode(ReachMeSettings.self, from: Data(#"{"channels":["teams"]}"#.utf8))
        XCTAssertEqual(missing.hours, .always)
    }

    func testEncodesWhatTheServerParses() throws {
        let settings = ReachMeSettings(channels: ["push", "sms"], smsNumber: "+15145550123",
                                       hours: .ranges(timeZone: "Europe/Paris", ranges: [ReachHoursRange(days: [0, 6], start: "10:00", end: "16:00")]))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as? [String: Any])
        XCTAssertEqual(object["channels"] as? [String], ["push", "sms"])
        XCTAssertEqual(object["smsNumber"] as? String, "+15145550123")
        let hours = try XCTUnwrap(object["hours"] as? [String: Any])
        XCTAssertEqual(hours["always"] as? Bool, false)
        XCTAssertEqual(hours["timeZone"] as? String, "Europe/Paris")
        let range = try XCTUnwrap((hours["ranges"] as? [[String: Any]])?.first)
        XCTAssertEqual(range["days"] as? [Int], [0, 6])
        XCTAssertEqual(range["start"] as? String, "10:00")
        XCTAssertEqual(range["end"] as? String, "16:00")

        let always = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(ReachMeSettings.default)) as? [String: Any])
        XCTAssertNil(always["smsNumber"], "no number: the key is left out")
        XCTAssertEqual((always["hours"] as? [String: Any])?["always"] as? Bool, true)
    }

    func testAChannelThisBuildDoesNotKnowSurvivesASave() throws {
        let settings = try JSONDecoder().decode(ReachMeSettings.self, from: Data(#"{"channels":["push","pager"]}"#.utf8))
        var draft = ReachMeDraft(ReachMeView(saved: true, settings: settings))
        draft.set(.teams, on: true)
        let sent = try XCTUnwrap(try? draft.payload().get())
        XCTAssertEqual(sent.channels, ["push", "pager", "teams"])
    }

    func testTelegramLinkIsOnlyATelegramAddress() throws {
        XCTAssertEqual(try decode(#"{"settings":{"channels":[]},"link":"https://t.me/helper_bot?start=ABCD"}"#).telegramLink?.host, "t.me")
        XCTAssertNil(try decode(#"{"settings":{"channels":[]},"link":"https://example.com/x"}"#).telegramLink)
        XCTAssertNil(try decode(#"{"settings":{"channels":[]},"link":"javascript:alert(1)"}"#).telegramLink)
    }

    // MARK: Rules

    func testPhoneNumbersNormalizeAsOnTheDesktop() {
        XCTAssertEqual(ReachMeRules.normalizePhone("514 555-0123"), "+15145550123")
        XCTAssertEqual(ReachMeRules.normalizePhone("(514) 555.0123"), "+15145550123")
        XCTAssertEqual(ReachMeRules.normalizePhone("1 514 555 0123"), "+15145550123")
        XCTAssertEqual(ReachMeRules.normalizePhone("+33 6 12 34 56 78"), "+33612345678")
        XCTAssertNil(ReachMeRules.normalizePhone(""))
        XCTAssertNil(ReachMeRules.normalizePhone("12345"))
        XCTAssertNil(ReachMeRules.normalizePhone("+0123456789"))
        XCTAssertNil(ReachMeRules.normalizePhone("call me"))
    }

    func testClockText() {
        XCTAssertEqual(ReachMeRules.minutes("08:30"), 510)
        XCTAssertNil(ReachMeRules.minutes("24:00"))
        XCTAssertNil(ReachMeRules.minutes("8:30"))
        XCTAssertEqual(ReachMeRules.hhmm(510), "08:30")
        XCTAssertEqual(ReachMeRules.hhmm(0), "00:00")
        XCTAssertEqual(ReachMeRules.days, [1, 2, 3, 4, 5, 6, 0], "Monday first")
    }

    // MARK: Draft

    func testDraftChannelsAndWhatsAppWaits() throws {
        var draft = ReachMeDraft(ReachMeView(saved: false, settings: .default))
        XCTAssertFalse(draft.dirty)
        draft.set(.whatsapp, on: true)
        XCTAssertFalse(draft.isOn(.whatsapp))
        XCTAssertFalse(draft.dirty, "WhatsApp cannot be turned on")
        draft.set(.teams, on: true)
        XCTAssertTrue(draft.dirty)
        XCTAssertTrue(draft.isOn(.teams))
        draft.set(.push, on: false)
        XCTAssertEqual(draft.settings.channels, ["teams"])
        draft.cancel()
        XCTAssertEqual(draft.settings, .default)
        XCTAssertFalse(draft.dirty)
    }

    func testTextMessagesNeedAValidNumber() {
        var draft = ReachMeDraft(ReachMeView(saved: false, settings: .default))
        draft.set(.sms, on: true)
        XCTAssertEqual(draft.payload(), .failure(.numberNeeded))
        draft.phone = "not a number"
        XCTAssertEqual(draft.payload(), .failure(.invalidNumber))
        draft.phone = "514 555 0123"
        XCTAssertEqual(try? draft.payload().get().smsNumber, "+15145550123")
        draft.set(.sms, on: false)
        draft.phone = ""
        XCTAssertNil(try? draft.payload().get().smsNumber, "an empty number is left out")
    }

    func testHoursEditing() {
        var draft = ReachMeDraft(ReachMeView(saved: false, settings: .default))
        XCTAssertFalse(draft.canAddRange)
        draft.setLimited(true, localZone: "America/Vancouver")
        XCTAssertEqual(draft.settings.hours, .ranges(timeZone: "America/Vancouver", ranges: [ReachMeRules.firstRange]))
        XCTAssertFalse(draft.canRemoveRange, "the last range stays")
        draft.addRange()
        XCTAssertEqual(draft.settings.hours.rangeList.last, ReachMeRules.addedRange)
        draft.toggle(day: 3, inRange: 1)
        XCTAssertEqual(draft.settings.hours.rangeList[1].days, [0, 3, 6])
        draft.toggle(day: 0, inRange: 1)
        XCTAssertEqual(draft.settings.hours.rangeList[1].days, [3, 6])
        draft.setStart("22:00", inRange: 1)
        draft.setEnd("07:00", inRange: 1)
        XCTAssertEqual(draft.settings.hours.rangeList[1], ReachHoursRange(days: [3, 6], start: "22:00", end: "07:00"))
        draft.setTimeZone("Europe/Paris")
        XCTAssertEqual(draft.settings.hours.timeZone, "Europe/Paris")
        XCTAssertEqual(draft.settings.hours.rangeList.count, 2, "the zone keeps the ranges")
        draft.removeRange(at: 0)
        XCTAssertEqual(draft.settings.hours.rangeList, [ReachHoursRange(days: [3, 6], start: "22:00", end: "07:00")])
        for _ in 0..<20 { draft.addRange() }
        XCTAssertEqual(draft.settings.hours.rangeList.count, ReachMeRules.maxRanges)
        draft.setLimited(false, localZone: "UTC")
        XCTAssertEqual(draft.settings.hours, .always)
    }

    func testTurningHoursOnTwiceKeepsTheRanges() {
        var draft = ReachMeDraft(ReachMeView(saved: false, settings: .default))
        draft.setLimited(true, localZone: "UTC")
        draft.addRange()
        draft.setLimited(true, localZone: "Europe/Paris")
        XCTAssertEqual(draft.settings.hours.rangeList.count, 2)
        XCTAssertEqual(draft.settings.hours.timeZone, "UTC")
    }

    func testATelegramChangeKeepsTheEditsInProgress() throws {
        let view = try decode(answer)
        var draft = ReachMeDraft(view)
        draft.set(.teams, on: true)
        var next = view
        next.channels[.telegram] = ReachChannelView(ready: false)
        draft.refreshChannels(next)
        XCTAssertTrue(draft.isOn(.teams), "the edit stays")
        XCTAssertEqual(draft.view.channel(.telegram).connected, nil)
        var clean = ReachMeDraft(view)
        var saved = view
        saved.settings.channels = ["push"]
        clean.refreshChannels(saved)
        XCTAssertEqual(clean.settings.channels, ["push"], "no edit: the server's answer")
    }

    // MARK: Calls

    private var session: URLSession!

    override func setUp() {
        super.setUp()
        ReachMeStub.captured = nil
        ReachMeStub.capturedBody = nil
        ReachMeStub.statusCode = 200
        ReachMeStub.responseBody = Data(answer.utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReachMeStub.self]
        session = URLSession(configuration: configuration)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        super.tearDown()
    }

    private func client() -> CompanionClient {
        CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "paired-token", session: session)
    }

    private func sentBody() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(ReachMeStub.capturedBody)) as? [String: Any])
    }

    func testReadAndSave() async throws {
        let view = try await client().reachMe(botId: "bot-1")
        XCTAssertEqual(ReachMeStub.captured?.httpMethod, "GET")
        XCTAssertEqual(ReachMeStub.captured?.url?.path, "/api/bots/bot-1/reach-me")
        XCTAssertEqual(view.settings.smsNumber, "+15145550123")

        _ = try await client().saveReachMe(botId: "bot-1", settings: view.settings)
        XCTAssertEqual(ReachMeStub.captured?.httpMethod, "PUT")
        XCTAssertEqual(ReachMeStub.captured?.url?.path, "/api/bots/bot-1/reach-me")
        XCTAssertEqual(try sentBody()["channels"] as? [String], ["push", "sms", "telegram"])
    }

    func testTelegramConnectAndDisconnect() async throws {
        ReachMeStub.responseBody = Data(#"{"ok":true,"username":"helper_bot","link":"https://t.me/helper_bot?start=K7Q2","saved":false,"settings":{"channels":["push"],"hours":{"always":true}},"channels":{"telegram":{"ready":false,"username":"helper_bot","linking":true}}}"#.utf8)
        let linked = try await client().connectReachTelegram(botId: "bot-1", token: "  123:abc  ")
        XCTAssertEqual(ReachMeStub.captured?.httpMethod, "POST")
        XCTAssertEqual(ReachMeStub.captured?.url?.path, "/api/bots/bot-1/reach-me/telegram")
        XCTAssertEqual(try sentBody()["token"] as? String, "123:abc")
        XCTAssertEqual(linked.telegramLink?.absoluteString, "https://t.me/helper_bot?start=K7Q2")
        XCTAssertEqual(linked.channel(.telegram).linking, true)

        _ = try await client().disconnectReachTelegram(botId: "bot-1")
        XCTAssertEqual(ReachMeStub.captured?.httpMethod, "DELETE")
        XCTAssertEqual(ReachMeStub.captured?.url?.path, "/api/bots/bot-1/reach-me/telegram")
    }

    func testARefusalCarriesTheServersSentence() async {
        ReachMeStub.statusCode = 400
        ReachMeStub.responseBody = Data(#"{"error":"hours.timeZone is a time zone name, like America/Toronto.","field":"hours"}"#.utf8)
        do {
            _ = try await client().saveReachMe(botId: "bot-1", settings: .default)
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error.localizedDescription, "hours.timeZone is a time zone name, like America/Toronto.")
        }
    }

    func testABadBotIdIsNeverSent() async {
        do {
            _ = try await client().reachMe(botId: "../admin")
            XCTFail("expected badURL")
        } catch {
            XCTAssertNil(ReachMeStub.captured)
        }
    }
}
