// The person's own Local VM on an organization server, as the Computer tab
// draws it (src/lib/desktop-local-vm.ts). The phone asks the person's desktop
// through POST /api/me/desktop-bridge/local-vm. It never sends `use`: seeing
// and driving the screen is the bot's tool. A still and the power buttons
// are all this side does.
import Foundation

/// Where the Computer tab shows this screen: an organization server, and the
/// bot works on Local VM or This computer. Auto and Cloud stay the server
/// environment. A solo server keeps the phone's other computer view.
public enum OrgLocalVmScreen {
    public static func shows(worksOn: DesktopWorksOn, organization: Bool) -> Bool {
        organization && (worksOn == .vm || worksOn == .local)
    }
}

/// What the Computer tab may ask. The server refuses anything else.
public enum LocalVmAction: String, Sendable {
    case status, start, stop, pause, resume, setup, install, screenshot
}

public struct LocalVmStatus: Decodable, Equatable, Sendable {
    public struct Runtime: Decodable, Equatable, Sendable {
        public var found: Bool
        public var runtime: String?
        public var cli: String?
        public var product: String?
        public var daemonUp: Bool
    }

    public struct VM: Decodable, Equatable, Sendable {
        public var state: String
        public var stale: String?
        public var folder: String?
    }

    public struct Step: Decodable, Equatable, Sendable {
        public var id: String
        public var state: String
    }

    public struct Setup: Decodable, Equatable, Sendable {
        public var state: String
        public var steps: [Step]
        public var error: String?
        public var code: String?
        public var previousFolder: String?
    }

    public var runtime: Runtime
    public var workspace: String?
    public var vm: VM?
    public var setup: Setup?
}

/// One desktop the bridge lists. Only an online one with Local VM may be asked.
public struct PersonDesktop: Decodable, Equatable, Sendable {
    public struct Capabilities: Decodable, Equatable, Sendable {
        public var localVm: Bool?
    }

    public var platform: String?
    public var online: Bool
    public var lastSeenAt: Double
    public var capabilities: Capabilities?
}

public struct PersonDesktopBridge: Decodable, Equatable, Sendable {
    public var connected: Bool
    public var desktops: [PersonDesktop]

    /// The desktop the Computer tab asks (`currentDesktop`): the newest
    /// online one. Connected only when that one can run the Local VM.
    public func localVmDesktop() -> (connected: Bool, platform: String?) {
        let online = desktops.filter(\.online).sorted { $0.lastSeenAt > $1.lastSeenAt }
        guard let desktop = online.first else { return (false, nil) }
        return (desktop.capabilities?.localVm == true, desktop.platform)
    }
}

public struct LocalVmInstall: Equatable, Sendable, Identifiable {
    public var id: String { raw }
    public var raw: String
    public var title: String

    /// Install choices for this computer's system (`installChoices`).
    public static func choices(platform: String?) -> [LocalVmInstall] {
        let rows: [(String, String)]
        if platform == "win32" {
            rows = [("docker-windows", "Get Docker Desktop (WSL 2)"), ("podman-download", "Get Podman Desktop")]
        } else if platform == "darwin" {
            rows = [
                ("orbstack-download", "Get OrbStack"),
                ("docker-download", "Get Docker Desktop"),
                ("orbstack-brew", "Install OrbStack with Homebrew"),
            ]
        } else {
            rows = [("docker-download", "Get Docker Desktop"), ("podman-download", "Get Podman Desktop")]
        }
        return rows.map { LocalVmInstall(raw: $0.0, title: $0.1) }
    }
}

/// The screen's five states (`localVmView`).
public struct LocalVmView: Equatable, Sendable {
    public enum State: String, Equatable, Sendable { case off, starting, running, paused, error }
    public enum Problem: Equatable, Sendable {
        case notConnected, noRuntime, runtimeStopped, missing, stale, foreign, setupFailed
    }

    public var state: State
    public var problem: Problem?
    public var canPlay: Bool
    public var canPause: Bool
    public var canResume: Bool
    public var canStop: Bool
    public var playNeedsConsent: Bool
    public var repair: Bool

