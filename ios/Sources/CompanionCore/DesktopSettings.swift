// iPad I5: the desktop's Settings and Plugins modals, the parts that are
// logic rather than drawing: which sections a pairing lists (the remote
// client's rule, spec 2026-10-02 "Rule for the iPad"), the search over them
// (`sectionMatches` in src/components/SettingsModal.tsx), the slice of
// `GET /api/config` the sections read, and the `PUT /api/config` patches
// their controls send.
import Foundation

/// A Settings section, in the desktop's nav order (`SECTIONS`,
/// src/components/SettingsModal.tsx), as the references draw it.
public enum DesktopSettingsSection: String, CaseIterable, Hashable, Sendable {
    case general, organization, appearance, experimental, connections, decisionModel, engines, companion,
         computer, usage, people, mail, activity, backups

    /// Search words beside the label (the desktop's `keywords`).
    public var keywords: [String] {
        switch self {
        case .general:
            ["profile", "name", "email", "about me", "about", "effort", "new bots", "reasoning", "threads", "parallel",
             "concurrency", "routines", "conversation", "group", "turns", "language"]
        case .organization:
            ["company", "organization", "organisation", "sign in", "managed", "server", "servers", "connect", "pair", "switch", "computer"]
        case .appearance:
            ["skin", "theme", "appearance", "threads", "show threads", "sidebar", "density", "compact", "comfortable",
             "display", "notifications", "sound", "sounds", "mascot", "owl", "app icon", "icon"]
        case .experimental: ["early", "preview", "learn", "skill", "authoring", "browser", "templates"]
        case .connections:
            ["keys", "api", "api key", "api keys", "connections", "composio", "xai", "mistral", "router", "openrouter",
             "openai", "anthropic", "provider"]
        case .decisionModel: ["decision", "jev", "typesafe", "routing", "auto", "rooms", "who answers"]
        case .engines: ["models", "model providers", "engines", "claude", "codex", "grok", "providers", "sign in", "subscription"]
        case .companion: ["companion", "device", "phone", "ipad", "pair", "pairing", "mobile", "remote"]
        case .computer: ["computer", "local vm", "vm", "virtual", "desktop", "cloud computers", "vps"]
        case .usage: ["tokens", "cost", "billing", "spend", "limit", "history"]
        case .people: ["people", "users", "invite", "members", "admins", "access"]
        case .mail: ["email", "mail", "smtp", "sender", "invitations", "sign-in codes"]
        case .activity: ["activity", "audit", "log", "history", "who changed", "admin"]
        case .backups: ["export", "import", "restore", "full backup", "password", "recovery"]
        }
    }

    /// `sectionMatches`: an empty query matches; otherwise the label or a
    /// keyword contains it, ignoring case.
    public func matches(_ query: String, label: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return true }
        return ([label] + keywords).contains { $0.lowercased().contains(q) }
    }

    /// The sections this pairing lists, in order. The rule is the desktop
    /// remote client's: paired through a sidecar it shows Organization (its
    /// connection to the computer), Appearance and Pair devices; a server's
    /// client session the same (Organization is the person's organization
    /// on an organization server); an admin session the served renderer's
    /// list. A section the pairing cannot use is left out, never drawn
    /// disabled.
    public static func available(for gate: SurfaceGate) -> [DesktopSettingsSection] {
        switch gate.scope {
        case .sidecar, .serverClient:
            return [.organization, .appearance, .companion]
        case .serverAdmin:
            // Email, People and Activity are the served page's too; the
            // iPad does not draw them yet, so it leaves them out.
            return [
                .general, .organization, .appearance, .experimental, .connections, .decisionModel, .engines,
                .companion, .computer, .usage, .backups,
            ]
        }
    }

    /// The section to show for a request: the requested one when the pairing
    /// lists it and the search keeps it, else the first one kept.
    public static func resolve(
        _ requested: DesktopSettingsSection, available: [DesktopSettingsSection], visible: [DesktopSettingsSection]
    ) -> DesktopSettingsSection? {
        if visible.contains(requested) { return requested }
        if visible.isEmpty { return available.contains(requested) ? requested : available.first }
        return visible.first
    }
}

