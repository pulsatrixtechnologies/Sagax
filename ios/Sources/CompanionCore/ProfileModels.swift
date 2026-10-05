import Foundation

// Wire models for the bot profile (parity screens 03 to 10) and its routine
// screens (05, 06). Each type mirrors one server route
// (server/routes/bot-library.ts, server/index.ts `PATCH /api/bots/:id`);
// the payloads are listed in docs/ios-companion.md, "Visual parity routes".

// MARK: - PATCH /api/bots/:id (profile edits)

/// One profile edit through the generic bot route. Only the fields set are
/// sent. A member may change the look and the picture framing of any bot;
/// the name, instructions, notifications and picture belong to the owner or
/// an admin (`server/request-auth.ts` `memberBotFieldViolation`).
public struct BotProfileEdit: Encodable, Equatable, Sendable {
    public enum AvatarURL: Equatable, Sendable {
        case set(String)
        case clear
    }

    public var color: String?
    public var mascotLook: MascotLook?
    public var mascotSkin: MascotSkin?
    public var avatarCrop: AvatarCrop?
    /// The server clamps zoom to 1...3 and focus to 0...1.
    public var avatarZoom: Double?
    public var avatarFocusX: Double?
    public var avatarFocusY: Double?
    public var avatarUrl: AvatarURL?
    public var notifications: Bool?
    public var soul: String?
    /// Let the bot send spoken notes (`voiceNotes`).
    public var voiceNotes: Bool?

    public init(
        color: String? = nil,
        mascotLook: MascotLook? = nil,
        mascotSkin: MascotSkin? = nil,
        avatarCrop: AvatarCrop? = nil,
        avatarZoom: Double? = nil,
        avatarFocusX: Double? = nil,
        avatarFocusY: Double? = nil,
        avatarUrl: AvatarURL? = nil,
        notifications: Bool? = nil,
        soul: String? = nil,
        voiceNotes: Bool? = nil
    ) {
        self.color = color
        self.mascotLook = mascotLook
        self.mascotSkin = mascotSkin
        self.avatarCrop = avatarCrop
        self.avatarZoom = avatarZoom
        self.avatarFocusX = avatarFocusX
        self.avatarFocusY = avatarFocusY
        self.avatarUrl = avatarUrl
        self.notifications = notifications
        self.soul = soul
        self.voiceNotes = voiceNotes
    }

    /// The desktop's "Reset to default" (`BotProfileAvatarCard.tsx`): the owl
    /// in green, no skin, no picture.
    public static let resetLook = BotProfileEdit(
        color: "green", mascotLook: .owl, mascotSkin: MascotSkin.none, avatarCrop: .mascot, avatarUrl: .clear
    )

    public var isEmpty: Bool {
        color == nil && mascotLook == nil && mascotSkin == nil && avatarCrop == nil && avatarZoom == nil
            && avatarFocusX == nil && avatarFocusY == nil && avatarUrl == nil && notifications == nil && soul == nil && voiceNotes == nil
    }

    private enum CodingKeys: String, CodingKey {
        case color, mascotLook, mascotSkin, avatarCrop, avatarZoom, avatarFocusX, avatarFocusY, avatarUrl, notifications, soul, voiceNotes
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encodeIfPresent(color, forKey: .color)
        try values.encodeIfPresent(mascotLook, forKey: .mascotLook)
        try values.encodeIfPresent(mascotSkin, forKey: .mascotSkin)
        try values.encodeIfPresent(avatarCrop, forKey: .avatarCrop)
        try values.encodeIfPresent(avatarZoom, forKey: .avatarZoom)
        try values.encodeIfPresent(avatarFocusX, forKey: .avatarFocusX)
        try values.encodeIfPresent(avatarFocusY, forKey: .avatarFocusY)
        switch avatarUrl {
        case let .set(path): try values.encode(path, forKey: .avatarUrl)
        case .clear: try values.encodeNil(forKey: .avatarUrl)
        case nil: break
        }
        try values.encodeIfPresent(notifications, forKey: .notifications)
        try values.encodeIfPresent(soul, forKey: .soul)
        try values.encodeIfPresent(voiceNotes, forKey: .voiceNotes)
    }
}

// MARK: - GET /api/bots/:id/links

/// One URL found in the bot's messages: newest first, one per URL.
public struct BotLink: Decodable, Hashable, Identifiable, Sendable {
    public var url: String
    public var domain: String
    public var title: String?
    public var messageId: String?
    public var threadId: String?
    public var at: Double

    public var id: String { url }

    private enum CodingKeys: String, CodingKey { case url, domain, title, messageId, threadId, at }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        url = try values.decode(String.self, forKey: .url)
        let host = URL(string: url)?.host
        domain = (try values.decodeIfPresent(String.self, forKey: .domain)).flatMap { $0.isEmpty ? nil : $0 } ?? host ?? url
        title = try values.decodeIfPresent(String.self, forKey: .title)
        messageId = try values.decodeIfPresent(String.self, forKey: .messageId)
        threadId = try values.decodeIfPresent(String.self, forKey: .threadId)
        at = try values.decodeIfPresent(Double.self, forKey: .at) ?? 0
    }

    /// Only web addresses open in the in-app browser.
    public var webURL: URL? {
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(),
              scheme == "https" || scheme == "http", parsed.host != nil
        else { return nil }
        return parsed
    }
}

