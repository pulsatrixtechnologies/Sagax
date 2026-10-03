import Foundation
import XCTest
@testable import CompanionCore

private final class AppearanceStub: URLProtocol {
    /// path -> (status, body)
    static var routes: [String: (Int, String)] = [:]
    static var requests: [(method: String, path: String, body: Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url!.path
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        Self.requests.append((request.httpMethod ?? "GET", path, body))
        let (status, text) = Self.routes["\(request.httpMethod ?? "GET") \(path)"] ?? (404, #"{"error":"not found"}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(text.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ClientAppearanceTests: XCTestCase {
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        AppearanceStub.routes = [:]
        AppearanceStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AppearanceStub.self]
        client = CompanionClient(
            connection: Connection(name: "Test", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: URLSession(configuration: configuration)
        )
    }

    func testOrganizationServerReadsThePersonsPreferences() async throws {
        AppearanceStub.routes["GET /api/me/preferences"] = (200, #"{"stored":true,"preferences":{"omb-skin":"dusk","omb-font":"serif","omb-language":"fr"},"updatedAt":1}"#)
        let record = try await client.computerAppearance()
        XCTAssertEqual(record?.source, .organization)
        XCTAssertEqual(record?.appearance.skin, .dusk)
        XCTAssertEqual(record?.appearance.font, .serif)
    }

    func testPersonalComputerFallsBackToTheDesktopAppearance() async throws {
        AppearanceStub.routes["GET /api/me/appearance"] = (200, #"{"stored":true,"preferences":{"omb-skin":"atelier"},"updatedAt":1}"#)
        let record = try await client.computerAppearance()
        XCTAssertEqual(record?.source, .personal)
        XCTAssertEqual(record?.appearance.skin, .atelier)
    }

    func testOlderComputerHasNoAppearance() async throws {
        let record = try await client.computerAppearance()
        XCTAssertNil(record)
    }

    func testWritingBackKeepsTheOtherPreferences() async throws {
        AppearanceStub.routes["GET /api/me/preferences"] = (200, #"{"stored":true,"preferences":{"omb-skin":"dusk","omb-language":"fr","omb.retro98.unlocked":"1"},"updatedAt":1}"#)
        AppearanceStub.routes["PUT /api/me/preferences"] = (200, #"{"stored":true,"preferences":{},"updatedAt":2}"#)
        try await client.saveComputerAppearance(ComputerAppearance.preferences(skin: .lagoon, font: .skin, retroUnlocked: false), to: .organization)
        let put = try XCTUnwrap(AppearanceStub.requests.last { $0.method == "PUT" })
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: put.body ?? Data()) as? [String: [String: String]])
        XCTAssertEqual(json["preferences"], ["omb-skin": "lagoon", "omb-font": "skin", "omb-language": "fr", "omb.retro98.unlocked": "1"])
    }

    func testWritingBackToAPersonalComputer() async throws {
        AppearanceStub.routes["PUT /api/me/appearance"] = (200, #"{"stored":true,"preferences":{},"updatedAt":2}"#)
        try await client.saveComputerAppearance(ComputerAppearance.preferences(skin: .retro98, font: .serif, retroUnlocked: true), to: .personal)
        let put = try XCTUnwrap(AppearanceStub.requests.last)
        XCTAssertEqual(put.path, "/api/me/appearance")
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: put.body ?? Data()) as? [String: [String: String]])
        XCTAssertEqual(json["preferences"], ["omb-skin": "retro98", "omb-font": "serif", "omb.retro98.on": "1", "omb.retro98.unlocked": "1"])
    }
}
