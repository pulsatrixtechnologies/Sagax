import XCTest
@testable import CompanionCore

final class PhoneToolsTests: XCTestCase {
    private func request(_ json: String) throws -> PhoneToolRequest {
        try JSONDecoder().decode(PhoneToolRequest.self, from: Data(json.utf8))
    }

    private func wire(tool: String, args: String = "{}", allowAlways: Bool = true, preApproved: Bool = false, expiresAt: Double = 4_000_000_000_000) throws -> PhoneToolRequest {
        try request(#"{"id":"r1","tool":"\#(tool)","args":\#(args),"access":"read","botId":"b1","botName":"Wren","threadId":"t1","allowAlways":\#(allowAlways),"preApproved":\#(preApproved),"createdAt":1,"expiresAt":\#(expiresAt)}"#)
    }

    func testDecodesARequestAndAnUnknownTool() throws {
        let known = try wire(tool: "contacts", args: #"{"query":"Marie","fields":["phone"],"reason":"appeler"}"#)
        XCTAssertEqual(known.tool, .contacts)
        XCTAssertEqual(known.string("query"), "Marie")
        XCTAssertEqual(known.reason, "appeler")
        let unknown = try wire(tool: "teleport")
        XCTAssertNil(unknown.tool)
        XCTAssertEqual(PhoneToolRules.choices(for: unknown), [.deny])
    }

    func testTheCardOffersRefuserToujoursPermettreUneFois() throws {
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "location")), [.deny, .always, .once])
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "location", allowAlways: false)), [.deny, .once])
        // never Toujours permettre for a shortcut, the clipboard or photos, whatever the server says
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "shortcut")), [.deny, .once])
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "clipboard")), [.deny, .once])
        XCTAssertEqual(PhoneToolRules.decision(.always), .always)
    }

    func testAGrantRunsWithoutACardOnlyWithTheAppOpen() throws {
        let granted = try wire(tool: "status", preApproved: true)
        XCTAssertTrue(PhoneToolRules.runsWithoutCard(granted, appActive: true, offered: [.status]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(granted, appActive: false, offered: [.status]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(granted, appActive: true, offered: [.location]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(try wire(tool: "status"), appActive: true, offered: [.status]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(try wire(tool: "clipboard", preApproved: true), appActive: true, offered: [.clipboard]))
        let expired = try wire(tool: "status", preApproved: true, expiresAt: 1_000)
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(expired, appActive: true, offered: [.status]))
        XCTAssertTrue(PhoneToolRules.isExpired(expired))
    }

    func testOfferedFollowsTheSwitches() {
        XCTAssertEqual(PhoneToolRules.offered(disabled: []), PhoneTool.allCases)
        XCTAssertFalse(PhoneToolRules.offered(disabled: ["clipboard"]).contains(.clipboard))
    }

    func testContactsCarryOnlyTheFieldsAskedForUpToTheLimit() throws {
        let ask = try wire(tool: "contacts", args: #"{"query":"Marie","fields":["phone"],"limit":1}"#)
        let found = [
            PhoneContact(name: "Marie Tremblay", phones: ["+1 514 555 0101"], emails: ["marie@example.com"], birthday: "1990-01-02"),
            PhoneContact(name: "Marie Roy", phones: ["+1 514 555 0102"]),
        ]
        XCTAssertEqual(PhoneToolShaping.contacts(found, for: ask), .object(["contacts": .array([.object(["name": .string("Marie Tremblay"), "phones": .array([.string("+1 514 555 0101")])])])]))
        let defaults = try wire(tool: "contacts", args: #"{"query":"Marie"}"#)
        XCTAssertEqual(PhoneToolShaping.requestedFields(defaults), ["phone", "email"])
    }

    func testLocationIsRoundedUnlessPrecise() {
        let at = Date(timeIntervalSince1970: 0)
        let coarse = PhoneToolShaping.location(latitude: 45.5016889, longitude: -73.567256, accuracy: 5, at: at, precise: false)
        XCTAssertEqual(coarse.object?["latitude"], .number(45.502))
        XCTAssertEqual(coarse.object?["accuracyMeters"], .number(100))
        let precise = PhoneToolShaping.location(latitude: 45.5016889, longitude: -73.567256, accuracy: 5, at: at, precise: true)
        XCTAssertEqual(precise.object?["latitude"], .number(45.501689))
    }

    func testRemindersEventsClipboardAndPhotos() {
        let due = Date(timeIntervalSince1970: 1_800_000_000)
        let list = PhoneToolShaping.reminders([PhoneReminder(title: "Pain", due: due, list: "Épicerie"), PhoneReminder(title: "Lait")], limit: 1)
        XCTAssertEqual(list.object?["reminders"]?.array?.count, 1)
        let events = PhoneToolShaping.events([
            PhoneEvent(title: "B", start: due.addingTimeInterval(60), end: due.addingTimeInterval(120)),
            PhoneEvent(title: "A", start: due, end: due.addingTimeInterval(60)),
        ], limit: nil)
        XCTAssertEqual(events.object?["events"]?.array?.first?.object?["title"], .string("A"))
        XCTAssertEqual(PhoneToolShaping.clipboard(nil), .object(["empty": .bool(true)]))
        XCTAssertEqual(PhoneToolShaping.clipboard(String(repeating: "a", count: 5_000)).object?["text"]?.string?.count, 4_000)
        let photos = PhoneToolShaping.photos([Data([1]), Data([2]), Data([3]), Data([4])], max: 9)
        XCTAssertEqual(photos.object?["images"]?.array?.count, 3)
        XCTAssertEqual(PhoneToolShaping.scaledSize(width: 4_000, height: 3_000).width, 1_280)
        XCTAssertEqual(PhoneToolShaping.scaledSize(width: 800, height: 600).width, 800)
    }

    func testStatusAndShortcutURL() {
        let status = PhoneToolShaping.status(batteryLevel: 0.456, batteryState: "charging", lowPowerMode: false, network: (status: "satisfied", type: "wifi", expensive: false, constrained: false), focused: nil)
        XCTAssertEqual(status.object?["battery"]?.object?["level"], .number(0.46))
        XCTAssertNil(status.object?["focus"])
        let url = PhoneToolShaping.shortcutURL(name: "Café du matin", input: "double")
        XCTAssertEqual(url?.scheme, "shortcuts")
        XCTAssertEqual(url?.host, "run-shortcut")
        XCTAssertTrue(url?.absoluteString.contains("name=Caf%C3%A9%20du%20matin") == true)
    }

    func testDatesTheBotSends() {
        XCTAssertNotNil(PhoneToolShaping.date("2026-10-21T09:00:00Z"))
        XCTAssertNotNil(PhoneToolShaping.date("2026-10-21T09:00:00.000-04:00"))
        XCTAssertNotNil(PhoneToolShaping.date("2026-10-21"))
        XCTAssertNil(PhoneToolShaping.date("demain"))
    }

    func testAnAnswerEncodesForTheServer() throws {
        let answer = PhoneToolAnswer(decision: .once, result: .object(["started": .bool(true)]))
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(answer)) as? [String: Any]
        XCTAssertEqual(body?["decision"] as? String, "once")
        XCTAssertEqual((body?["result"] as? [String: Any])?["started"] as? Bool, true)
        let refusal = try JSONSerialization.jsonObject(with: JSONEncoder().encode(PhoneToolAnswer.denied)) as? [String: Any]
        XCTAssertNil(refusal?["result"])
    }
}
