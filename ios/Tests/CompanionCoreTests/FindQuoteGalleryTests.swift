// WP4 of the feature parity matrix: find in conversation (MS11), quote as a
// citation (CO8) and the conversation-wide lightbox (CA31). Expected values
// were produced by the desktop's own src/lib/citations.ts on the same input,
// so a citation made on the phone is one the desktop reads, and back.
import Foundation
import XCTest
@testable import CompanionCore

private final class FindRequestStub: URLProtocol {
    static var captured: URLRequest?
    static var body = Data(#"{"hits":[{"threadId":"t1","messageId":"m2","at":1,"role":"assistant","kind":"text","snippet":"un mot","matchStart":3,"matchLength":3,"botId":"b1","name":"Rigel","onActivePath":false}]}"#.utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class FindQuoteGalleryTests: XCTestCase {
    private let sourceText = "Première ligne  avec   espaces\n\nLe déploiement 🚀 est prêt pour demain matin, après la revue."
    /// `serializeCitation` of the desktop for the selection below, id "fixed-id".
    private let desktopSerialized = "<!--omb-citation-v1:eyJraW5kIjoiY2l0YXRpb24iLCJ2ZXJzaW9uIjoxLCJpZCI6ImZpeGVkLWlkIiwicXVvdGUiOiJMZSBkw6lwbG9pZW1lbnQg8J-agCBlc3QgcHLDqnQgcG91ciBkZW1haW4gbWF0aW4iLCJjb21tZW50IjoicG91cnF1b2kgPyIsInNvdXJjZSI6eyJvd25lclR5cGUiOiJib3QiLCJvd25lcklkIjoiYjEiLCJ0aHJlYWRJZCI6InQxIiwibWVzc2FnZUlkIjoibTEiLCJzdGFydCI6MjgsImVuZCI6NzIsInByZWZpeCI6IlByZW1pw6hyZSBsaWduZSBhdmVjIGVzcGFjZXMgIiwic3VmZml4IjoiLCBhcHLDqHMgbGEgcmV2dWUuIn0sInNpemUiOjU4fQ-->\n> Quoted message:\n> Le déploiement 🚀 est prêt pour demain matin\n\nComment:\npourquoi ?"

    private func range(_ needle: String) -> NSRange { (sourceText as NSString).range(of: needle) }

    // MARK: Citations (CO8)

    func testSelectorMatchesTheDesktop() throws {
        let start = range("Le déploiement").location
        let end = range(", après").location
        let selector = try XCTUnwrap(Citations.selector(in: sourceText, start: start, end: end))
        XCTAssertEqual(selector.text, "Le déploiement 🚀 est prêt pour demain matin")
        XCTAssertEqual(selector.start, 28)
        XCTAssertEqual(selector.end, 72)
        XCTAssertEqual(selector.prefix, "Première ligne avec espaces ")
        XCTAssertEqual(selector.suffix, ", après la revue.")

        // A selection starting inside a whitespace run counts from the run.
        let inRun = try XCTUnwrap(Citations.selector(in: sourceText, start: range("  avec").location + 1, end: range("avec").location + 4))
        XCTAssertEqual(inRun.text, " avec")
        XCTAssertEqual(inRun.start, 14)
        XCTAssertEqual(inRun.end, 19)
        XCTAssertEqual(inRun.prefix, "Première ligne")
        XCTAssertEqual(inRun.suffix, " espaces Le déploiement 🚀 est prêt pour demain matin, après la ")

        XCTAssertNil(Citations.selector(in: sourceText, start: 14, end: 16), "blank selection")
    }

    func testAttachmentSerializesExactlyAsTheDesktop() throws {
        let selector = try XCTUnwrap(Citations.selector(in: sourceText, start: range("Le déploiement").location, end: range(", après").location))
        let source = CitationSource(ownerType: .bot, ownerId: "b1", threadId: "t1", messageId: "m1")
        let citation = try XCTUnwrap(Citations.attachment(source: source, selector: selector, comment: " pourquoi ? ", id: "fixed-id"))
        XCTAssertEqual(citation.comment, "pourquoi ?")
        XCTAssertEqual(citation.size, 58)
        let mine = Citations.serialize(citation)
        // Byte for byte the desktop's marker and fallback.
        XCTAssertEqual(mine, desktopSerialized)
        XCTAssertEqual(Citations.jsString("a\"b\\c\n\u{01}é"), #""a\"b\\c\n\u0001é""#)
        let back = Citations.split("Regarde ça\n\n" + mine)
        XCTAssertEqual(back.display, "Regarde ça")
        XCTAssertEqual(back.citations, [citation])
    }

    func testSplitReadsADesktopCitation() throws {
        let split = Citations.split("Regarde ça\n\n" + desktopSerialized)
        XCTAssertEqual(split.display, "Regarde ça")
        let citation = try XCTUnwrap(split.citations.first)
        XCTAssertEqual(citation.quote, "Le déploiement 🚀 est prêt pour demain matin")
        XCTAssertEqual(citation.comment, "pourquoi ?")
        XCTAssertEqual(citation.source, CitationSource(
            ownerType: .bot, ownerId: "b1", threadId: "t1", messageId: "m1",
            start: 28, end: 72, prefix: "Première ligne avec espaces ", suffix: ", après la revue."
        ))
        // A tampered fallback is not a citation: the text stays as it is.
        let tampered = desktopSerialized.replacingOccurrences(of: "> Le déploiement", with: "> Le deploiement")
        XCTAssertTrue(Citations.split(tampered).citations.isEmpty)
        XCTAssertEqual(Citations.split("rien").display, "rien")
        // The preview line of WP1 reads the same block.
        XCTAssertEqual(Citations.previewText("Regarde ça\n\n" + desktopSerialized), "Regarde ça Le déploiement 🚀 est prêt pour demain matin — pourquoi ?")
    }

    func testLimitsAndCommentEdits() throws {
        let source = CitationSource(ownerType: .group, ownerId: "g1", threadId: "t1", messageId: "m1")
        let long = String(repeating: "a", count: Citations.maxQuoteLength + 1)
        let tooLong = try XCTUnwrap(Citations.selector(in: long, start: 0, end: (long as NSString).length))
        XCTAssertNil(Citations.attachment(source: source, selector: tooLong), "a quote over 12,000 characters")
        let short = try XCTUnwrap(Citations.selector(in: "deux mots", start: 0, end: 4))
        let citation = try XCTUnwrap(Citations.attachment(source: source, selector: short))
        XCTAssertNil(citation.comment)
        XCTAssertEqual(citation.size, 4)
        XCTAssertNil(Citations.withComment(citation, String(repeating: "c", count: Citations.maxCommentLength + 1)))
        let commented = try XCTUnwrap(Citations.withComment(citation, "  vu  "))
        XCTAssertEqual(commented.comment, "vu")
        XCTAssertEqual(commented.size, 6)
        XCTAssertNil(try XCTUnwrap(Citations.withComment(commented, " ")).comment, "an empty comment removes it")
        // Composed after the words, the blocks untrimmed.
        let composed = Citations.compose("  Voilà ", citations: [citation])
        XCTAssertEqual(composed, "Voilà\n\n" + Citations.serialize(citation))
        XCTAssertEqual(Citations.compose("", citations: [citation]), Citations.serialize(citation))
        XCTAssertEqual(Citations.compose("seul", citations: []), "seul")
    }

    // MARK: Find (MS11)

    func testFindAsksForOneThread() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FindRequestStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        let hits = try await client.search("mot", threadId: "t1")
        let url = try XCTUnwrap(FindRequestStub.captured?.url)
        XCTAssertEqual(url.path, "/api/search")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "q" }?.value, "mot")
        XCTAssertEqual(items.first { $0.name == "limit" }?.value, "100")
        XCTAssertEqual(items.first { $0.name == "threadId" }?.value, "t1")
        XCTAssertEqual(hits.map(\.messageId), ["m2"])
        XCTAssertEqual(hits.first?.onActivePath, false)
    }

    func testFindStepsWrapBothWays() {
        XCTAssertNil(FindInConversation.step(0, by: 1, count: 0))
        XCTAssertEqual(FindInConversation.step(2, by: 1, count: 3), 0)
        XCTAssertEqual(FindInConversation.step(0, by: -1, count: 3), 2)
        XCTAssertEqual(FindInConversation.step(1, by: 1, count: 3), 2)
    }

    // MARK: Lightbox (CA31)

    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testGalleryWalksTheConversationInReadingOrder() throws {
        let messages = try [
            message(#"{"id":"u1","role":"user","kind":"text","at":1,"text":"Voici\n<attached-image path=\"/tmp/a.png\" name=\"a.png\" />\n<attached-file path=\"/tmp/b.pdf\" name=\"b.pdf\" />\n<attached-image path=\"/tmp/c.jpg\" name=\"c.jpg\" />"}"#),
            message(#"{"id":"b1","role":"assistant","kind":"text","at":2,"text":"Fait","attachments":[{"kind":"image","path":"/out/gen.png"},{"kind":"image","path":"/out/gen.png"}]}"#),
            message(#"{"id":"b2","role":"assistant","kind":"text","at":3,"text":"Rien"}"#),
        ]
        let images = ConversationGallery.images(in: messages)
        XCTAssertEqual(images.map(\.messageId), ["u1", "u1", "b1"])
        XCTAssertEqual(images.map(\.path), ["/tmp/a.png", "/tmp/c.jpg", "/out/gen.png"])
        XCTAssertEqual(images.first?.name, "a.png")
        XCTAssertEqual(ConversationGallery.wrapped(0, step: -1, count: 3), 2)
        XCTAssertEqual(ConversationGallery.wrapped(2, step: 1, count: 3), 0)
        XCTAssertEqual(ConversationGallery.wrapped(0, step: 1, count: 0), 0)
    }

    func testLightboxKeys() {
        XCTAssertEqual(LightboxKeyAction.action(for: "Escape", count: 1), .close)
        XCTAssertNil(LightboxKeyAction.action(for: "ArrowLeft", count: 1))
        XCTAssertEqual(LightboxKeyAction.action(for: "ArrowLeft", count: 2), .previous)
        XCTAssertEqual(LightboxKeyAction.action(for: "ArrowRight", count: 2), .next)
        XCTAssertEqual(LightboxKeyAction.action(for: "=", count: 1), .zoomIn)
        XCTAssertEqual(LightboxKeyAction.action(for: "_", count: 1), .zoomOut)
        XCTAssertEqual(LightboxKeyAction.action(for: "0", count: 1), .zoomReset)
    }
}

final class FindQuoteGateTests: XCTestCase {
    /// Tier A: every pairing finds and quotes (the routes pass both gates).
    func testEveryPairingFindsAndQuotes() {
        for scope in [PairingScope.sidecar, .serverClient, .serverAdmin] {
            let gate = SurfaceGate(scope: scope, sidecarRoutes: [])
            XCTAssertTrue(gate.allows(.findInConversation), "\(scope)")
            XCTAssertTrue(gate.allows(.citationQuote), "\(scope)")
        }
    }
}