/// The Plugins modal's two tabs (`PluginsPanel.tsx`).
public enum DesktopPluginsTab: String, CaseIterable, Hashable, Sendable {
    case apps, mcp

    /// The tabs this pairing may open: Connected apps and the MCP list both
    /// need the connector routes (`.connectedApps`, `.mcpServers`), which a
    /// server's client session does not reach.
    public static func available(for gate: SurfaceGate) -> [DesktopPluginsTab] {
        var tabs: [DesktopPluginsTab] = []
        if gate.allows(.connectedApps) { tabs.append(.apps) }
        if gate.allows(.mcpServers) { tabs.append(.mcp) }
        return tabs
    }
}

// MARK: - GET /api/config, the sections' slice

/// What the Settings sections read from `GET /api/config` (shared/wire.ts
/// `ConfigStatus`). Keys are never part of it: providers say `configured`.
public struct DesktopSettingsConfig: Decodable, Equatable, Sendable {
    public struct Flag: Decodable, Equatable, Sendable {
        public var configured: Bool?
    }

    public struct Profile: Decodable, Equatable, Sendable {
        public var name: String?
        public var email: String?
        public var aboutMe: String?
    }

    public struct Features: Decodable, Equatable, Sendable {
        public var skillAuthoring: Bool?
        public var routinesInConversation: Bool?
        public var connectedApps: Bool?
        public var templates: Bool?
        public var browser: Bool?
        public var claudeUserMcp: Bool?
    }

    public struct Rooms: Decodable, Equatable, Sendable { public var turnTimeoutMinutes: Int? }
    public struct Threads: Decodable, Equatable, Sendable {
        public var maxConcurrentPerBot: Int?
        public var eventLogRetentionDays: Int?
    }
    public struct Recovery: Decodable, Equatable, Sendable { public var enabled: Bool? }
    public struct Budgets: Decodable, Equatable, Sendable { public var monthlyUsd: Double? }
    public struct NewBots: Decodable, Equatable, Sendable { public var effort: String? }
    public struct Decider: Decodable, Equatable, Sendable {
        public struct Jobs: Decodable, Equatable, Sendable { public var roomRouting: Bool? }
        public var configured: Bool?
        public var enabled: Bool?
        public var jobs: Jobs?
    }
    public struct BrowserEngine: Decodable, Equatable, Sendable {
        public var kind: String?
        public var installable: Bool?
    }
    public struct LocalVm: Decodable, Equatable, Sendable { public var mode: String? }
    public struct Composio: Decodable, Equatable, Sendable {
        public var configured: Bool?
        public var mode: String?
    }

    public var profile: Profile?
    public var language: String?
    public var features: Features?
    public var rooms: Rooms?
    public var threads: Threads?
    public var budgets: Budgets?
    public var automaticRecovery: Recovery?
    public var newBots: NewBots?
    public var decider: Decider?
    public var browserEngine: BrowserEngine?
    public var localVm: LocalVm?
    public var composio: Composio?
    public var openai, anthropic, xai, openrouter, mistral, openaiCompat, vps: Flag?

    public init() {}

    /// A provider key is on file (`configured`), by the config's section name.
    public func keyConfigured(_ provider: DesktopAPIKeyProvider) -> Bool {
        switch provider {
        case .openai: openai?.configured == true
        case .anthropic: anthropic?.configured == true
        case .xai: xai?.configured == true
        case .openrouter: openrouter?.configured == true
        case .mistral: mistral?.configured == true
        case .openaiCompat: openaiCompat?.configured == true
        case .composio: composio?.configured == true
        case .decider: decider?.configured == true
        }
    }
}

/// The write-only keys the API keys and Decision model sections take.
public enum DesktopAPIKeyProvider: String, CaseIterable, Hashable, Sendable {
    case openai, anthropic, xai, openrouter, mistral, openaiCompat, composio, decider

    /// The placeholder the desktop's field shows (`ApiKeys.tsx`).
    public var placeholder: String {
        switch self {
        case .openai: "sk-..."
        case .anthropic: "sk-ant-..."
        case .xai: "xai-..."
        case .openrouter: "sk-or-v1-..."
        case .mistral: "Paste a Mistral API key"
        case .openaiCompat: "API key"
        case .composio: "ak_..."
        case .decider: "Paste your TypeSafe API key"
        }
    }
}

