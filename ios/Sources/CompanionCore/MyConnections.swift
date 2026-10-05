// Settings > My connections (Mes connexions), organization servers only
// (`src/components/settings/MyConnectionsSettings.tsx`, `src/lib/my-connections.ts`,
// server/routes/person-connections.ts): the person's own GitHub account and
// their own MCP servers. The server never sends a token back. The companion
// sidecar does not list these routes (`SurfaceFeature.myConnections`).
import Foundation

public struct MyConnections: Decodable, Equatable, Sendable {
    public struct GitHub: Decodable, Equatable, Sendable {
        /// none, pending, connected, error
        public var state: String
        public var deviceFlow: Bool
        public var userCode: String?
        public var verificationUri: String?
        public var login: String?
        public var error: String?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            state = try c.decode(String.self, forKey: .state)
            deviceFlow = try c.decodeIfPresent(Bool.self, forKey: .deviceFlow) ?? false
            userCode = try c.decodeIfPresent(String.self, forKey: .userCode)
            verificationUri = try c.decodeIfPresent(String.self, forKey: .verificationUri)
            login = try c.decodeIfPresent(String.self, forKey: .login)
            error = try c.decodeIfPresent(String.self, forKey: .error)
        }

        private enum CodingKeys: String, CodingKey { case state, deviceFlow, userCode, verificationUri, login, error }
    }

    public struct Server: Decodable, Equatable, Sendable, Identifiable {
        public var name: String
        /// remote or stdio
        public var kind: String
        public var domain: String?
        public var command: String?
        /// none, token, oauth, github (remote)
        public var auth: String?
        public var enabled: Bool
        public var authState: String
        public var authError: String?
        public var authPending: Bool?
        public var id: String { name }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decode(String.self, forKey: .name)
            kind = try c.decode(String.self, forKey: .kind)
            domain = try c.decodeIfPresent(String.self, forKey: .domain)
            command = try c.decodeIfPresent(String.self, forKey: .command)
            auth = try c.decodeIfPresent(String.self, forKey: .auth)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            authState = try c.decodeIfPresent(String.self, forKey: .authState) ?? "error"
            authError = try c.decodeIfPresent(String.self, forKey: .authError)
            authPending = try c.decodeIfPresent(Bool.self, forKey: .authPending)
        }

        private enum CodingKeys: String, CodingKey { case name, kind, domain, command, auth, enabled, authState, authError, authPending }

        public var isRemote: Bool { kind == "remote" }
        /// An OAuth server that is not signed in offers Sign in; a signed-in one Sign out.
        public var offersSignIn: Bool { isRemote && auth == "oauth" && authState != "connected" }
        public var offersSignOut: Bool { isRemote && auth == "oauth" && authState == "connected" }
    }

    public var github: GitHub
    public var servers: [Server]
    public var sandbox: Bool
    public var managedByAdmin: Bool?

    /// A GitHub code or a server sign-in waits: ask again every two seconds.
    public var waiting: Bool { github.state == "pending" || servers.contains { $0.isRemote && $0.authPending == true } }
}

/// A server to add: an address (`auth` none, token, oauth, github) or a
/// command that runs in the person's server environment.
public enum NewPersonalServer: Equatable, Sendable {
    case remote(name: String, url: String, auth: String, token: String?)
    case command(name: String, command: String, args: [String], env: [String: String])
}

public enum MyConnectionsRules {
    public static let githubMCPURL = "https://api.githubcopilot.com/mcp/"

