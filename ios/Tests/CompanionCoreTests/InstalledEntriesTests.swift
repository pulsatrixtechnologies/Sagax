// Manage > Installed on the phone (2026-10-26): the cases of the desktop's
// src/lib/installed-model.test.ts, ported.
import XCTest
@testable import CompanionCore

final class InstalledEntriesTests: XCTestCase {
    private let servers = [
        ConnectAppServer(name: "twilio-docs", url: "https://mcp.twilio.com/docs", source: "twilio"),
        ConnectAppServer(name: "github", url: "https://api.githubcopilot.com/mcp/"),
        ConnectAppServer(name: "github-github", url: "https://api.githubcopilot.com/mcp", source: "claude-plugins-official"),
    ]

    func testNamesForPeople() {
        XCTAssertEqual(ConnectApps.readableName("github-github"), "GitHub")
        XCTAssertEqual(ConnectApps.readableName("twilio-docs"), "Twilio Docs")
        XCTAssertEqual(ConnectApps.readableName("linear-mcp"), "Linear")
        XCTAssertEqual(ConnectApps.readableName("Google Drive"), "Google Drive")
    }

    func testGitHubTwiceIsOneEntry() {
        let items = ConnectApps.items(ConnectAppSources(servers: servers, marketplaces: [
            Marketplace(name: "claude-plugins-official", plugins: [.init(name: "other")]),
        ]))
        let entries = ConnectApps.installedEntries(items)
        XCTAssertEqual(entries.map(\.name), ["GitHub", "Twilio Docs"])
        let github = entries[0]
        XCTAssertEqual(github.servers.sorted(), ["github", "github-github"])
        XCTAssertEqual(github.brings, InstalledBrings(plugin: "claude-plugins-official", connectors: 1))
        XCTAssertEqual(github.domain, "github.com")
        XCTAssertNil(entries[1].brings.plugin, "a vendor source that is no listed marketplace is not a plugin")
        XCTAssertEqual(entries[1].domain, "twilio.com")
    }

    func testThePluginCarriesItsServerAndSkills() {
        let items = ConnectApps.items(ConnectAppSources(
            servers: servers,
            skills: [LibrarySkill(name: "review", description: "", source: "claude-plugins-official", enabled: true)],
            marketplaces: [Marketplace(name: "claude-plugins-official", plugins: [
                .init(name: "github", installed: true, servers: ["github-github"], skills: ["review"]),
                .init(name: "frontend-design", installed: true),
            ])]
        ))
        let entries = ConnectApps.installedEntries(items)
        XCTAssertEqual(entries.map(\.name), ["Frontend Design", "GitHub", "Twilio Docs"])
        let github = entries[1]
        XCTAssertEqual(github.primary.key, "plugin:github@claude-plugins-official")
        XCTAssertEqual(github.brings, InstalledBrings(plugin: "claude-plugins-official", connectors: 1, skills: 1))
    }

    func testASignInWaitingShows() {
        let items = ConnectApps.items(ConnectAppSources(servers: [ConnectAppServer(name: "vault", url: "https://vault.example.net/mcp", auth: "required")]))
        XCTAssertEqual(ConnectApps.installedEntries(items).first?.status, .needsAuth)
    }

    func testACatalogAddressIsAnApp() {
        let items = ConnectApps.items(ConnectAppSources(servers: [ConnectAppServer(name: "Linear", url: "https://mcp.linear.app/mcp", auth: "connected")]))
        XCTAssertEqual(ConnectApps.installedEntries(items, catalog: ["https://mcp.linear.app/mcp"]).first?.brings, InstalledBrings(app: true, connectors: 0))
        XCTAssertEqual(ConnectApps.installedEntries(items).first?.brings, InstalledBrings(connectors: 1))
    }
}