// MARK: - PUT /api/config

/// One Settings change, as the `PUT /api/config` body the desktop sends for
/// it (the server merges a partial body: `parseConfigPatch`).
public enum DesktopConfigChange: Equatable, Sendable {
    case profileName(String)
    case profileEmail(String)
    case aboutMe(String)
    case newBotEffort(String?)
    case feature(String, Bool)
    case roomTurnMinutes(Int)
    case parallelThreads(Int)
    case monthlyBudget(Double)
    /// Event log cleanup: days after which a finished thread's event log
    /// is deleted, or nil for off (`PATCH {threads: {eventLogRetentionDays}}`).
    case eventLogRetention(Int?)
    /// Automatic recovery off. Turning it on needs a backup model, chosen
    /// on the computer.
    case automaticRecoveryOff
    case deciderEnabled(Bool)
    case deciderRoomRouting(Bool)
    /// A write-only key; an empty string clears it.
    case apiKey(DesktopAPIKeyProvider, String)

    /// The features the Experimental and General switches may set.
    public static let switchableFeatures: Set<String> = [
        "skillAuthoring", "routinesInConversation", "connectedApps", "templates", "browser", "claudeUserMcp",
    ]

    /// The JSON body, or nil for a change that is out of range.
    public var body: [String: Any]? {
        switch self {
        case let .profileName(name):
            return ["profile": ["name": String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))]]
        case let .profileEmail(email):
            return ["profile": ["email": String(email.trimmingCharacters(in: .whitespacesAndNewlines).prefix(320))]]
        case let .aboutMe(text):
            return ["profile": ["aboutMe": String(text.prefix(4_000))]]
        case let .newBotEffort(level):
            if let level, !DesktopEffort.levels.contains(level) { return nil }
            return ["newBots": ["effort": level.map { $0 as Any } ?? NSNull()]]
        case let .feature(name, on):
            guard Self.switchableFeatures.contains(name) else { return nil }
            return ["features": [name: on]]
        case let .roomTurnMinutes(minutes):
            guard (1...1_440).contains(minutes) else { return nil }
            return ["rooms": ["turnTimeoutMinutes": minutes]]
        case let .parallelThreads(count):
            guard (1...10).contains(count) else { return nil }
            return ["threads": ["maxConcurrentPerBot": count]]
        case let .monthlyBudget(dollars):
            guard dollars >= 0, dollars <= 1_000_000, dollars.isFinite else { return nil }
            return ["budgets": ["monthlyUsd": dollars]]
        case let .eventLogRetention(days):
            if let days, !(1...3_650).contains(days) { return nil }
            return ["threads": ["eventLogRetentionDays": days.map { $0 as Any } ?? NSNull()]]
        case .automaticRecoveryOff:
            return ["automaticRecovery": ["enabled": false]]
        case let .deciderEnabled(on):
            return ["decider": ["enabled": on]]
        case let .deciderRoomRouting(on):
            return ["decider": ["jobs": ["roomRouting": on]]]
        case let .apiKey(provider, key):
            let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count <= 4_096 else { return nil }
            return [provider.rawValue: ["key": trimmed]]
        }
    }
}

/// The effort levels of "Effort for new bots" (`EFFORT_LEVELS`).
public enum DesktopEffort {
    public static let levels = ["none", "low", "medium", "high", "xhigh", "max"]
}

/// Group turns' and Parallel threads' summaries (`settings.card.roomTurns`,
/// `settings.card.threads`), and the spend limit's ("$0 of $100.00 (0%)").
public enum DesktopSettingsSummary {
    public static func spend(_ spent: Double, of limit: Double?) -> String {
        guard let limit, limit > 0 else { return money(spent) }
        let percent = Int((spent / limit * 100).rounded())
        return "\(money(spent)) of \(String(format: "$%.2f", limit)) (\(percent)%)"
    }

    /// "$0" for nothing spent, cents otherwise (the desktop's `formatUsd`).
    public static func money(_ value: Double) -> String {
        value == 0 ? "$0" : String(format: "$%.2f", value)
    }
}

public extension CompanionClient {
    /// `GET /api/config`, the Settings sections' slice.
    func desktopSettingsConfig() async throws -> DesktopSettingsConfig {
        try await send(makeRequest("GET", "/api/config"), as: DesktopSettingsConfig.self)
    }

