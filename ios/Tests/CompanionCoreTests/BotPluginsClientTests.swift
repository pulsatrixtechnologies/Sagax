import Foundation
import XCTest
@testable import CompanionCore

final class BotPluginsClientTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Test", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    func testDecodesTheServerView() throws {
        let json = #"""
        {"marketplaces":[{"name":"acme","source":"acme/plugins","addedAt":1,"updatedAt":2,
          "plugins":[{"name":"lint","description":"Lints","version":"1.0.0","installed":true,"external":false}]}],
         "plugins":[{"key":"lint@acme","name":"lint","marketplace":"acme","enabled":true,"removed":["hooks"],"declaredMcpServers":[]}],
         "policy":{"mode":"list","allow":["acme"]},"engine":{"loadsPlugins":true},"canChange":true}
        """#
        let view = try JSONDecoder().decode(BotPluginsView.self, from: Data(json.utf8))
        XCTAssertEqual(view.marketplaces.first?.plugins.first?.installed, true)
        XCTAssertEqual(view.plugins.first?.key, "lint@acme")
        XCTAssertEqual(view.plugins.first?.removed, ["hooks"])
        XCTAssertTrue(view.policy.isList)
        XCTAssertEqual(view.policy.allow, ["acme"])
        XCTAssertNil(view.managedByAdmin)
    }

    func testRequestsMatchTheServerRoutes() throws {
        let load = try client.botPluginsRequest("GET", botId: "bot_1")
        XCTAssertEqual(load.url?.path, "/api/bots/bot_1/plugins")
        XCTAssertEqual(load.httpMethod, "GET")

        let toggle = try client.botPluginsRequest("PATCH", botId: "bot_1", tail: "/lint@acme", body: ["enabled": false])
        XCTAssertEqual(toggle.url?.path, "/api/bots/bot_1/plugins/lint@acme")
        let body = try JSONSerialization.jsonObject(with: toggle.httpBody ?? Data()) as? [String: Bool]
        XCTAssertEqual(body, ["enabled": false])

        let install = try client.botPluginsRequest("POST", botId: "bot_1", tail: "/install", body: ["marketplace": "acme", "plugin": "lint"], slow: true)
        XCTAssertEqual(install.timeoutInterval, 180)
        XCTAssertThrowsError(try client.botPluginsRequest("GET", botId: "../x"))
    }

    func testKeysAndNames() {
        XCTAssertTrue(BotPluginRules.validKey("lint@acme"))
        XCTAssertFalse(BotPluginRules.validKey("lint"))
        XCTAssertFalse(BotPluginRules.validKey("a@b@c"))
        XCTAssertFalse(BotPluginRules.validName(".hidden"))
        XCTAssertTrue(BotPluginRules.validName("my.plugin_1-x"))
    }

    func testGateHidesPluginsAndConnectionsOnTheSidecar() {
        let sidecar = SurfaceGate(scope: .sidecar)
        XCTAssertFalse(sidecar.allows(.botPlugins))
        XCTAssertFalse(sidecar.allows(.myConnections))
        XCTAssertTrue(SurfaceGate(scope: .serverAdmin).allows(.botPlugins))
        XCTAssertFalse(SurfaceGate(scope: .serverClient).allows(.botPlugins))
        XCTAssertTrue(SurfaceGate(scope: .serverClient, organization: true).allows(.botPlugins))
        XCTAssertFalse(SurfaceGate(scope: .serverAdmin).allows(.myConnections))
        XCTAssertTrue(SurfaceGate(scope: .serverClient, organization: true).allows(.myConnections))
    }
}
