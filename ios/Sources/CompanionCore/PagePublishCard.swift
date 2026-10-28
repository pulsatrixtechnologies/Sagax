// The card under a bot's `propose_page` row (message field `pagePublish`,
// shared/wire.ts): the person previews the proposed version, chooses who can
// see it and until when, then publishes it or declines it. The desktop's
// PagePublishCard (src/components/PublishedPages.tsx). Only the person's
// Publish puts the page online; the organization's switch for public links
// (`GET /api/pages/policy`) is read and respected, never worked around.
import Foundation

/// `Message.pagePublish`: which page and which version the bot proposed.
/// A field of another shape never loses the message: it decodes to an
/// undrawable reference and the row reads as its text.
public struct PagePublishRef: Codable, Hashable, Sendable {
    public var pageId: String
    public var version: Int
    public var title: String

    public init(pageId: String, version: Int, title: String) {
        self.pageId = pageId
        self.version = version
        self.title = title
    }

    public init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        pageId = (try? values?.decodeIfPresent(String.self, forKey: .pageId)) ?? ""
        version = (try? values?.decodeIfPresent(Int.self, forKey: .version)) ?? 0
        title = (try? values?.decodeIfPresent(String.self, forKey: .title)) ?? ""
    }

    /// A page id the routes accept and a real version number.
    public var isDrawable: Bool {
        PublishedPagesRules.validID(pageId) && (1...9_999).contains(version)
    }

    private enum CodingKeys: String, CodingKey { case pageId, version, title }
}

/// The organization's switches for pages (`PagesPolicy`). An older server
/// that has none allows both, as the desktop does.
public struct PagesPolicy: Decodable, Hashable, Sendable {
    public var linkSharing: Bool
    public var readerComments: Bool

    public static let `default` = PagesPolicy(linkSharing: true, readerComments: true)

    public init(linkSharing: Bool, readerComments: Bool) {
        self.linkSharing = linkSharing
        self.readerComments = readerComments
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        linkSharing = (try? values.decodeIfPresent(Bool.self, forKey: .linkSharing)) ?? true
        readerComments = (try? values.decodeIfPresent(Bool.self, forKey: .readerComments)) ?? true
    }

    private enum CodingKeys: String, CodingKey { case linkSharing, readerComments }
}

public enum PagePublishCardRules {
    public enum State: String, Sendable {
        case proposed, published, declined, superseded
    }

    /// Where the proposed version stands. Nil while the version is not in
    /// the page (the card waits, as the desktop does).
    public static func state(page: PublishedPageSummary, ref: PagePublishRef) -> State? {
        guard let version = page.versions.first(where: { $0.n == ref.version }) else { return nil }
        if page.status == "published", page.currentVersion == ref.version { return .published }
        if version.state == "declined" { return .declined }
        if let current = page.currentVersion, current > ref.version { return .superseded }
        return .proposed
    }

    /// "This page is no longer published" under a revoked page.
    public static func showsRevokedNote(page: PublishedPageSummary, state: State?) -> Bool {
        page.status == "revoked" && state != .declined
    }

    /// The access this person may choose: a public link only while the
    /// organization allows it.
    public static func allows(_ access: PublishedPageAccess, policy: PagesPolicy) -> Bool {
        access != .link || policy.linkSharing
    }

    /// A public link asks a second press before it is sent.
    public static func needsLinkConfirm(_ access: PublishedPageAccess, confirmed: Bool) -> Bool {
        access == .link && !confirmed
    }

    /// The body of `POST /api/pages/:id/publish` (desktop `publishBody`):
    /// the version, who can see it, and the expiry in milliseconds or null.
    public static func publishBody(version: Int, access: PublishedPageAccess, hours: Int, now: Date = Date()) -> [String: Any] {
        var body: [String: Any] = ["version": version, "access": access.rawValue]
        if let at = PublishedPagesRules.expiresAt(hours: hours, now: now) {
            body["expiresAt"] = at
        } else {
            body["expiresAt"] = NSNull()
        }
        return body
    }

    /// The body of `POST /api/pages/:id/decline`.
    public static func declineBody(version: Int) -> [String: Any] {
        ["version": version]
    }
}

private struct PagePublishPageBody: Decodable {
    var page: PublishedPageSummary?
}

public extension CompanionClient {
    /// `GET /api/pages/:id`. Another person's page reads as missing.
    func publishedPage(id: String) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id) else { throw APIError.badURL }
        let answer = try await send(makeRequest("GET", "/api/pages/\(id)"), as: PagePublishPageBody.self)
        return try pagePublishAnswer(answer)
    }

    /// `GET /api/pages/policy`. An older server without it allows links.
    func pagesPolicy() async -> PagesPolicy {
        guard let request = try? makeRequest("GET", "/api/pages/policy"),
              let policy = try? await send(request, as: PagesPolicy.self) else { return .default }
        return policy
    }

    /// `POST /api/pages/:id/publish`: the person's own choice of who can
    /// see the page and until when.
    func publishPage(id: String, version: Int, access: PublishedPageAccess, hours: Int) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id), (1...9_999).contains(version) else { throw APIError.badURL }
        let body = PagePublishCardRules.publishBody(version: version, access: access, hours: hours)
        let answer = try await send(makeRequest("POST", "/api/pages/\(id)/publish", body: body), as: PagePublishPageBody.self)
        return try pagePublishAnswer(answer)
    }

    /// `POST /api/pages/:id/decline`: this version is never published.
    func declinePage(id: String, version: Int) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id), (1...9_999).contains(version) else { throw APIError.badURL }
        let body = PagePublishCardRules.declineBody(version: version)
        let answer = try await send(makeRequest("POST", "/api/pages/\(id)/decline", body: body), as: PagePublishPageBody.self)
        return try pagePublishAnswer(answer)
    }

    private func pagePublishAnswer(_ body: PagePublishPageBody) throws -> PublishedPageSummary {
        guard let page = body.page else {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
        return page
    }
}
