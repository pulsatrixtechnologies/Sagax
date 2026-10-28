// The person's own page preview (desktop `previewSrc`): only this server's
// wrapper path is ever framed, and the frame under it. Nothing else.
import Foundation

public enum PagePreview {
    /// `/pages/preview/<id>/<n>`, query stripped. Nil when it is not one.
    public static func src(_ path: String) -> String? {
        let bare = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? path
        return isPreview(bare) ? bare : nil
    }

    /// A navigation the preview may follow: the wrapper or its frame, on
    /// the same origin as the API. Another host, another scheme, or a
    /// path that climbs out is refused.
    public static func allows(_ url: URL, apiBase: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return false }
        guard scheme == apiBase.scheme?.lowercased() else { return false }
        guard url.host?.lowercased() == apiBase.host?.lowercased(), url.port == apiBase.port else { return false }
        return isPreview(url.path) || isFrame(url.path)
    }

    private static func isPreview(_ path: String) -> Bool {
        path.range(of: #"^/pages/preview/[A-Za-z0-9_-]{8,40}/\d{1,4}$"#, options: .regularExpression) != nil
    }

    private static func isFrame(_ path: String) -> Bool {
        path.range(of: #"^/pages/preview-frame/[A-Za-z0-9_-]{8,40}/\d{1,4}$"#, options: .regularExpression) != nil
    }
}

public struct PageVersionPreview: Decodable, Equatable, Sendable {
    public var n: Int
    public var previewPath: String
}

private struct PageVersionPreviewBody: Decodable {
    var version: PageVersionPreview
}

public extension CompanionClient {
    /// `GET /api/pages/:id/versions/:n`. The path is kept only when it is
    /// this server's own preview wrapper.
    func pageVersionPreview(id: String, version: Int) async throws -> PageVersionPreview {
        guard PublishedPagesRules.validID(id), (1...9_999).contains(version) else { throw APIError.badURL }
        let body = try await send(makeRequest("GET", "/api/pages/\(id)/versions/\(version)"), as: PageVersionPreviewBody.self)
        guard PagePreview.src(body.version.previewPath) != nil else {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
        return body.version
    }

    /// The authorized GET for a preview path `PagePreview.src` already accepted.
    func pagePreviewRequest(path: String) throws -> URLRequest {
        guard let safe = PagePreview.src(path) else { throw APIError.badURL }
        return try makeRequest("GET", safe)
    }
}
