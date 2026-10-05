import Foundation
import XCTest
@testable import CompanionCore

final class MyConnectionsTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Test", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    func testDecodesTheSection() throws {
        let json = #"""
        {"github":{"state":"pending","deviceFlow":true,"userCode":"ABCD-1234","verificationUri":"https://github.com/login/device","expiresAt":1},
         "servers":[{"name":"linear","kind":"remote","type":"http","url":"https://mcp.linear.app/mcp","domain":"mcp.linear.app","auth":"oauth","tokenConfigured":false,"enabled":true,"addedAt":1,"authState":"needs_sign_in"},
                    {"name":"gh","kind":"stdio","command":"npx","args":[],"envKeys":["GITHUB_TOKEN"],"runsIn":"environment","enabled":false,"addedAt":1,"authState":"ready"}],
         "sandbox":true}
        """#
        let data = try JSONDecoder().decode(MyConnections.self, from: Data(json.utf8))
        XCTAssertEqual(data.github.userCode, "ABCD-1234")
        XCTAssertTrue(data.waiting)
        XCTAssertTrue(data.servers[0].offersSignIn)
        XCTAssertFalse(data.servers[1].isRemote)
        XCTAssertFalse(data.servers[1].enabled)
    }

    func testNamesArgsAndEnv() {
        XCTAssertEqual(MyConnectionsRules.suggestName("https://mcp.linear.app/mcp"), "linear")
        XCTAssertEqual(MyConnectionsRules.suggestName("npx @modelcontextprotocol/server-github"), "server-github")
        XCTAssertEqual(MyConnectionsRules.suggestName("   "), "server")
        XCTAssertEqual(MyConnectionsRules.parseArgs(#"-y "two words" 'x y' z"#), ["-y", "two words", "x y", "z"])
        XCTAssertEqual(try MyConnectionsRules.parseEnv("A=1\n\n B = two=2 ").get(), ["A": "1", "B": " two=2"])
        XCTAssertEqual(MyConnectionsRules.parseEnv("nope"), .failure(.init(line: "nope")))
        XCTAssertTrue(MyConnectionsRules.validServerName("github"))
        XCTAssertFalse(MyConnectionsRules.validServerName("GitHub"))
        XCTAssertFalse(MyConnectionsRules.validServerName("1abc"))
    }

    func testAddRequestKeepsTheTokenOnlyForTokenAuth() throws {
        let oauth = try client.addPersonalServerRequest(.remote(name: "linear", url: " https://mcp.linear.app/mcp ", auth: "oauth", token: "ignored"))
        let body = try JSONSerialization.jsonObject(with: oauth.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(oauth.url?.path, "/api/me/mcp/servers")
        XCTAssertEqual(body?["url"] as? String, "https://mcp.linear.app/mcp")
        XCTAssertNil(body?["token"])

        let command = try client.addPersonalServerRequest(.command(name: "gh", command: "npx", args: ["-y", "x"], env: ["K": "v"]))
        let commandBody = try JSONSerialization.jsonObject(with: command.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(commandBody?["args"] as? [String], ["-y", "x"])
    }
}