    /// `PUT /api/config` with one change; the answer is the new config.
    func updateDesktopSettings(_ change: DesktopConfigChange) async throws -> DesktopSettingsConfig {
        try await send(desktopSettingsRequest(change), as: DesktopSettingsConfig.self)
    }

    func desktopSettingsRequest(_ change: DesktopConfigChange) throws -> URLRequest {
        guard let body = change.body else { throw APIError.badURL }
        // The desktop PATCHes these two; the server merges either way.
        let method: String
        switch change {
        case .newBotEffort, .eventLogRetention: method = "PATCH"
        default: method = "PUT"
        }
        return try makeRequest(method, "/api/config", body: body)
    }

    /// Settings > Backups > Export full backup: `POST
    /// /api/workspace-backup/export` with the password, then the archive from
    /// `GET /api/workspace-backup/download/:id`, saved under the server's file
    /// name in the temporary directory for the share sheet. The password is
    /// sent once and kept nowhere.
    func exportWorkspaceBackup(password: String) async throws -> URL {
        let started = try await send(exportWorkspaceBackupRequest(password: password), as: WorkspaceBackupExport.self)
        let (file, response) = try await performDownload(workspaceBackupDownloadRequest(id: started.id))
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.status(code: http.statusCode, message: nil)
        }
        let name = WorkspaceBackupExport.safeFilename(started.filename)
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: file, to: destination)
        return destination
    }

    func exportWorkspaceBackupRequest(password: String) throws -> URLRequest {
        guard password.count >= 12, password.count <= 1_024 else { throw APIError.badURL }
        return try makeRequest("POST", "/api/workspace-backup/export", body: ["password": password])
    }

    func workspaceBackupDownloadRequest(id: String) throws -> URLRequest {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        return try makeRequest("GET", "/api/workspace-backup/download/\(id)")
    }
}

/// `POST /api/workspace-backup/export`'s answer.
public struct WorkspaceBackupExport: Decodable, Equatable, Sendable {
    public var id: String
    public var filename: String?

    /// The server's name without a path, or a dated default.
    public static func safeFilename(_ raw: String?) -> String {
        let name = (raw ?? "").components(separatedBy: CharacterSet(charactersIn: "/\\")).last?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty || name.hasPrefix(".") ? "sagax-backup.ombbackup" : name
    }
}

// MARK: - Model providers (EngineLibrary.tsx)

/// One model provider card of Settings > Model providers, read from
/// `GET /api/instances` (no CLI paths or commands are kept).
public struct DesktopEngine: Decodable, Equatable, Identifiable, Sendable {
    public struct Snapshot: Decodable, Equatable, Sendable {
        public struct Account: Decodable, Equatable, Sendable { public var email: String? }
        public var state: String
        public var version: String?
        public var authenticated: Bool?
        public var account: Account?
    }

    public var instanceId: String
    public var driverKind: String
    public var displayName: String?
    public var access: String?
    public var snapshot: Snapshot

    public var id: String { instanceId }
    public var name: String { displayName ?? instanceId }

    /// `engineReady`: available, and signed in unless it is a custom one.
    public var ready: Bool {
        snapshot.state == "available" && (access == "custom" || snapshot.authenticated != false)
    }

    private static let providers: [String: String] = [
        "claudeAgent": "Anthropic", "codex": "OpenAI", "grok": "xAI", "grokAgent": "xAI",
        "kimiAgent": "Moonshot AI", "droidAgent": "Factory", "cursorAgent": "Cursor",
        "antigravityAgent": "Google", "opencodeGo": "OpenCode", "qwenAgent": "Qwen",
        "hermesAgent": "Nous Research", "piAgent": "pi.dev", "mistral": "Mistral AI",
    ]

    /// The card's second line: the signed-in address, "custom" for a
    /// bring-your-own engine (nil: the caller says it in its language), or
    /// the provider's name.
    public var providerLine: String? {
        if snapshot.authenticated == true, let email = snapshot.account?.email, !email.isEmpty { return email }
        if access == "custom" { return nil }
        return Self.providers[driverKind] ?? driverKind
    }

