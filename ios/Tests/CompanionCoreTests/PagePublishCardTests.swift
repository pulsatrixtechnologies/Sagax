// The card under a bot's propose_page row (desktop PagePublishCard).
import Foundation
import XCTest
@testable import CompanionCore

final class PagePublishCardTests: XCTestCase {
    func testThePagePublishFieldDecodesOnItsMessage() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"Page proposed: Report",
         "pagePublish":{"pageId":"page_id_1","version":2,"title":"Report"}}
        """#.utf8))
        let ref = try XCTUnwrap(message.pagePublish)
        XCTAssertEqual(ref, PagePublishRef(pageId: "page_id_1", version: 2, title: "Report"))
        XCTAssertTrue(ref.isDrawable)
    }

    func testAFieldOfAnotherShapeKeepsTheMessageAsItsText() throws {
        for field in [#""oops""#, #"{"pageId":"../etc","version":1,"title":"x"}"#, #"{"pageId":"page_id_1","version":"2"}"#] {
            let message = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m","role":"bot","kind":"text","at":1,"text":"x","pagePublish":\#(field)}"#.utf8))
            XCTAssertEqual(message.text, "x")
            XCTAssertEqual(message.pagePublish?.isDrawable, false, field)
        }
        let plain = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m","role":"bot","kind":"text","at":1,"text":"x"}"#.utf8))
        XCTAssertNil(plain.pagePublish)
    }

    func testWhereTheProposedVersionStands() throws {
        let ref = PagePublishRef(pageId: "page_id_1", version: 2, title: "Report")
        func page(_ status: String, current: Int?, state: String = "proposed") throws -> PublishedPageSummary {
            let current = current.map(String.init) ?? "null"
            return try JSONDecoder().decode(PublishedPageSummary.self, from: Data(#"""
            {"id":"page_id_1","title":"Report","status":"\#(status)","access":"org","currentVersion":\#(current),
             "versions":[{"n":1,"title":"Report","state":"published"},{"n":2,"title":"Report","state":"\#(state)"},{"n":3,"title":"Report","state":"proposed"}]}
            """#.utf8))
        }
        XCTAssertEqual(PagePublishCardRules.state(page: try page("draft", current: nil), ref: ref), .proposed)
        XCTAssertEqual(PagePublishCardRules.state(page: try page("published", current: 2, state: "published"), ref: ref), .published)
        XCTAssertEqual(PagePublishCardRules.state(page: try page("published", current: 1), ref: ref), .proposed)
        XCTAssertEqual(PagePublishCardRules.state(page: try page("published", current: 3), ref: ref), .superseded)
        XCTAssertEqual(PagePublishCardRules.state(page: try page("draft", current: nil, state: "declined"), ref: ref), .declined)
        let revoked = try page("revoked", current: 2, state: "published")
        let revokedState = PagePublishCardRules.state(page: revoked, ref: ref)
        XCTAssertEqual(revokedState, .proposed, "a revoked page can be published again")
        XCTAssertTrue(PagePublishCardRules.showsRevokedNote(page: revoked, state: revokedState))
        XCTAssertFalse(PagePublishCardRules.showsRevokedNote(page: try page("revoked", current: 2, state: "declined"), state: .declined))
        XCTAssertNil(PagePublishCardRules.state(page: try page("draft", current: nil), ref: PagePublishRef(pageId: "page_id_1", version: 9, title: "")))
    }

    func testTheOrganizationsLinkSwitchAndTheSecondPress() throws {
        let off = try JSONDecoder().decode(PagesPolicy.self, from: Data(#"{"linkSharing":false,"readerComments":true}"#.utf8))
        XCTAssertFalse(PagePublishCardRules.allows(.link, policy: off))
        XCTAssertTrue(PagePublishCardRules.allows(.org, policy: off))
        XCTAssertTrue(PagePublishCardRules.allows(.link, policy: .default))
        XCTAssertEqual(try JSONDecoder().decode(PagesPolicy.self, from: Data("{}".utf8)), .default)
        XCTAssertTrue(PagePublishCardRules.needsLinkConfirm(.link, confirmed: false))
        XCTAssertFalse(PagePublishCardRules.needsLinkConfirm(.link, confirmed: true))
        XCTAssertFalse(PagePublishCardRules.needsLinkConfirm(.private, confirmed: false))
    }

    func testPublishBodyMatchesTheDesktop() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let never = PagePublishCardRules.publishBody(version: 2, access: .org, hours: 0, now: now)
        XCTAssertEqual(never["version"] as? Int, 2)
        XCTAssertEqual(never["access"] as? String, "org")
        XCTAssertTrue(never["expiresAt"] is NSNull)
        let day = PagePublishCardRules.publishBody(version: 1, access: .link, hours: 24, now: now)
        XCTAssertEqual(day["expiresAt"] as? Int, 1_700_000_000_000 + 86_400_000)
    }

    func testPublishAndDeclinePostTheirRoutes() async throws {
        let harness = PublishHarness()
        let page = #"{"id":"page_id_1","title":"Report","status":"published","access":"org","currentVersion":2,"versions":[{"n":2,"title":"Report","state":"published"}]}"#
        harness.respond(#"{"page":\#(page)}"#)
        let published = try await harness.client.publishPage(id: "page_id_1", version: 2, access: .org, hours: 0)
        XCTAssertEqual(published.currentVersion, 2)
        XCTAssertEqual(harness.captured?.httpMethod, "POST")
        XCTAssertEqual(harness.captured?.url?.path, "/api/pages/page_id_1/publish")
        let sent = try harness.body()
        XCTAssertEqual(sent["version"] as? Int, 2)
        XCTAssertEqual(sent["access"] as? String, "org")
        XCTAssertTrue(sent["expiresAt"] is NSNull)

        harness.respond(#"{"page":\#(page.replacingOccurrences(of: "\"state\":\"published\"", with: "\"state\":\"declined\""))}"#)
        let declined = try await harness.client.declinePage(id: "page_id_1", version: 2)
        XCTAssertEqual(declined.versions.first?.state, "declined")
        XCTAssertEqual(harness.captured?.url?.path, "/api/pages/page_id_1/decline")
        XCTAssertEqual(try harness.body() as NSDictionary, ["version": 2] as NSDictionary)

        harness.respond(#"{"page":\#(page)}"#)
        _ = try await harness.client.publishedPage(id: "page_id_1")
        XCTAssertEqual(harness.captured?.httpMethod, "GET")
        XCTAssertEqual(harness.captured?.url?.path, "/api/pages/page_id_1")

        harness.respond(#"{"linkSharing":false,"readerComments":false}"#)
        let policy = await harness.client.pagesPolicy()
        XCTAssertFalse(policy.linkSharing)
        XCTAssertEqual(harness.captured?.url?.path, "/api/pages/policy")
        harness.respond(#"{"error":"nope"}"#, status: 404)
        let older = await harness.client.pagesPolicy()
        XCTAssertEqual(older, .default, "an older server without the switch allows links")

        harness.respond(#"{"error":"Your organization turned off public links for pages.","code":"link_sharing_off"}"#, status: 403)
        do {
            _ = try await harness.client.publishPage(id: "page_id_1", version: 2, access: .link, hours: 0)
            XCTFail("the refusal reaches the card")
        } catch {
            XCTAssertTrue(error is APIError)
        }
        do {
            _ = try await harness.client.declinePage(id: "../etc", version: 1)
            XCTFail("a page id with a slash is not sent")
        } catch {
            XCTAssertEqual(harness.captured?.url?.path, "/api/pages/page_id_1/publish")
        }
        harness.finish()
    }
}

private final class PublishHarness {
    let client: CompanionClient
    private let session: URLSession
    var captured: URLRequest? { PublishStub.captured }

    init() {
        PublishStub.captured = nil
        PublishStub.capturedBody = nil
        PublishStub.statusCode = 200
        PublishStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PublishStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "paired-token", session: session)
    }

    func respond(_ json: String, status: Int = 200) {
        PublishStub.responseBody = Data(json.utf8)
        PublishStub.statusCode = status
    }

    func body() throws -> [String: Any] {
        let data = try XCTUnwrap(PublishStub.capturedBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func finish() { session.invalidateAndCancel() }
}

private final class PublishStub: URLProtocol {
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
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
