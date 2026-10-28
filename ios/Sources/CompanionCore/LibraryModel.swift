// The Library tab's model (`src/lib/library-items.ts`): the conversation's
// files and the bot's artifacts in one list, what the person pinned on top,
// the rest by how recent it is. A file's pin is kept on the server per
// conversation; an artifact's pin is its favorite flag.
import Foundation

/// One artifact in a list (`GET /api/bots/:id/artifacts`): everything but
/// the widget's document, which is fetched when it opens.
public struct BotArtifact: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var botId: String
    public var title: String
    /// The Library's pin.
    public var favorite: Bool
    /// Milliseconds.
    public var updatedAt: Double
    /// "idle", "ok", "error", "paused" or "blocked".
    public var refreshState: String

    private enum CodingKeys: String, CodingKey { case id, botId, title, favorite, updatedAt, refresh }
    private struct Refresh: Decodable { var state: String? }

    public init(id: String, botId: String = "", title: String, favorite: Bool = false, updatedAt: Double, refreshState: String = "idle") {
        self.id = id
        self.botId = botId
        self.title = title
        self.favorite = favorite
        self.updatedAt = updatedAt
        self.refreshState = refreshState
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        botId = try values.decodeIfPresent(String.self, forKey: .botId) ?? ""
        title = try values.decodeIfPresent(String.self, forKey: .title) ?? ""
        favorite = try values.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
        updatedAt = try values.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        refreshState = try values.decodeIfPresent(Refresh.self, forKey: .refresh)?.state ?? "idle"
    }

    /// A refresh that did not work: the Library marks the row.
    public var needsAttention: Bool { ["error", "paused", "blocked"].contains(refreshState) }
}

struct BotArtifactsResponse: Decodable {
    var artifacts: [BotArtifact]
}

/// One artifact opened: its document and the last data of its source.
public struct BotArtifactDocument: Equatable, Sendable {
    public var title: String
    public var html: String
    /// The source's last JSON, serialized; nil when it has none.
    public var dataJSON: String?
    public var dataAt: Double?

    public init(title: String, html: String, dataJSON: String? = nil, dataAt: Double? = nil) {
        self.title = title
        self.html = html
        self.dataJSON = dataJSON
        self.dataAt = dataAt
    }

    /// Reads `GET /api/bots/:id/artifacts/:id` (`{ artifact: {...} }`).
    public static func parse(_ data: Data) -> BotArtifactDocument? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let artifact = root["artifact"] as? [String: Any],
              let html = artifact["html"] as? String else { return nil }
        var json: String?
        var at: Double?
        if let stored = artifact["data"] as? [String: Any], let value = stored["value"], !(value is NSNull),
           let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) {
            json = String(data: bytes, encoding: .utf8)
            at = stored["at"] as? Double
        }
        return BotArtifactDocument(title: artifact["title"] as? String ?? "", html: html, dataJSON: json, dataAt: at)
    }
}

public enum LibraryEntry: Identifiable, Hashable, Sendable {
    case file(ThreadFile)
    case artifact(BotArtifact)
    /// A page the bot made (`GET /api/pages`, this bot's), 2026-10-28.
    case page(PublishedPageSummary)

    public var id: String {
        switch self {
        case let .file(file): "file:\(file.id)"
        case let .artifact(artifact): "artifact:\(artifact.id)"
        case let .page(page): "page:\(page.id)"
        }
    }

    /// Milliseconds: a file's message time, an artifact's last change.
    public var at: Double {
        switch self {
        case let .file(file): file.at
        case let .artifact(artifact): artifact.updatedAt
        case let .page(page): page.updatedAt
        }
    }

    public var pinned: Bool {
        switch self {
        case let .file(file): file.pinned
        case let .artifact(artifact): artifact.favorite
        case let .page(page): page.pinned
        }
    }
}

public struct LibraryGroups: Equatable, Sendable {
    public var pinned: [LibraryEntry]
    public var thisWeek: [LibraryEntry]
    public var older: [LibraryEntry]

    public var isEmpty: Bool { pinned.isEmpty && thisWeek.isEmpty && older.isEmpty }
}

public enum LibraryRules {
    /// Pinned on top whatever the age; the rest in the last seven days, or
    /// older. Each part is newest first. `now` and the times are milliseconds.
    public static func groups(files: [ThreadFile], artifacts: [BotArtifact], pages: [PublishedPageSummary] = [], now: Double) -> LibraryGroups {
        let week = 7.0 * 24 * 3_600_000
        let entries = (files.map(LibraryEntry.file) + artifacts.map(LibraryEntry.artifact) + pages.map(LibraryEntry.page))
            .sorted { $0.at != $1.at ? $0.at > $1.at : $0.id < $1.id }
        let rest = entries.filter { !$0.pinned }
        return LibraryGroups(
            pinned: entries.filter(\.pinned),
            thisWeek: rest.filter { now - $0.at < week },
            older: rest.filter { now - $0.at >= week }
        )
    }
}