/// A page of a list: the items, the cursor for the next page (nil at the
/// end) and the total count.
public struct LibraryPage<Item: Sendable & Hashable>: Sendable, Equatable {
    public var items: [Item]
    public var nextCursor: String?
    public var total: Int

    public init(items: [Item], nextCursor: String?, total: Int) {
        self.items = items
        self.nextCursor = nextCursor
        self.total = total
    }

    public var hasMore: Bool { nextCursor != nil }

    /// This page appended to an earlier one, without repeating an item.
    public func appending(_ next: LibraryPage<Item>) -> LibraryPage<Item> {
        var seen = Set(items)
        let added = next.items.filter { seen.insert($0).inserted }
        return LibraryPage(items: items + added, nextCursor: next.nextCursor, total: next.total)
    }
}

struct BotLinksResponse: Decodable {
    var links: [BotLink]
    var nextCursor: String?
    var total: Int?
}

// MARK: - GET /api/bots/:id/files

public enum BotFileKind: String, Codable, Sendable {
    case media, file
}

/// One file of the bot's threads (Media and Files tabs). `url` and
/// `previewUrl` are the existing `/api/threads/:id/files/:fileId` routes.
public struct BotLibraryFile: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var threadId: String
    public var messageId: String?
    public var name: String
    public var mime: String?
    public var size: Int?
    public var available: Bool
    public var at: Double
    public var kind: BotFileKind
    public var url: String
    public var previewUrl: String?

    private enum CodingKeys: String, CodingKey { case id, threadId, messageId, name, mime, size, available, at, kind, url, previewUrl }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        threadId = try values.decode(String.self, forKey: .threadId)
        messageId = try values.decodeIfPresent(String.self, forKey: .messageId)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? ""
        mime = try values.decodeIfPresent(String.self, forKey: .mime)
        size = try values.decodeIfPresent(Int.self, forKey: .size)
        available = try values.decodeIfPresent(Bool.self, forKey: .available) ?? true
        at = try values.decodeIfPresent(Double.self, forKey: .at) ?? 0
        let rawKind = try values.decodeIfPresent(String.self, forKey: .kind)
        kind = rawKind.flatMap(BotFileKind.init(rawValue:)) ?? ((mime ?? "").hasPrefix("image/") ? .media : .file)
        url = try values.decodeIfPresent(String.self, forKey: .url) ?? "/api/threads/\(threadId)/files/\(id)"
        previewUrl = try values.decodeIfPresent(String.self, forKey: .previewUrl)
    }

    /// A safe name for the downloaded copy (Quick Look shows it).
    public var localFileName: String {
        let base = (name as NSString).lastPathComponent
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return base.isEmpty ? "file-\(id)" : base
    }
}

struct BotFilesResponse: Decodable {
    var files: [BotLibraryFile]
    var nextCursor: String?
    var total: Int?
}

// MARK: - POST /api/bots/:id/export

/// The bot as a single-bot team package (v2): no chats, no header values or
/// keys. `document` is kept as the server's JSON bytes so nothing is lost.
public struct BotExport: Sendable, Equatable {
    public var document: Data
    public var filename: String?
    public var redacted: Int
    public var skipped: Int

    /// What the share sheet carries: `<Bot name>.json`.
    public static func shareFileName(botName: String) -> String {
        let cleaned = botName.unicodeScalars
            .map { CharacterSet(charactersIn: "/\\:?%*|\"<>").contains($0) || CharacterSet.controlCharacters.contains($0) ? "-" : String($0) }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        return "\(cleaned.isEmpty ? "Bot" : String(cleaned.prefix(80))).json"
    }

    static func decode(_ data: Data) throws -> BotExport {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let document = object["document"], JSONSerialization.isValidJSONObject(document)
        else { throw APIError.transport("The server did not return a bot package.") }
        let bytes = try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
        func count(_ value: Any?) -> Int {
            if let array = value as? [Any] { return array.count }
            if let number = value as? Int { return number }
            return 0
        }
        return BotExport(
            document: bytes,
            filename: object["filename"] as? String,
            redacted: count(object["redacted"]),
            skipped: count(object["skipped"])
        )
    }
}

// MARK: - Routine presentation

public extension Routine {
    /// "Next run" on the routine screen: nil when nothing is scheduled.
    /// `dueNow` when the time has come (or passed and the run is pending).
    enum NextRun: Equatable, Sendable {
        case none
        case dueNow
        case at(Date)
    }

    func nextRun(now: Date = Date()) -> NextRun {
        guard enabled, let next = nextRunAt else { return .none }
        let date = Date(timeIntervalSince1970: next / 1_000)
        return date <= now ? .dueNow : .at(date)
    }
}

public extension RoutineSchedule {
    /// The parts of a human schedule line ("Every Monday at 7:00 AM") the app
    /// localizes: which days, and the time of day.
    enum DayPattern: Equatable, Sendable {
        case everyDay
        case weekdays
        case weekends
        /// One or more days, 0 = Sunday, in order.
        case days([Int])
        case none
    }

    var dayPattern: DayPattern {
        let days = Array(Set((weekdays ?? []).filter { (0..<7).contains($0) })).sorted()
        switch days {
        case []: return .none
        case [0, 1, 2, 3, 4, 5, 6]: return .everyDay
        case [1, 2, 3, 4, 5]: return .weekdays
        case [0, 6]: return .weekends
        default: return .days(days)
        }
    }

    /// `daily.time` ("07:00") as hour and minute.
    var timeOfDay: (hour: Int, minute: Int)? {
        guard let time else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
        return (parts[0], parts[1])
    }
}
