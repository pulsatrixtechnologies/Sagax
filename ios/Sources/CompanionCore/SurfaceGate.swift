// What this pairing lets the app show: one place for every feature gate.
//
// The reference for a paired phone is the desktop remote client (spec
// 2026-10-02-ipad-desktop-parity-design.md, "Rule for the iPad"): paired
// through a desktop's sidecar, the app shows what the remote-client renderer
// shows; paired with a server, what the served renderer shows for the
// session's scope (client: `CLIENT_ALLOW` in server/request-auth.ts; admin:
// everything). JC's decisions of 2026-10-03 (matrix, "JC's answers") add to
// that: D1 the advanced bot panel on a sidecar for the owner, D2 message pin
// everywhere, D3 room memory on the sidecar, D4 the phone's own extras (pin
// bot, delete bot, framing) for the owner or an admin.
//
// A feature the gate refuses is hidden, never drawn disabled: a button the
// computer can only answer 403 to is worse than no button.
import Foundation

/// How the phone is paired, from the connection and the server session.
public enum PairingScope: String, Hashable, Sendable {
    /// Through the desktop's companion sidecar (`companion/src/routes.ts`
    /// `ALLOWED`): the remote-client surface, as the desktop's owner.
    case sidecar
    /// A server session without the admin scope (`CLIENT_ALLOW`).
    case serverClient
    /// A server session with the admin scope.
    case serverAdmin
}

/// Sidecar routes that JC approved but that a given desktop may not serve
/// yet (package S1 adds them to `ALLOWED`). Until the app knows the paired
/// sidecar has one, the feature behind it stays hidden on sidecar pairings.
public struct SidecarRoutes: OptionSet, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// POST /api/bots/:id/parallel/:t/stop (TH8).
    public static let parallelStop = SidecarRoutes(rawValue: 1 << 0)
    /// GET/PUT /api/groups/:id/memory (RM8, D3).
    public static let roomMemory = SidecarRoutes(rawValue: 1 << 1)
    /// The advanced bot panel's reads and owner edits (D1).
    public static let advancedPanel = SidecarRoutes(rawValue: 1 << 2)
    /// A sidecar-safe voice engine switch, replacing PUT /api/config (BA12).
    public static let voiceEngine = SidecarRoutes(rawValue: 1 << 3)

    /// What every sidecar serves today: none of the above.
    public static let current: SidecarRoutes = []
}

/// One gated surface. Named for what the person sees, with the matrix row
/// (docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md) beside it.
public enum SurfaceFeature: String, CaseIterable, Hashable, Sendable {
    // Chat and messages
    /// Reply with a quote (CO2, MS8).
    case replyQuote
    /// Regenerate the last reply (MS5).
    case regenerate
    /// Speak a reply (MS4).
    case speakReply
    /// Emoji reactions (MS10).
    case reactions
    /// Pin a message, the pinned banner (MS9, RM17 pin; D2).
    case messagePin
    /// Inspector: run log, events, raw (MS24). Admin only.
    case inspector

    // Cards
    /// Connector card: status, resume, dismiss (CA10).
    case connectorCard
    /// Connector card: Connect (authorize). Client sessions wait on S2.
    case connectorCardAuthorize
    /// Parallel task card: Stop (TH8). Sidecars wait on S1.
    case parallelTaskStop

    // Bot panel
    /// "What this bot does" (`GET /api/bots/:id/overview`, BA1): admin only
    /// for a client session.
    case botOverview
    /// The workspace voice engine (BA12). `PUT /api/config` is refused by
    /// every sidecar and is admin only on a server.
    case voiceEngineSettings
    /// Skills, memory, history, prompt preview, presets (D1, WP16).
    case advancedBotPanel
    /// The phone's extras beyond the remote client: pin bot, delete bot,
    /// picture framing (D4).
    case botOwnerExtras
    /// New bot (SB31): `POST /api/bots` passes both gates.
    case createBot
    /// Connected apps (PL1): the sidecar allows connectors; a client
    /// session does not.
    case connectedApps

    // Threads
    /// Thread folders: new, rename, icon, delete, reorder (SB19, SB20).
    /// The sidecar serves the projects routes; a server keeps them for the
    /// admin scope. Filing a thread in an existing folder (TH5) is a thread
    /// edit every pairing may make.
    case threadFolders

    // Rooms
    /// Room memory tab (RM8, D3). Sidecars wait on S1.
    case roomMemory
    /// Rename, move, edit instructions, members, who answers (RM14-RM19):
    /// hidden by the remote client, a server admin's or an organization's.
    case roomManagement
    /// Delete a room (RM16).
    case roomDelete

    // Automations and organization
    /// Scheduled calls (AU16). Admin only.
    case scheduledCalls
    /// Routines act in my name (AU19). Organization servers only.
    case orgRoutineDelegation
    /// Webhooks (AU17): host only, never on the phone.
    case webhooks
}

public struct SurfaceGate: Hashable, Sendable {
    public var scope: PairingScope
    /// An organization server (people signed in with Pulsatrix).
    public var organization: Bool
    /// Approved sidecar routes the paired desktop is known to serve.
    public var sidecarRoutes: SidecarRoutes

    public init(scope: PairingScope, organization: Bool = false, sidecarRoutes: SidecarRoutes = .current) {
        self.scope = scope
        self.organization = organization
        self.sidecarRoutes = sidecarRoutes
    }

    /// The gate for a live pairing. `account` (`GET /api/auth/session`)
    /// marks an organization server by naming a principal.
    public init(connection: Connection, account: AuthSession? = nil, sidecarRoutes: SidecarRoutes = .current) {
        let scope: PairingScope
        if !connection.pairedWithServer {
            scope = .sidecar
        } else if connection.serverScopes?.contains("admin") == true {
            scope = .serverAdmin
        } else {
            scope = .serverClient
        }
        self.init(
            scope: scope,
            organization: connection.pairedWithServer && account?.principalId?.isEmpty == false,
            sidecarRoutes: sidecarRoutes
        )
    }

    /// Nothing paired: show nothing that needs a computer's consent.
    public static let unpaired = SurfaceGate(scope: .serverClient)

    public func allows(_ feature: SurfaceFeature) -> Bool {
        switch feature {
        case .replyQuote, .regenerate, .speakReply, .reactions, .messagePin, .connectorCard, .createBot:
            return true
        case .inspector, .scheduledCalls:
            return scope == .serverAdmin
        case .connectorCardAuthorize, .botOverview, .connectedApps, .botOwnerExtras, .threadFolders:
            return scope != .serverClient
        case .parallelTaskStop:
            return scope != .sidecar || sidecarRoutes.contains(.parallelStop)
        case .voiceEngineSettings:
            switch scope {
            case .serverAdmin: return true
            case .serverClient: return false
            case .sidecar: return sidecarRoutes.contains(.voiceEngine)
            }
        case .advancedBotPanel:
            switch scope {
            case .serverAdmin: return true
            case .serverClient: return false
            case .sidecar: return sidecarRoutes.contains(.advancedPanel)
            }
        case .roomMemory:
            return scope != .sidecar || sidecarRoutes.contains(.roomMemory)
        case .roomManagement, .roomDelete:
            return scope == .serverAdmin || (scope == .serverClient && organization)
        case .orgRoutineDelegation:
            return organization
        case .webhooks:
            return false
        }
    }
}

extension Connection {
    /// This pairing's gate, without the organization flag (which needs the
    /// signed-in session).
    public var surfaceGate: SurfaceGate { SurfaceGate(connection: self) }
}