    /// The version number alone ("2.1.232" from "2.1.232 (Claude Code)").
    public var versionNumber: String? {
        guard let raw = snapshot.version,
              let range = raw.range(of: #"\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?"#, options: .regularExpression)
        else { return nil }
        return String(raw[range])
    }

    /// The key that sets this provider up from Settings > API keys, when
    /// it is one of the key providers.
    public var apiKeyProvider: DesktopAPIKeyProvider? {
        switch instanceId {
        case "openai": .openai
        case "claudeApi": .anthropic
        case "xaiApi": .xai
        case "openrouter": .openrouter
        case "mistral": .mistral
        case "openaiCompat": .openaiCompat
        default: nil
        }
    }
}

public extension CompanionClient {
    /// `GET /api/instances` as Settings > Model providers reads it.
    func desktopEngines() async throws -> [DesktopEngine] {
        struct List: Decodable { var instances: [DesktopEngine] }
        return try await send(makeRequest("GET", "/api/instances"), as: List.self).instances
    }
}

// MARK: - Pair devices (ServerPairingCard.tsx)

/// A device holding a session on the server (`GET /api/auth/sessions`).
public struct ServerSessionDevice: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var label: String
    public var scopes: [String]
    public var lastSeenAt: Double
    public var email: String?

    public var fullAccess: Bool { scopes.contains("admin") }
}

public struct ServerSessionList: Decodable, Equatable, Sendable {
    public var sessions: [ServerSessionDevice]
    /// The session this request came with (this iPad).
    public var current: String?
}

/// A one-time pairing code (`POST /api/auth/pairing`).
public struct ServerPairingOffer: Decodable, Equatable, Sendable {
    public var id: String
    public var code: String
    /// Milliseconds since 1970.
    public var expiresAt: Double
    public var url: String?
    public var hint: String?

    public func minutesLeft(now: Date = Date()) -> Int {
        max(0, Int(((expiresAt - now.timeIntervalSince1970 * 1000) / 60_000).rounded(.up)))
    }

    public func expired(now: Date = Date()) -> Bool { expiresAt <= now.timeIntervalSince1970 * 1000 }
}

/// "seen just now / 13 min ago / 2 h ago / 3 d ago" (`lastSeen`).
public enum LastSeen: Equatable, Sendable {
    case justNow, minutes(Int), hours(Int), days(Int)

    public init(lastSeenAt: Double, now: Date = Date()) {
        let minutes = max(0, Int(((now.timeIntervalSince1970 * 1000 - lastSeenAt) / 60_000).rounded(.down)))
        if minutes < 1 { self = .justNow }
        else if minutes < 60 { self = .minutes(minutes) }
        else if minutes < 1_440 { self = .hours(Int((Double(minutes) / 60).rounded())) }
        else { self = .days(Int((Double(minutes) / 1_440).rounded())) }
    }
}

public extension CompanionClient {
    func pairedDevices() async throws -> ServerSessionList {
        try await send(makeRequest("GET", "/api/auth/sessions"), as: ServerSessionList.self)
    }

    /// Full access pairs with admin and client scopes; otherwise chat and
    /// approvals only.
    func createPairingCode(fullAccess: Bool) async throws -> ServerPairingOffer {
        try await send(createPairingCodeRequest(fullAccess: fullAccess), as: ServerPairingOffer.self)
    }

    func signOutDevice(id: String) async throws {
        let (data, response) = try await perform(signOutDeviceRequest(id: id))
        try Self.check(response, data)
    }

    func createPairingCodeRequest(fullAccess: Bool) throws -> URLRequest {
        try makeRequest("POST", "/api/auth/pairing", body: ["scopes": fullAccess ? ["admin", "client"] : ["client"]])
    }

    func signOutDeviceRequest(id: String) throws -> URLRequest {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/auth/sessions/\(id)")
    }
}

// MARK: - Local VM (LocalComputerSection.tsx)

/// `GET /api/local-computer`: the shared Local VM's state, as Settings >
/// Local VM reads it (observation only: reading never provisions).
public struct LocalComputerStatus: Decodable, Equatable, Sendable {
    public var ready: Bool
    /// The container runtime found ("podman", "docker"), if any.
    public var runtime: String?
    public var daemonUp: Bool
    public var image: Bool
    public var container: String?
    public var imageMatches: Bool
    public var managed: Bool
    public var network: String?
    public var security: String?
    public var persistence: String?
    public var problem: String?

