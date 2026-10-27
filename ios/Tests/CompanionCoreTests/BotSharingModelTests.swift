// Shared with (BA15) on the phone: the page's model, and the Share entry of
// the bot row menu and of the panel's menu.
import Foundation
import XCTest
@testable import CompanionCore

private final class FakeSharingAPI: BotSharingAPI, @unchecked Sendable {
    var grants: [WireGrant] = []
    var fails = false
    private(set) var calls: [String] = []

    private func answer() throws -> BotGrants {
        let rows = grants.map { #"{"target":"\#($0.target)","level":"\#($0.level.rawValue)","label":"\#($0.label)","kind":"user"}"# }
        let json = #"{"grants":[\#(rows.joined(separator: ","))],"administer":{"any":true,"teamIds":[],"maxLevel":"manage"}}"#
        return try JSONDecoder().decode(BotGrants.self, from: Data(json.utf8))
    }

    func botGrants(botId: String) async throws -> BotGrants { calls.append("get"); return try answer() }

    func putGrant(botId: String, target: String, level: GrantLevel) async throws -> BotGrants {
        calls.append("put \(target) \(level.rawValue)")
        if fails { throw APIError.badURL }
        grants.removeAll { $0.target == target }
        grants.append(WireGrant(target: target, level: level, label: target == "user:pr_a" ? "Alice Demo" : "Bob Demo", kind: .user))
        return try answer()
    }

    func removeGrant(botId: String, target: String) async throws -> BotGrants {
        calls.append("delete \(target)")
        if fails { throw APIError.badURL }
        grants.removeAll { $0.target == target }
        return try answer()
    }

    func orgShareDirectory() async throws -> OrgShareDirectory {
        OrgShareDirectory(people: [
            .init(principalId: "pr_a", name: "Alice Demo", login: "alice"),
            .init(principalId: "pr_b", name: "Bob Demo", login: "bob"),
        ])
    }
}

@MainActor
final class BotSharingModelTests: XCTestCase {
    private func bot() throws -> Bot {
        let json: [String: Any] = [
            "id": "b1", "threadId": "t-b1", "name": "Ara", "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "ownerUserId": "pr_me",
        ]
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testAMemberAddsChangesAndRemovesAPersonWithoutAnAdmin() async throws {
        let api = FakeSharingAPI()
        let model = BotSharingModel(bot: try bot(), api: api)
        await model.load(viewerPrincipalId: "pr_me")
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.administer?.maxLevel, .manage)
        model.query = "ali"
        XCTAssertEqual(model.candidates.map(\.target), ["user:pr_a"])

        let added = await model.add("user:pr_a")
        XCTAssertTrue(added)
        XCTAssertEqual(model.rows.map(\.target), ["user:pr_a"])
        XCTAssertEqual(model.rows.first?.level, .use)
        XCTAssertEqual(model.query, "")

        _ = await model.setLevel("user:pr_a", .edit)
        XCTAssertEqual(model.rows.first?.level, .edit)

        let removed = await model.remove("user:pr_a")
        XCTAssertTrue(removed)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(api.calls, ["get", "put user:pr_a use", "put user:pr_a edit", "delete user:pr_a"])
    }

    func testAFailedChangeKeepsTheListAndSaysSo() async throws {
        let api = FakeSharingAPI()
        api.grants = [WireGrant(target: "user:pr_b", level: .use, label: "Bob Demo", kind: .user)]
        let model = BotSharingModel(bot: try bot(), api: api)
        await model.load(viewerPrincipalId: "pr_me")
        api.fails = true
        let removed = await model.remove("user:pr_b")
        XCTAssertFalse(removed)
        XCTAssertTrue(model.failed)
        XCTAssertEqual(model.rows.map(\.target), ["user:pr_b"])
    }

    func testTheBotRowMenuOffersShareOnAnOrganizationServerAfterRename() throws {
        let mine = try bot()
        func items(_ gate: SurfaceGate) -> [BotMenuItem] {
            NavigationMenus.bot(mine, BotMenuContext(gate: gate, showThreads: true, canMoveToSection: false, viewerId: "pr_me", activeBotCount: 2))
                .groups.flatMap { $0 }
        }
        let member = items(SurfaceGate(scope: .serverClient, organization: true))
        XCTAssertTrue(member.contains(.share))
        XCTAssertEqual(member.firstIndex(of: .share), member.firstIndex(of: .rename).map { $0 + 1 })
        XCTAssertFalse(items(SurfaceGate(scope: .sidecar)).contains(.share))
    }

    func testThePanelMenuOffersShareToo() throws {
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverClient, organization: true), bot: try bot(), viewerId: "pr_me",
                                      editable: true, zipExport: false, activeBotCount: 2)
        XCTAssertTrue(plan.items.contains(.share))
    }
}
