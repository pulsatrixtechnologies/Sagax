// A bot as one zip on iOS (#271): the file name, the preview and the routes.
import Foundation
import XCTest
@testable import CompanionCore

private final class BotZipStub: URLProtocol {
    static var responses: [String: (Int, Data)] = [:]
    static var requests: [URLRequest] = []
    static var bodies: [Data] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            stream.close()
        }
        Self.bodies.append(data)
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        let (status, body) = Self.responses[key] ?? (200, Data("{}".utf8))
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class BotZipTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        BotZipStub.responses = [:]
        BotZipStub.requests = []
        BotZipStub.bodies = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BotZipStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Org", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private let previewJSON = #"""
    {"kind":"zip","name":"Atlas","importName":"Atlas (2)","appVersion":"0.4.16","exportedAt":1760000000000,
     "includes":{"identity":true,"skills":3},"hasConversations":true,"hasSharing":false,
     "created":[{"part":"skills","detail":"3 skills","key":"botZip.line.skills","params":{"count":3}},{"bad":1}],
     "skipped":[{"part":"host","detail":"Not for a member's copy: Computer."}],
     "needsAction":[{"part":"marketplace","detail":"A token for acme"}]}
    """#

    func testFilenameLikeTheDesktop() {
        XCTAssertEqual(BotZipRules.filename("Atlas Bot"), "atlas-bot.sagaxbot.zip")
        XCTAssertEqual(BotZipRules.filename("Équipe  Ventes!"), "equipe-ventes.sagaxbot.zip")
        XCTAssertEqual(BotZipRules.filename("???"), "bot.sagaxbot.zip")
    }

    func testDecodesThePreview() throws {
        let preview = try JSONDecoder().decode(BotZipPreview.self, from: Data(previewJSON.utf8))
        XCTAssertEqual(preview.importName, "Atlas (2)")
        XCTAssertEqual(preview.created.map(\.detail), ["3 skills"], "one malformed line never hides the rest")
        XCTAssertEqual(preview.skipped.first?.detail, "Not for a member's copy: Computer.")
        XCTAssertEqual(preview.needsAction.count, 1)
        XCTAssertTrue(preview.hasConversations)
        XCTAssertFalse(preview.isLegacy)
        XCTAssertNil(BotZipRules.importName("  Atlas (2) ", preview: preview), "the same name sends none")
        XCTAssertEqual(BotZipRules.importName("Atlas copy", preview: preview), "Atlas copy")
    }

    func testUploadPreviewImportAndDiscard() async throws {
        BotZipStub.responses["POST /api/bots/import/upload"] = (200, Data(#"{"id":"0b7c1f9e-1111-4222-8333-444455556666","preview":\#(previewJSON)}"#.utf8))
        let zip = Data([0x50, 0x4B, 0x03, 0x04, 0x00])
        let staged = try await client.uploadBotZip(zip)
        XCTAssertEqual(staged.preview.name, "Atlas")
        let upload = BotZipStub.requests[0]
        XCTAssertEqual(upload.value(forHTTPHeaderField: "Content-Type"), "application/zip")
        XCTAssertEqual(upload.value(forHTTPHeaderField: "Content-Length"), "5")
        XCTAssertEqual(BotZipStub.bodies[0], zip, "the raw bytes, not multipart")

        let id = staged.id
        BotZipStub.responses["POST /api/bots/import/\(id)/preview"] = (200, Data(#"{"preview":\#(previewJSON)}"#.utf8))
        _ = try await client.previewBotZip(id: id, name: "Atlas copy")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: BotZipStub.bodies[1]) as? [String: String], ["name": "Atlas copy"])

        BotZipStub.responses["POST /api/bots/import/\(id)"] = (201, Data(#"{"botId":"b9","name":"Atlas copy","warnings":["The mascot look stays the default"]}"#.utf8))
        let result = try await client.importBotZip(id: id, name: nil, conversations: true, sharing: false)
        XCTAssertEqual(result.botId, "b9")
        XCTAssertEqual(result.warnings.count, 1)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: BotZipStub.bodies[2]) as? [String: Any])
        XCTAssertNil(sent["name"])
        XCTAssertEqual(sent["conversations"] as? Bool, true)
        XCTAssertEqual(sent["sharing"] as? Bool, false)

        try await client.discardBotZip(id: id)
        XCTAssertEqual(BotZipStub.requests[3].httpMethod, "DELETE")
        XCTAssertEqual(BotZipStub.requests[3].url?.path, "/api/bots/import/\(id)")
    }

    func testAnEmptyFileNeverLeaves() async {
        do {
            _ = try await client.uploadBotZip(Data())
            XCTFail("an empty file was sent")
        } catch {
            XCTAssertTrue(BotZipStub.requests.isEmpty)
        }
    }

    func testExportNamesTheFileAndPassesTheSwitches() async throws {
        BotZipStub.responses["GET /api/bots/b1/export.zip"] = (200, Data([0x50, 0x4B]))
        let url = try await client.exportBotZip(botId: "b1", name: "Atlas Bot", conversations: true, sharing: false)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        XCTAssertEqual(url.lastPathComponent, "atlas-bot.sagaxbot.zip")
        XCTAssertEqual(try Data(contentsOf: url), Data([0x50, 0x4B]))
        XCTAssertEqual(BotZipStub.requests[0].url?.query, "conversations=1")

        BotZipStub.responses["GET /api/bots/b2/export.zip"] = (404, Data(#"{"error":"No such bot."}"#.utf8))
        do {
            _ = try await client.exportBotZip(botId: "b2", name: "x", conversations: false, sharing: false)
            XCTFail("a refused export made a file")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 404)
            XCTAssertEqual(message, "No such bot.")
        }
    }
}
