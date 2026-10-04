// iPad I2b: the sidebar team menu's "Share team…" (src/components/
// ShareTeamDialog.tsx, src/lib/team-share.ts): the server packs a team into
// a package file (`POST /api/teams/export`), shared whole as the desktop
// dialog starts (every skill, the starter notes; never chat history, and
// keys are redacted by the server). The iPad hands the file to the share
// sheet instead of the desktop's Save file.
import Foundation

/// The package file: its name and its pretty-printed JSON, as the
/// desktop's `saveShareFile` writes it.
public struct TeamShareFile: Equatable, Sendable {
    public var filename: String
    public var data: Data
}

extension CompanionClient {
    public func exportTeam(_ team: String) async throws -> TeamShareFile {
        let (data, response) = try await perform(try exportTeamRequest(team))
        try Self.check(response, data)
        return try Self.teamShareFile(from: data, team: team)
    }

    func exportTeamRequest(_ team: String) throws -> URLRequest {
        let name = team.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw APIError.badURL }
        return try makeRequest("POST", "/api/teams/export", body: [
            "format": "package",
            "version": 2,
            "team": name,
            "skills": "all",
            "includeMemory": true,
        ])
    }

    static func teamShareFile(from data: Data, team: String) throws -> TeamShareFile {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let document = object["document"],
              JSONSerialization.isValidJSONObject(document),
              var body = try? JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        else { throw APIError.transport("The computer sent something this app couldn't read.") }
        body.append(0x0A)
        let given = (object["filename"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let safe = given.replacingOccurrences(of: "/", with: "-")
        return TeamShareFile(filename: safe.isEmpty ? "\(team).sagax-team.json" : safe, data: body)
    }
}
