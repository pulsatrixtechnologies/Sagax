// Templates, the team library's catalog (TeamLibraryPanel.tsx): the teams a
// person can install from the desktop. The iPad lists them read-only; an
// install runs on the computer.
import Foundation

public struct TeamLibraryCatalog: Decodable, Equatable, Sendable {
    public struct Team: Decodable, Equatable, Identifiable, Sendable {
        public var slug: String
        public var name: String
        public var summary: String
        public var category: String?
        public var members: Int?
        public var featured: Bool?
        public var id: String { slug }
    }

    public var repositoryUrl: String?
    public var teams: [Team]

    enum CodingKeys: String, CodingKey { case repositoryUrl, teams }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        repositoryUrl = try container.decodeIfPresent(String.self, forKey: .repositoryUrl)
        // one malformed entry never hides the rest
        teams = (try container.decodeIfPresent([Lossy<Team>].self, forKey: .teams) ?? []).compactMap(\.value)
    }
}

public extension CompanionClient {
    /// `GET /api/team-library/catalog` (admin scope on a server).
    func teamLibraryCatalog() async throws -> TeamLibraryCatalog {
        try await send(try makeRequest("GET", "/api/team-library/catalog"), as: TeamLibraryCatalog.self)
    }
}
