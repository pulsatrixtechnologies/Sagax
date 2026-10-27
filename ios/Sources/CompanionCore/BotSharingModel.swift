// The "Shared with" page's model (BA15, SharingSection.tsx): the people and
// teams a bot is shared with, and the add, change and remove of one. It
// goes through the routes the desktop uses (GET/PUT/DELETE
// /api/bots/:id/grants and GET /api/org/directory); the server decides and
// its answer replaces the list. No admin gate lives here: the owner shares
// their own bot, and the server's rules apply to everyone else.
import Foundation

/// The four routes the page needs. `CompanionClient` is the real one; a
/// test passes its own.
public protocol BotSharingAPI: Sendable {
    func botGrants(botId: String) async throws -> BotGrants
    func putGrant(botId: String, target: String, level: GrantLevel) async throws -> BotGrants
    func removeGrant(botId: String, target: String) async throws -> BotGrants
    func orgShareDirectory() async throws -> OrgShareDirectory
}

extension CompanionClient: BotSharingAPI {}

@MainActor
public final class BotSharingModel: ObservableObject {
    public let bot: Bot
    @Published public private(set) var directory: OrgShareDirectory?
    @Published public private(set) var grants: [WireGrant]?
    @Published public private(set) var administer: GrantAdministration?
    @Published public private(set) var loaded = false
    /// The target being saved, while a request runs.
    @Published public private(set) var busy: String?
    @Published public private(set) var failed = false
    @Published public var query = ""

    private let api: BotSharingAPI

    public init(bot: Bot, api: BotSharingAPI) {
        self.bot = bot
        self.api = api
    }

    /// The server's list, or the bot's own grants until it answers.
    public var rows: [WireGrant] { grants ?? GrantRules.initialRows(bot, directory: directory) }

    /// People and teams that match the search and may be added.
    public var candidates: [GrantCandidate] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return GrantRules.candidates(directory, ownerId: bot.ownerUserId, taken: rows.map(\.target), query: query, administer: administer)
    }

    public func load(viewerPrincipalId: String?) async {
        if GrantRules.viewerOwns(bot, viewerPrincipalId: viewerPrincipalId) { administer = .owner }
        async let directoryAnswer = try? api.orgShareDirectory()
        do {
            let answer = try await api.botGrants(botId: bot.id)
            grants = answer.grants
            administer = answer.administer
        } catch {
            // the owner keeps their own right to share when the read fails
            if administer?.any != true { administer = nil }
        }
        directory = await directoryAnswer ?? OrgShareDirectory(people: [])
        loaded = true
    }

    /// Adds a person or team, or changes the level of one already there.
    @discardableResult
    public func add(_ target: String, level: GrantLevel = .use) async -> Bool {
        await run(target) { [botId = bot.id] in try await $0.putGrant(botId: botId, target: target, level: level) }
    }

    @discardableResult
    public func setLevel(_ target: String, _ level: GrantLevel) async -> Bool {
        await add(target, level: level)
    }

    @discardableResult
    public func remove(_ target: String) async -> Bool {
        await run(target) { [botId = bot.id] in try await $0.removeGrant(botId: botId, target: target) }
    }

    private func run(_ key: String, _ request: (BotSharingAPI) async throws -> BotGrants) async -> Bool {
        busy = key
        failed = false
        defer { busy = nil }
        do {
            let answer = try await request(api)
            grants = answer.grants
            if let next = answer.administer { administer = next }
            query = ""
            return true
        } catch {
            failed = true
            return false
        }
    }
}
