// "Share as Template": a bot frozen as a template behind a public link
// (server/routes/template-links.ts, src/components/TemplateLinkSection.tsx).
// Anyone with the link sees a read-only card and can import it; starter
// notes, connected apps, keys and model choices never go into a link.
// Update freezes the name and description again under the same link;
// turning a link off is immediate and final.
import Foundation

public struct TemplateLink: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var createdAt: Double
    /// When the template behind the link was last updated.
    public var updatedAt: Double?
    public var path: String
    public var url: String
    /// False when the address is this computer only (127.0.0.1).
    public var reachable: Bool

    public init(id: String, name: String, createdAt: Double, updatedAt: Double? = nil, path: String, url: String, reachable: Bool) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.path = path
        self.url = url
        self.reachable = reachable
    }
}

/// `templateLinkBody`: the trimmed name and description, empty ones left out.
public struct TemplateLinkBody: Encodable, Hashable, Sendable {
    public var name: String?
    public var description: String?

    public init(name: String, description: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        self.name = name.isEmpty ? nil : String(name.prefix(100))
        self.description = description.isEmpty ? nil : String(description.prefix(300))
    }
}

public enum TemplateLinkRules {
    /// A link id the phone puts in a URL (`[A-Za-z0-9_-]{22}`).
    public static func validId(_ id: String) -> Bool {
        id.utf8.count == 22 && id.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) || byte == 45 || byte == 95
        }
    }
}

public extension CompanionClient {
    private struct LinksAnswer: Decodable { var links: [TemplateLink] }
    private struct LinkAnswer: Decodable { var link: TemplateLink }

    func templateLinks() async throws -> [TemplateLink] {
        try await send(makeRequest("GET", "/api/template-links"), as: LinksAnswer.self).links
    }

    func createTemplateLink(_ body: TemplateLinkBody) async throws -> TemplateLink {
        try await send(makeRequest("POST", "/api/template-links", encodedBody: body), as: LinkAnswer.self).link
    }

    func updateTemplateLink(id: String, _ body: TemplateLinkBody) async throws -> TemplateLink {
        guard TemplateLinkRules.validId(id) else { throw APIError.badURL }
        return try await send(makeRequest("PUT", "/api/template-links/\(id)", encodedBody: body), as: LinkAnswer.self).link
    }

    func revokeTemplateLink(id: String) async throws {
        guard TemplateLinkRules.validId(id) else { throw APIError.badURL }
        try await send(makeRequest("DELETE", "/api/template-links/\(id)"))
    }
}
