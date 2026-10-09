// A bot as one zip (desktop #271, docs/bot-package.md, shared/bot-zip.ts,
// server/routes/bot-zip.ts, src/lib/bot-zip.ts, BotZipImport.tsx): Export
// as zip downloads the whole bot (identity, instructions, memory, docs,
// skills, plugins, settings, routines, webhooks; conversations and sharing
// on request; never a secret). Import from zip stages the file, previews
// what will be created, skipped or needs a step, then imports a new bot
// (never an overwrite). Routes in CLIENT_ALLOW; the companion sidecar has
// none.
import Foundation

public struct BotZipPreviewLine: Decodable, Hashable, Sendable {
    public var part: String
    /// English, never a secret; the desktop translates `key` when it can.
    public var detail: String
    public var key: String?
}

public struct BotZipPreview: Decodable, Equatable, Sendable {
    public var kind: String
    public var name: String
    public var importName: String
    public var appVersion: String?
    public var exportedAt: Double?
    public var hasConversations: Bool
    public var hasSharing: Bool
    public var created: [BotZipPreviewLine]
    public var skipped: [BotZipPreviewLine]
    public var needsAction: [BotZipPreviewLine]

    enum CodingKeys: String, CodingKey { case kind, name, importName, appVersion, exportedAt, hasConversations, hasSharing, created, skipped, needsAction }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? "zip"
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        importName = (try? c.decodeIfPresent(String.self, forKey: .importName)) ?? name
        appVersion = (try? c.decodeIfPresent(String.self, forKey: .appVersion)) ?? nil
        exportedAt = (try? c.decodeIfPresent(Double.self, forKey: .exportedAt)) ?? nil
        hasConversations = (try? c.decodeIfPresent(Bool.self, forKey: .hasConversations)) ?? false
        hasSharing = (try? c.decodeIfPresent(Bool.self, forKey: .hasSharing)) ?? false
        func lines(_ key: CodingKeys) -> [BotZipPreviewLine] {
            ((try? c.decodeIfPresent([Lossy<BotZipPreviewLine>].self, forKey: key)) ?? nil)?.compactMap(\.value) ?? []
        }
        created = lines(.created)
        skipped = lines(.skipped)
        needsAction = lines(.needsAction)
    }

    /// An older Sagax package file rather than a zip.
    public var isLegacy: Bool { kind == "legacy" }
}

public struct BotZipStaged: Decodable, Sendable {
    public var id: String
    public var preview: BotZipPreview

    public init(id: String, preview: BotZipPreview) {
        self.id = id
        self.preview = preview
    }
}

public struct BotZipImportResult: Decodable, Sendable {
    public var botId: String
    public var name: String
    public var warnings: [String]

    enum CodingKeys: String, CodingKey { case botId, name, warnings }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        botId = try c.decode(String.self, forKey: .botId)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        warnings = (try? c.decodeIfPresent([String].self, forKey: .warnings)) ?? []
    }
}

struct BotZipPreviewEnvelope: Decodable { var preview: BotZipPreview }

struct BotZipImportBody: Encodable {
    var name: String?
    var conversations: Bool
    var sharing: Bool
}

public enum BotZipRules {
    public static let fileExtension = ".sagaxbot.zip"
    /// The server stages at most 512 MB.
    public static let maximumBytes = 512 * 1024 * 1024
    /// A staged upload can take a while on a phone's connection.
    public static let uploadTimeout: TimeInterval = 900

    /// `botZipFilename`: `Atlas Bot` → `atlas-bot.sagaxbot.zip`.
    public static func filename(_ name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive], locale: nil).lowercased()
        var slug = folded.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        slug = slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        slug = String(slug.prefix(60))
        return (slug.isEmpty ? "bot" : slug) + fileExtension
    }

    /// A name for the copy: 1 to 100 characters, nil keeps the preview's.
    public static func importName(_ typed: String, preview: BotZipPreview) -> String? {
        let name = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != preview.importName else { return nil }
        return String(name.prefix(100))
    }
}

public extension CompanionClient {
    /// `GET /api/bots/:id/export.zip?conversations=1&sharing=1`, streamed to
    /// a temporary file named `<slug>.sagaxbot.zip`.
    func exportBotZip(botId: String, name: String, conversations: Bool, sharing: Bool) async throws -> URL {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var query: [URLQueryItem] = []
        if conversations { query.append(URLQueryItem(name: "conversations", value: "1")) }
        if sharing { query.append(URLQueryItem(name: "sharing", value: "1")) }
        var request = try makeRequest("GET", "/api/bots/\(botId)/export.zip", query: query)
        request.timeoutInterval = BotZipRules.uploadTimeout
        let (file, response) = try await performDownload(request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let data = (try? Data(contentsOf: file)) ?? Data()
            try? FileManager.default.removeItem(at: file)
            try Self.check(response, data)
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = folder.appendingPathComponent(BotZipRules.filename(name))
        try FileManager.default.moveItem(at: file, to: target)
        return target
    }

    /// `POST /api/bots/import/upload`: the raw bytes, not multipart. The
    /// server stages the file for this person for 30 minutes.
    func uploadBotZip(_ data: Data) async throws -> BotZipStaged {
        guard !data.isEmpty else { throw APIError.transport("The file is empty.") }
        guard data.count <= BotZipRules.maximumBytes else { throw APIError.transport("The file is larger than 512 MB.") }
        var request = try makeRequest("POST", "/api/bots/import/upload")
        request.timeoutInterval = BotZipRules.uploadTimeout
        request.setValue("application/zip", forHTTPHeaderField: "Content-Type")
        request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
        request.httpBody = data
        return try await send(request, as: BotZipStaged.self)
    }

    /// `POST /api/bots/import/:id/preview {name}`: the preview again, with
    /// the copy's name as it would land.
    func previewBotZip(id: String, name: String?) async throws -> BotZipPreview {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        return try await send(makeRequest("POST", "/api/bots/import/\(id)/preview", body: body), as: BotZipPreviewEnvelope.self).preview
    }

    /// `POST /api/bots/import/:id {name, conversations, sharing}`.
    func importBotZip(id: String, name: String?, conversations: Bool, sharing: Bool) async throws -> BotZipImportResult {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        let body = BotZipImportBody(name: name, conversations: conversations, sharing: sharing)
        var request = try makeRequest("POST", "/api/bots/import/\(id)", encodedBody: body)
        request.timeoutInterval = BotZipRules.uploadTimeout
        return try await send(request, as: BotZipImportResult.self)
    }

    /// `DELETE /api/bots/import/:id`: a staged file the person let go.
    func discardBotZip(id: String) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest("DELETE", "/api/bots/import/\(id)"))
    }
}
