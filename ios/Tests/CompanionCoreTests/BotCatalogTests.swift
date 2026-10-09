// Browse Bots on iOS: the wire, the sections, the actions and the search of
// src/lib/bot-catalog.ts (bot-catalog.test.ts), and the routes.
import Foundation
import XCTest
@testable import CompanionCore

private final class CatalogStub: URLProtocol {
    static var body = Data()
    static var status = 200
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        if let body = request.httpBody { Self.capturedBody = body }
        else if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            stream.close()
            Self.capturedBody = data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class BotCatalogTests: XCTestCase {
    private func entry(_ id: String, _ source: BotCatalogSource, archived: Bool = false, catalog: BotCatalogListing? = nil, owner: String = "Ada") -> BotCatalogEntry {
        BotCatalogEntry(id: id, name: id.capitalized, title: "Role \(id)", owner: .init(principalId: "p_\(owner.lowercased())", name: owner), source: source, archived: archived, catalog: catalog)
    }

    private func response(organization: Bool = true, _ entries: [BotCatalogEntry]) -> BotCatalogResponse {
        BotCatalogResponse(organization: organization, viewer: .init(principalId: "p_me", admin: false, canCreate: true), entries: entries)
    }

    func testDecodesTheCatalogueAndSkipsAMalformedBot() throws {
        let json = #"""
        {"organization":true,"viewer":{"principalId":"p_me","admin":false,"canCreate":true},"entries":[
          {"id":"b1","name":"Scout","title":"Researcher","description":"","look":{"color":"teal","mascotLook":{"character":"shape","shape":"cube"},"avatarUrl":null},
           "owner":{"principalId":"p_ada","name":"Ada"},"source":"organization","archived":false,"primary":false,
           "catalog":{"published":true,"category":"product","featured":true,"publishedAt":1}},
          {"id":"broken"},
          {"id":"b2","name":"Mine","title":"","description":"Does things","look":{"color":"???","mascotSkin":"not-a-skin"},
           "owner":{"principalId":"p_me","name":"Me"},"source":"mine","archived":true,"primary":true}
        ]}
        """#
        let data = try JSONDecoder().decode(BotCatalogResponse.self, from: Data(json.utf8))
        XCTAssertTrue(data.organization)
        XCTAssertEqual(data.entries.map(\.id), ["b1", "b2"])
        XCTAssertEqual(data.entries[0].catalog?.featured, true)
        XCTAssertEqual(data.entries[0].blurb, "Researcher")
        XCTAssertEqual(data.entries[1].look.resolvedSkin, MascotSkin.none, "an unknown skin draws the default, never drops the bot")
        XCTAssertEqual(data.entries[1].blurb, "Does things")
    }

    func testSectionsInTheDesktopsOrder() {
        let data = response([
            entry("feat", .organization, catalog: .init(published: true, featured: true)),
            entry("pub", .organization, catalog: .init(published: true, category: "sales")),
            entry("share", .shared),
            entry("mine", .mine),
            entry("old", .mine, archived: true),
        ])
        let roles = Array(NewBotRules.builtInRoles.prefix(1))
        let templates = BotCatalogRules.templates(presets: [], community: [], roles: roles)
        let sections = BotCatalogRules.sections(data, templates: templates, filter: BotCatalogFilter())
        XCTAssertEqual(sections.map(\.id), [.featured, .shared, .mine, .organization, .templates])
        XCTAssertEqual(sections[0].items.map(\.id), ["bot:feat"])
        XCTAssertEqual(sections[1].items.map(\.id), ["bot:share"])
        XCTAssertEqual(sections[2].items.map(\.id), ["bot:mine"], "archived only with Show archived")
        XCTAssertEqual(sections[3].items.map(\.id), ["bot:feat", "bot:pub"])
        XCTAssertEqual(sections[4].items.map(\.id), ["role:assistant"])

        let archived = BotCatalogRules.sections(data, templates: [], filter: BotCatalogFilter(showArchived: true))
        XCTAssertEqual(archived[2].items.map(\.id), ["bot:mine", "bot:old"])
        let sales = BotCatalogRules.sections(data, templates: templates, filter: BotCatalogFilter(category: "sales"))
        XCTAssertEqual(sales[3].items.map(\.id), ["bot:pub"])
        XCTAssertEqual(sales[4].items, [])

        let solo = BotCatalogRules.sections(response(organization: false, [entry("mine", .mine)]), templates: [], filter: BotCatalogFilter())
        XCTAssertEqual(solo.map(\.id), [.mine, .templates])
    }

    func testSearchIgnoresCaseAndAccentsAndMatchesTheCreator() {
        let bot = BotCatalogItem.bot(entry("scout", .organization, owner: "Zoé Tremblay"))
        XCTAssertTrue(BotCatalogRules.matches(bot, query: "zoe"))
        XCTAssertTrue(BotCatalogRules.matches(bot, query: "SCOUT"))
        XCTAssertTrue(BotCatalogRules.matches(bot, query: "  "))
        XCTAssertFalse(BotCatalogRules.matches(bot, query: "pixel"))
        let role = BotCatalogItem.template(BotCatalogRules.templates(presets: [], community: [], roles: NewBotRules.builtInRoles)[0])
        XCTAssertTrue(BotCatalogRules.matches(role, query: "drafts text"), "a template also by its description")
    }

    func testActionsFollowSourceAndRights() {
        let inSidebar: (String) -> Bool = { $0 == "shown" }
        func actions(_ e: BotCatalogEntry, admin: Bool = false, canCreate: Bool = true) -> [BotCatalogAction] {
            BotCatalogRules.actions(.bot(e), organization: true, admin: admin, canCreate: canCreate, inSidebar: inSidebar)
        }
        XCTAssertEqual(actions(entry("hidden", .shared)), [.addToSidebar, .open, .import])
        XCTAssertEqual(actions(entry("shown", .shared), canCreate: false), [.removeFromSidebar, .open])
        XCTAssertEqual(actions(entry("org", .organization)), [.import])
        XCTAssertEqual(actions(entry("org", .organization), canCreate: false), [])
        XCTAssertEqual(actions(entry("mine", .mine)), [.open, .publish])
        XCTAssertEqual(actions(entry("mine", .mine, catalog: .init(published: true))), [.open, .unpublish])
        XCTAssertEqual(actions(entry("mine", .mine, archived: true)), [])
        XCTAssertEqual(actions(entry("org", .organization, catalog: .init(published: true)), admin: true), [.import, .feature, .unpublish])
        XCTAssertEqual(actions(entry("org", .organization, catalog: .init(published: true, featured: true)), admin: true), [.import, .unfeature, .unpublish])
        XCTAssertEqual(BotCatalogRules.cardAction([.open, .publish]), .open)
        XCTAssertNil(BotCatalogRules.cardAction([.publish]))
        let solo = BotCatalogRules.actions(.bot(entry("mine", .mine)), organization: false, admin: true, canCreate: true, inSidebar: inSidebar)
        XCTAssertEqual(solo, [.open])
    }

    func testTemplatesFoldPresetsCommunityAndRoles() throws {
        let presetJSON = #"{"id":"pr1","source":"org","key":"k","name":"Support","packageName":"Desk","release":"1.0","publisherName":"GOX","bot":{"name":"Helper","title":"Support agent","soul":"Be kind","appearance":{"color":"pink"}},"skills":[{"name":"triage"}],"skillsEnabled":true,"playbooks":[],"notes":["Recommended"]}"#
        let preset = try JSONDecoder().decode(BotPreset.self, from: Data(presetJSON.utf8))
        let team = try JSONDecoder().decode(TeamLibraryCatalog.Team.self, from: Data(#"{"slug":"sales","name":"Sales","summary":"Pipeline.","category":"Sales","members":3}"#.utf8))
        let templates = BotCatalogRules.templates(presets: [preset], community: [team], roles: NewBotRules.builtInRoles)
        XCTAssertEqual(templates.prefix(2).map(\.id), ["preset:pr1", "community:sales"])
        XCTAssertEqual(templates[0].creator, "GOX")
        XCTAssertEqual(templates[1].category, "sales", "a community category that is a default chip")
        XCTAssertEqual(templates.first { $0.id == "role:coder" }?.category, "engineering")

        let draft = try XCTUnwrap(BotCatalogRules.draft(for: templates[0]))
        XCTAssertEqual(draft.name, "Helper")
        XCTAssertEqual(draft.preset, "pr1")
        XCTAssertEqual(draft.color, "pink")
        XCTAssertNil(BotCatalogRules.draft(for: templates[1]), "a community team is added on the computer")
        XCTAssertEqual(BotCatalogRules.actions(.template(templates[1]), organization: true, admin: true, canCreate: true, inSidebar: { _ in true }), [])
        XCTAssertEqual(BotCatalogRules.actions(.template(templates[0]), organization: true, admin: true, canCreate: false, inSidebar: { _ in true }), [])
    }

    func testCategoriesAndNormalisation() {
        let items: [BotCatalogItem] = [
            .bot(entry("a", .organization, catalog: .init(published: true, category: "Zeta team"))),
            .bot(entry("b", .organization, catalog: .init(published: true, category: "Alpha"))),
            .bot(entry("c", .organization, catalog: .init(published: true, category: "sales"))),
        ]
        XCTAssertEqual(BotCatalogRules.categories(items), ["all"] + BotCatalogRules.defaultCategories + ["Alpha", "Zeta team"])
        XCTAssertEqual(BotCatalogRules.normalizeCategory("  SALES "), "sales")
        XCTAssertEqual(BotCatalogRules.normalizeCategory("Field   ops"), "Field ops")
        XCTAssertNil(BotCatalogRules.normalizeCategory("   "))
        XCTAssertEqual(BotCatalogRules.normalizeCategory(String(repeating: "x", count: 60))?.count, 40)
    }

    func testRoutes() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CatalogStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Org", host: "127.0.0.1", port: 8810), token: "t", session: session)

        CatalogStub.body = Data(#"{"organization":false,"viewer":{"principalId":"p","admin":false,"canCreate":true},"entries":[]}"#.utf8)
        _ = try await client.botCatalog()
        XCTAssertEqual(CatalogStub.captured?.url?.path, "/api/bot-catalog")

        CatalogStub.body = Data(#"{"entry":{"id":"b1","name":"S","source":"shared"},"soul":"x","memories":null,"skills":[{"name":"a","description":"b"}],"routines":[{"name":"r","schedule":"Daily","enabled":false}],"integrations":[{"name":"GitHub","kind":"mcp"}]}"#.utf8)
        let detail = try await client.botCatalogDetail(botId: "b1")
        XCTAssertNil(detail.memories)
        XCTAssertEqual(detail.routines.first?.enabled, false)
        XCTAssertEqual(CatalogStub.captured?.url?.path, "/api/bot-catalog/b1")

        CatalogStub.body = Data(#"{"catalog":{"published":true,"category":"sales"}}"#.utf8)
        let listing = try await client.setBotCatalogListing(botId: "b1", published: true, category: " Sales ")
        XCTAssertEqual(listing?.category, "sales")
        XCTAssertEqual(CatalogStub.captured?.httpMethod, "PUT")
        XCTAssertEqual(CatalogStub.captured?.url?.path, "/api/bot-catalog/b1/listing")
        let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(CatalogStub.capturedBody)) as? [String: Any]
        XCTAssertEqual(sent?["published"] as? Bool, true)
        XCTAssertEqual(sent?["category"] as? String, "sales")
        XCTAssertNil(sent?["featured"])

        CatalogStub.body = Data(#"{"catalog":null}"#.utf8)
        let withdrawn = try await client.setBotCatalogListing(botId: "b1", published: false)
        XCTAssertNil(withdrawn)

        CatalogStub.body = Data(#"{"botId":"copy-1"}"#.utf8)
        let copy = try await client.importCatalogBot(botId: "b1")
        XCTAssertEqual(copy, "copy-1")
        XCTAssertEqual(CatalogStub.captured?.httpMethod, "POST")
        XCTAssertEqual(CatalogStub.captured?.url?.path, "/api/bot-catalog/b1/import")
    }

    func testGate() {
        XCTAssertTrue(SurfaceGate(scope: .serverAdmin).allows(.browseBots))
        XCTAssertTrue(SurfaceGate(scope: .serverClient).allows(.browseBots))
        XCTAssertFalse(SurfaceGate(scope: .sidecar).allows(.browseBots))
    }
}