    /// Shown until the first bridge answer, so the screen does not say the
    /// computer is disconnected before it has asked.
    public static let loading = LocalVmView(
        state: .starting, problem: nil, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false
    )

    public static func of(status: LocalVmStatus?, connected: Bool, pending: LocalVmAction?) -> LocalVmView {
        let idle = LocalVmView(state: .off, problem: nil, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
        if !connected { return LocalVmView(state: .off, problem: .notConnected, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false) }
        if pending == .setup || pending == .start || pending == .resume || status?.setup?.state == "running" {
            return LocalVmView(state: .starting, problem: nil, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
        }
        guard let status else { return idle }
        if status.setup?.state == "error" {
            let code = status.setup?.code
            let problem: Problem = code == "no_runtime" ? .noRuntime : code == "runtime_stopped" ? .runtimeStopped : code == "foreign_container" ? .foreign : .setupFailed
            if problem != .setupFailed || status.vm == nil || status.vm?.state != "running" {
                return LocalVmView(state: .error, problem: problem, canPlay: problem != .foreign, canPause: false, canResume: false, canStop: false, playNeedsConsent: problem != .runtimeStopped, repair: problem == .setupFailed)
            }
        }
        if status.runtime.cli == nil && !status.runtime.found {
            return LocalVmView(state: .error, problem: .noRuntime, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
        }
        if !status.runtime.daemonUp {
            return LocalVmView(state: .off, problem: .runtimeStopped, canPlay: true, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
        }
        guard let vm = status.vm else {
            return LocalVmView(state: .off, problem: .missing, canPlay: true, canPause: false, canResume: false, canStop: false, playNeedsConsent: true, repair: false)
        }
        if vm.stale == "foreign" {
            return LocalVmView(state: .error, problem: .foreign, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
        }
        if let stale = vm.stale, stale != "old_image" {
            return LocalVmView(state: .error, problem: .stale, canPlay: true, canPause: false, canResume: false, canStop: false, playNeedsConsent: true, repair: true)
        }
        if vm.state == "running" {
            return LocalVmView(state: .running, problem: nil, canPlay: false, canPause: true, canResume: false, canStop: true, playNeedsConsent: false, repair: false)
        }
        if vm.state == "paused" {
            return LocalVmView(state: .paused, problem: nil, canPlay: false, canPause: false, canResume: true, canStop: true, playNeedsConsent: false, repair: false)
        }
        if vm.state == "starting" {
            return LocalVmView(state: .starting, problem: nil, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
        }
        return LocalVmView(state: .off, problem: nil, canPlay: true, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false)
    }

    public var stateLabel: String {
        switch state {
        case .off: "Off"
        case .starting: "Starting"
        case .running: "Running"
        case .paused: "Paused"
        case .error: "Error"
        }
    }

    /// The labeled button under the message. Install choices replace it
    /// when there is no container engine. Start is also the play control.
    public var setupTitle: String? {
        if problem == .noRuntime { return nil }
        if repair { return "Repair" }
        if canPlay && state != .running {
            return problem == .missing ? "Set up in one click" : "Start"
        }
        return nil
    }

    public var playLabel: String { state == .paused ? "Resume" : "Start" }

    /// What the screen says. Nil while a live picture already says it.
    public func words(status: LocalVmStatus?) -> String? {
        if state == .starting, status?.setup?.state == "running" {
            let steps = status?.setup?.steps ?? []
            let found = steps.firstIndex { $0.state == "running" } ?? 0
            let index = max(0, found)
            let id = steps.indices.contains(index) ? steps[index].id : "runtime"
            return "Step \(index + 1) of \(max(steps.count, 1)): \(Self.stepLabel(id))"
        }
        if let problem {
            let product = status?.runtime.product ?? status?.runtime.runtime ?? "Docker"
            let folder = status?.vm?.folder ?? ""
            var text = problem.sentence(product: product, folder: folder)
            if problem == .setupFailed, let extra = status?.setup?.error, !extra.isEmpty { text += " \(extra)" }
            return text
        }
        if state == .off { return "The Local VM is off. Press Start to turn it on." }
        return nil
    }

    /// Play needs a yes first: it downloads, creates or recreates on the computer.
    public func consent(workspace: String?) -> LocalVmConsent? {
        guard playNeedsConsent else { return nil }
        let folder = (workspace?.isEmpty == false) ? workspace! : "the Sagax folder"
        return repair
            ? .repair("Sagax will remove the broken Local VM container and create a new one on \(folder). Files in that folder are kept. Continue?")
            : .create("Sagax will prepare the Local VM on this computer: download the desktop image if needed, then create and start the VM. Its files go to \(folder). Continue?")
    }

    private static func stepLabel(_ id: String) -> String {
        switch id {
        case "runtime": "Container engine"
        case "image": "Desktop image"
        case "container": "Local VM"
        case "start": "Start"
        default: "Container engine"
        }
    }
}

public enum LocalVmConsent: Equatable, Sendable {
    case create(String)
    case repair(String)

    public var message: String {
        switch self {
        case let .create(text), let .repair(text): text
        }
    }
}

extension LocalVmView.Problem {
    fileprivate func sentence(product: String, folder: String) -> String {
        switch self {
        case .notConnected:
            return "Your computer is not connected. Open the Sagax app on it to use its Local VM."
        case .noRuntime:
            return "No container engine on this computer. Install one (OrbStack or Docker Desktop), then set up in one click."
        case .runtimeStopped:
            return "\(product) is installed but not running. Start sets it running."
        case .missing:
            return "There is no Local VM on this computer yet. Set it up in one click."
        case .stale:
            return "This Local VM was made for another folder that is gone (\(folder)), so it cannot start. Repair recreates it on your Sagax folder; your files there are kept."
        case .foreign:
            return "A container with the Local VM's name exists but was not created by Sagax. Remove it in your container app, then try again."
        case .setupFailed:
            return "The setup did not finish."
        }
    }
}

struct LocalVmBridgeBody: Decodable {
    struct Content: Decodable {
        var type: String?
        var text: String?
        var data: String?
        var mimeType: String?
    }

    struct Result: Decodable {
        var content: [Content]?
        var isError: Bool?
    }

    var result: Result?
}

public struct LocalVmAnswer: Equatable, Sendable {
    public var ok: Bool
    public var text: String
    public var status: LocalVmStatus?
    public var image: Data?

    static func parse(_ body: LocalVmBridgeBody) -> LocalVmAnswer {
        let content = body.result?.content ?? []
        let joined = content.filter { $0.type == "text" }.compactMap(\.text).joined(separator: "\n")
        let text = String(joined.prefix(2000))
        var answer = LocalVmAnswer(ok: body.result?.isError != true, text: text, status: nil, image: nil)
        if let picture = content.first(where: { $0.type == "image" }), let raw = picture.data, let bytes = Data(base64Encoded: raw, options: .ignoreUnknownCharacters), !bytes.isEmpty {
            answer.image = bytes
        }
        if let data = text.data(using: .utf8), let status = try? JSONDecoder().decode(LocalVmStatus.self, from: data) {
            answer.status = status
        }
        return answer
    }
}

public extension CompanionClient {
    /// `GET /api/me/desktop-bridge`. Nil when this server has no bridge (404 or 403).
    func personDesktopBridge() async throws -> PersonDesktopBridge? {
        let request = try makeRequest("GET", "/api/me/desktop-bridge")
        let (data, response) = try await perform(request)
        if let http = response as? HTTPURLResponse, http.statusCode == 404 || http.statusCode == 403 { return nil }
        try Self.check(response, data)
        return try JSONDecoder().decode(PersonDesktopBridge.self, from: data)
    }

    /// `POST /api/me/desktop-bridge/local-vm`. Setup can take a while; the
    /// request waits up to the client's own ceiling. `use` is not an action
    /// here: the bot drives the screen, the phone only asks for a still.
    func localVm(action: LocalVmAction, choice: String? = nil) async throws -> LocalVmAnswer {
        var fields: [String: Any] = ["action": action.rawValue]
        if let choice { fields["choice"] = choice }
        var request = try makeRequest("POST", "/api/me/desktop-bridge/local-vm", body: fields)
        request.timeoutInterval = 150
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        let body = try JSONDecoder().decode(LocalVmBridgeBody.self, from: data)
        return LocalVmAnswer.parse(body)
    }
}