    /// A server's name in the routes: `[a-z][a-z0-9_-]{0,31}`.
    public static func validServerName(_ name: String) -> Bool {
        let bytes = Array(name.utf8)
        guard (1...32).contains(bytes.count), (97...122).contains(bytes[0]) else { return false }
        return bytes.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45 }
    }

    /// `suggestServerName`: a lowercase, safe name from an address or a command.
    public static func suggestName(_ source: String) -> String {
        var base = source.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: base), let host = url.host, url.scheme != nil {
            var h = host
            for prefix in ["www.", "mcp.", "api."] where h.hasPrefix(prefix) { h = String(h.dropFirst(prefix.count)); break }
            base = h.split(separator: ".").first.map(String.init) ?? ""
        } else {
            base = base.split(whereSeparator: { $0 == " " || $0 == "/" || $0 == "@" || $0.isNewline }).last.map(String.init) ?? ""
        }
        var name = ""
        var lastDash = false
        for ch in base.lowercased() {
            if ch.isASCII, ch.isLetter || ch.isNumber || ch == "_" || ch == "-" {
                name.append(ch); lastDash = ch == "-"
            } else if !lastDash {
                name.append("-"); lastDash = true
            }
        }
        while let first = name.first, !(first.isASCII && first.isLetter) { name.removeFirst() }
        while name.hasSuffix("-") { name.removeLast() }
        name = String(name.prefix(32))
        return name.isEmpty ? "server" : name
    }

    /// `parseEnvLines`: "KEY=value" lines; a line without "=" is returned as the error.
    public static func parseEnv(_ text: String) -> Result<[String: String], EnvLineError> {
        var env: [String: String] = [:]
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            guard let index = line.firstIndex(of: "="), index != line.startIndex else { return .failure(EnvLineError(line: line)) }
            env[String(line[..<index]).trimmingCharacters(in: .whitespaces)] = String(line[line.index(after: index)...])
        }
        return .success(env)
    }

    public struct EnvLineError: Error, Equatable { public var line: String }

    /// `parseArgsLine`: spaces split, quotes keep an argument whole.
    public static func parseArgs(_ text: String) -> [String] {
        var out: [String] = []
        var current = ""
        var quote: Character?
        var started = false
        for ch in text {
            if let q = quote {
                if ch == q { quote = nil } else { current.append(ch) }
            } else if ch == "\"" || ch == "'" {
                quote = ch; started = true
            } else if ch.isWhitespace {
                if started { out.append(current); current = ""; started = false }
            } else {
                current.append(ch); started = true
            }
        }
        if started { out.append(current) }
        return out
    }
}

public extension CompanionClient {
    /// `GET /api/me/connections`.
    func myConnections() async throws -> MyConnections {
        try await send(makeRequest("GET", "/api/me/connections"), as: MyConnections.self)
    }

    /// `POST /api/me/github/device`: a code to type at GitHub.
    func startGithubDevice() async throws {
        try await send(makeRequest("POST", "/api/me/github/device", body: [:]))
    }

    /// `POST /api/me/github/token {token}`. The token goes to the server and is never read back.
    func connectGithubToken(_ token: String) async throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/me/github/token", body: ["token": trimmed]))
    }

    /// `DELETE /api/me/github`.
    func disconnectGithub() async throws {
        try await send(makeRequest("DELETE", "/api/me/github"))
    }

    /// `POST /api/me/mcp/servers`.
    func addPersonalServer(_ server: NewPersonalServer) async throws {
        try await send(addPersonalServerRequest(server))
    }

    /// `PATCH /api/me/mcp/servers/:name {enabled}`.
    func setPersonalServerEnabled(name: String, enabled: Bool) async throws {
        guard MyConnectionsRules.validServerName(name) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/me/mcp/servers/\(name)", body: ["enabled": enabled]))
    }

    /// `DELETE /api/me/mcp/servers/:name`.
    func removePersonalServer(name: String) async throws {
        guard MyConnectionsRules.validServerName(name) else { throw APIError.badURL }
        try await send(makeRequest("DELETE", "/api/me/mcp/servers/\(name)"))
    }

    /// `POST /api/me/mcp/servers/:name/oauth/start`: the address to open in a browser.
    func startPersonalServerSignIn(name: String) async throws -> URL {
        guard MyConnectionsRules.validServerName(name) else { throw APIError.badURL }
        struct Started: Decodable { var authorizationUrl: String }
        let started = try await send(makeRequest("POST", "/api/me/mcp/servers/\(name)/oauth/start", body: [:]), as: Started.self)
        guard let url = URL(string: started.authorizationUrl), url.scheme == "https" || url.scheme == "http" else { throw APIError.badURL }
        return url
    }

    /// `POST /api/me/mcp/servers/:name/oauth/disconnect`.
    func disconnectPersonalServer(name: String) async throws {
        guard MyConnectionsRules.validServerName(name) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/me/mcp/servers/\(name)/oauth/disconnect", body: [:]))
    }

    func addPersonalServerRequest(_ server: NewPersonalServer) throws -> URLRequest {
        switch server {
        case let .remote(name, url, auth, token):
            var body: [String: Any] = ["name": name, "url": url.trimmingCharacters(in: .whitespacesAndNewlines), "auth": auth]
            if auth == "token", let token { body["token"] = token.trimmingCharacters(in: .whitespacesAndNewlines) }
            return try makeRequest("POST", "/api/me/mcp/servers", body: body)
        case let .command(name, command, args, env):
            return try makeRequest("POST", "/api/me/mcp/servers", body: ["name": name, "command": command.trimmingCharacters(in: .whitespacesAndNewlines), "args": args, "env": env])
        }
    }
}
