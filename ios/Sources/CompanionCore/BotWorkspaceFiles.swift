// Rules (RULES.md) and documents (docs/*.md) of a bot's workspace, the files
// the desktop's persona editor edits in the markdown editor (#269,
// src/lib/workspace-files.ts, server/routes/bot-workspace.ts). Open to the
// bot's owner like the soul; CLIENT_ALLOW, no route on the companion sidecar.
import Foundation

public struct BotWorkspaceEntry: Decodable, Hashable, Identifiable, Sendable {
    public var path: String
    public var kind: String
    public var bytes: Int?
    public var modifiedAt: Double?
    public var editable: Bool?
    public var markdown: Bool?
    public var id: String { path }

    public var name: String { path.split(separator: "/").last.map(String.init) ?? path }
    /// What /workspace/file serves: RULES.md or docs/<name>.md.
    public var isDoc: Bool { BotWorkspaceFiles.isDoc(path) }
}

public struct BotWorkspaceListing: Decodable, Sendable {
    public struct Budget: Decodable, Sendable { public var maxLines: Int?; public var maxBytes: Int? }
    public struct Budgets: Decodable, Sendable { public var rules: Budget? }

    public var entries: [BotWorkspaceEntry]
    public var rulesTemplate: String?
    public var budgets: Budgets?

    enum CodingKeys: String, CodingKey { case entries, rulesTemplate, budgets }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = (try? c.decodeIfPresent([Lossy<BotWorkspaceEntry>].self, forKey: .entries))??.compactMap(\.value) ?? []
        rulesTemplate = (try? c.decodeIfPresent(String.self, forKey: .rulesTemplate)) ?? nil
        budgets = (try? c.decodeIfPresent(Budgets.self, forKey: .budgets)) ?? nil
    }

    /// The documents, by name.
    public var docs: [BotWorkspaceEntry] {
        entries.filter { $0.kind == "file" && BotWorkspaceFiles.isDoc($0.path) && $0.path != BotWorkspaceFiles.rulesPath }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

public enum BotWorkspaceFiles {
    public static let rulesPath = "RULES.md"
    public static let maxRulesLines = 60
    public static let maxRulesBytes = 8_000

    public static func isDoc(_ path: String) -> Bool {
        path == rulesPath || path.range(of: #"^docs/[^/]+\.md$"#, options: .regularExpression) != nil
    }

    /// RULES.md as it loads: comments removed, blank runs folded, trimmed.
    public static func effectiveRules(_ raw: String) -> String {
        var text = raw.replacingOccurrences(of: #"<!--[\s\S]*?(?:-->|$)"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Lines and bytes of what loads each turn, against the budget.
    public static func rulesCount(_ raw: String, maxLines: Int = maxRulesLines, maxBytes: Int = maxRulesBytes) -> (lines: Int, bytes: Int, over: Bool) {
        let text = effectiveRules(raw)
        let lines = text.isEmpty ? 0 : text.components(separatedBy: "\n").count
        let bytes = text.utf8.count
        return (lines, bytes, lines > maxLines || bytes > maxBytes)
    }

    /// `docPathFromName`: docs/<stem>.md from what the person typed; nil
    /// when nothing usable is left.
    public static func docPath(fromName input: String) -> String? {
        var stem = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if stem.hasPrefix("docs/") { stem.removeFirst(5) }
        if stem.lowercased().hasSuffix(".md") { stem.removeLast(3) }
        stem = stem.replacingOccurrences(of: #"[^\p{L}\p{N}_ .-]+"#, with: "-", options: .regularExpression)
        stem = stem.replacingOccurrences(of: #"^[^\p{L}\p{N}_]+"#, with: "", options: .regularExpression)
        stem = stem.trimmingCharacters(in: .whitespaces)
        guard !stem.isEmpty, stem.count <= 190 else { return nil }
        return "docs/\(stem).md"
    }
}

struct WorkspaceRenameBody: Encodable { var from: String; var to: String }

public extension CompanionClient {
    /// `GET /api/bots/:id/workspace`.
    func botWorkspace(botId: String) async throws -> BotWorkspaceListing {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/workspace"), as: BotWorkspaceListing.self)
    }

    /// `GET /api/bots/:id/workspace/file?path=`.
    func workspaceDoc(botId: String, path: String) async throws -> MemoryDoc {
        try await send(workspaceFileRequest("GET", botId: botId, path: path), as: MemoryDoc.self)
    }

    /// `PUT /api/bots/:id/workspace/file {path, text, expectedHash}`; a 409
    /// carries the file as it is now.
    func saveWorkspaceDoc(botId: String, path: String, text: String, expectedHash: String?) async throws -> MemorySaveResult {
        guard Self.validRouteID(botId), BotWorkspaceFiles.isDoc(path) else { throw APIError.badURL }
        let request = try makeRequest("PUT", "/api/bots/\(botId)/workspace/file", encodedBody: MemorySaveBody(path: path, text: text, expectedHash: expectedHash))
        let (data, response) = try await perform(request)
        if (response as? HTTPURLResponse)?.statusCode == 409,
           let conflict = try? JSONDecoder().decode(MemoryConflictBody.self, from: data) {
            return .conflict(current: conflict.current, currentHash: conflict.currentHash)
        }
        try Self.check(response, data)
        return .saved(try JSONDecoder().decode(MemoryDoc.self, from: data), nil)
    }

    /// `DELETE /api/bots/:id/workspace/file?path=`.
    func deleteWorkspaceDoc(botId: String, path: String) async throws {
        try await send(workspaceFileRequest("DELETE", botId: botId, path: path))
    }

    /// `POST /api/bots/:id/workspace/docs/rename {from, to}`.
    func renameWorkspaceDoc(botId: String, from: String, to: String) async throws {
        guard Self.validRouteID(botId), BotWorkspaceFiles.isDoc(from), BotWorkspaceFiles.isDoc(to) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/workspace/docs/rename", encodedBody: WorkspaceRenameBody(from: from, to: to)))
    }

    func workspaceFileRequest(_ method: String, botId: String, path: String) throws -> URLRequest {
        guard Self.validRouteID(botId), BotWorkspaceFiles.isDoc(path) else { throw APIError.badURL }
        return try makeRequest(method, "/api/bots/\(botId)/workspace/file", query: [URLQueryItem(name: "path", value: path)])
    }
}
