// Who shared a bot with the viewer (#985, src/lib/bot-sharer.ts): the person
// a bot row wears on its avatar, the same face Browse Bots draws as the
// creator badge. Only a person the organization directory exposes to this
// viewer is named; an owner it does not list, the viewer's own bot and a
// local bot have none.
import Foundation

public struct BotSharer: Hashable, Sendable {
    public var principalId: String
    public var name: String
    public var initials: String
    /// `/api/people/<id>/avatar`, read with the pairing's bearer.
    public var avatarUrl: String?

    public init(principalId: String, name: String, initials: String, avatarUrl: String? = nil) {
        self.principalId = principalId
        self.name = name
        self.initials = initials
        self.avatarUrl = avatarUrl
    }
}

public enum BotSharerRules {
    /// `botSharer`: nil for no face.
    public static func sharer(ownerUserId: String?, viewerId: String, directory: OrgDirectory?) -> BotSharer? {
        let owner = People.norm(ownerUserId)
        guard !owner.isEmpty, owner != "local-owner", owner != People.norm(viewerId),
              let person = directory?.person(owner) else { return nil }
        let name = People.label(person, fallback: People.displayName(person))
        guard !name.isEmpty else { return nil }
        return BotSharer(principalId: owner, name: name, initials: People.initials(name), avatarUrl: personAvatarPath(person.avatarUrl))
    }

    /// `personAvatarSrc` (profile-management.ts): only this server's own
    /// `/api/people/<id>/avatar`, with its optional version.
    public static func personAvatarPath(_ value: String?) -> String? {
        guard let value, value.range(of: #"^/api/people/[A-Za-z0-9_-]{1,80}/avatar(\?v=[0-9A-Za-z_-]{1,64})?$"#, options: .regularExpression) != nil else { return nil }
        return value
    }
}

public extension CompanionClient {
    /// A person's Perspicax picture as this server serves it, with the
    /// pairing's bearer (the bot avatars' rule: never a bare URL).
    func personAvatar(path: String) async throws -> Data {
        guard BotSharerRules.personAvatarPath(path) != nil else { throw APIError.badURL }
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        let query = parts.count > 1 ? [URLQueryItem(name: "v", value: String(parts[1].dropFirst(2)))] : []
        let request = try makeRequest("GET", parts[0], query: query)
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return data
    }
}