    private enum CodingKeys: String, CodingKey {
        case ready, runtime, daemonUp, image, container, imageMatches, managed, network, security, persistence, problem
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ready = (try? c.decode(Bool.self, forKey: .ready)) ?? false
        runtime = (try? c.decodeIfPresent(String.self, forKey: .runtime)) ?? nil
        daemonUp = (try? c.decode(Bool.self, forKey: .daemonUp)) ?? false
        // a tag string on some servers, a flag on others
        if let flag = try? c.decode(Bool.self, forKey: .image) {
            image = flag
        } else {
            image = ((try? c.decodeIfPresent(String.self, forKey: .image)) ?? nil)?.isEmpty == false
        }
        container = (try? c.decodeIfPresent(String.self, forKey: .container)) ?? nil
        imageMatches = (try? c.decode(Bool.self, forKey: .imageMatches)) ?? true
        managed = (try? c.decode(Bool.self, forKey: .managed)) ?? true
        network = (try? c.decodeIfPresent(String.self, forKey: .network)) ?? nil
        security = (try? c.decodeIfPresent(String.self, forKey: .security)) ?? nil
        persistence = (try? c.decodeIfPresent(String.self, forKey: .persistence)) ?? nil
        problem = (try? c.decodeIfPresent(String.self, forKey: .problem)) ?? nil
    }

    /// An existing VM that must be replaced (stopped, an older image,
    /// unmanaged or unsafe).
    public var needsRecreate: Bool {
        guard container != "missing" else { return false }
        return container == "stopped" || !imageMatches || !managed
            || network == "unsafe" || security == "unsafe" || persistence == "unsafe"
    }

    /// The first step not done (1 to 4), as the Setup card's summary counts.
    public var setupStep: Int {
        if runtime == nil { return 1 }
        if !daemonUp { return 2 }
        if !image { return 3 }
        return 4
    }
}

/// The Local VM actions the Setup card offers.
public enum LocalComputerAction: String, Sendable {
    case pull, run, remove
}

public extension CompanionClient {
    func localComputerStatus() async throws -> LocalComputerStatus {
        try await send(makeRequest("GET", "/api/local-computer"), as: LocalComputerStatus.self)
    }

    /// `POST /api/local-computer/:action`; the answer is the new status.
    func localComputerAction(_ action: LocalComputerAction) async throws -> LocalComputerStatus {
        try await send(makeRequest("POST", "/api/local-computer/\(action.rawValue)", body: [:]), as: LocalComputerStatus.self)
    }
}

// MARK: - MCP servers, an admin's actions (McpServersPanel.tsx)

/// `POST /api/mcp/servers/:name/test`.
public struct MCPProbeResult: Decodable, Equatable, Sendable {
    public struct Tool: Decodable, Equatable, Sendable { public var name: String }
    public var ok: Bool
    public var tools: [Tool]?
    public var error: String?

    public init(ok: Bool, tools: [Tool]? = nil, error: String? = nil) {
        self.ok = ok
        self.tools = tools
        self.error = error
    }
}

public extension CompanionClient {
    /// Turn a server on or off (`PATCH /api/mcp/servers/:name {enabled}`).
    func setMCPServerEnabled(_ name: String, enabled: Bool) async throws -> [MCPServerListing] {
        try await send(mcpServerRequest("PATCH", name, body: ["enabled": enabled]), as: MCPServersResponse.self).servers
    }

    /// Start it and list its tools.
    func testMCPServer(_ name: String) async throws -> MCPProbeResult {
        try await send(mcpServerRequest("POST", name, suffix: "/test", body: [:]), as: MCPProbeResult.self)
    }

    func deleteMCPServer(_ name: String) async throws -> [MCPServerListing] {
        try await send(mcpServerRequest("DELETE", name), as: MCPServersResponse.self).servers
    }

    func mcpServerRequest(_ method: String, _ name: String, suffix: String = "", body: [String: Any]? = nil) throws -> URLRequest {
        guard Self.validRouteID(name) else { throw APIError.badURL }
        return try makeRequest(method, "/api/mcp/servers/\(name)\(suffix)", body: body)
    }
}
