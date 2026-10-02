// DEBUG-only entry points for the visual-parity harness (ios/parity/).
//
// The harness runs the real server on a throwaway data directory, pairs
// through the server's own pairing API and launches the app with:
//
//   -parityEndpoint http://127.0.0.1:PORT   the server to use
//   -parityToken TOKEN                      the bearer it issued
//   -parityEnvironment ENV                  its environment id (server pairing)
//   -parityScreen 02-chat                   which reference screen to open
//
// Nothing is written to the Keychain or the saved connections: the session
// is built in memory, so a build without signing entitlements works and a
// normal launch afterwards finds the phone exactly as it was. Release builds
// compile none of this.
import SwiftUI
import CompanionCore

/// The 21 reference screens, plus the theme gallery.
enum ParityScreen: String, CaseIterable {
    case home = "01-home"
    case chat = "02-chat"
    case profileInfo = "03-profile-info"
    case profileInfoScrolled = "04-profile-info-scrolled"
    case routineDetail = "05-routine-detail"
    case routineInstruction = "06-routine-instruction"
    case profileMoreMenu = "07-profile-more-menu"
    case profileLinks = "08-profile-links"
    case profileMedia = "09-profile-media"
    case profileFiles = "10-profile-files"
    case computerTrackpadToast = "11-computer-trackpad-toast"
    case settingsTop = "12-settings-top"
    case computer = "13-computer"
    case settingsBottom = "14-settings-bottom"
    case plugins = "15-plugins"
    case account = "16-account"
    case newGroupChat = "17-new-group-chat"
    case homePlusMenu = "18-home-plus-menu"
    case search = "19-search"
    case createBot = "20-create-bot"
    case botComputer = "21-bot-computer"
    case themeGallery = "theme-gallery"

    /// Accepts the full name, the number ("02") or the name ("chat").
    init?(argument: String) {
        let value = argument.lowercased()
        if let exact = ParityScreen(rawValue: value) { self = exact; return }
        guard let match = Self.allCases.first(where: { screen in
            let parts = screen.rawValue.split(separator: "-", maxSplits: 1)
            return parts.first.map(String.init) == value || (parts.count == 2 && String(parts[1]) == value)
        }) else { return nil }
        self = match
    }

    /// Screens shown inside Ara's chat (pushed from the home).
    var opensAraChat: Bool {
        switch self {
        case .chat, .profileInfo, .profileInfoScrolled, .profileMoreMenu, .profileLinks, .profileMedia,
             .profileFiles, .computer, .computerTrackpadToast:
            true
        default:
            false
        }
    }

    var opensComputer: Bool { self == .computer || self == .computerTrackpadToast }

    /// Screens the home opens itself: its "+" menu and its sheets.
    var opensFromHome: Bool {
        switch self {
        case .home, .homePlusMenu, .search, .newGroupChat, .createBot,
             .settingsTop, .settingsBottom, .plugins, .account, .botComputer: true
        default: false
        }
    }

    /// Today's profile sheet stands in for the profile screens until P4.
    var opensProfile: Bool {
        switch self {
        case .profileInfo, .profileInfoScrolled, .profileMoreMenu, .profileLinks, .profileMedia, .profileFiles:
            true
        default:
            false
        }
    }
}

#if DEBUG
struct ParityLaunch {
    let endpoint: URL
    let token: String
    let environmentId: String?
    let screen: ParityScreen?

    static let current: ParityLaunch? = parse(ProcessInfo.processInfo.arguments)

    /// Launch arguments arrive as `-key value` pairs.
    static func parse(_ arguments: [String]) -> ParityLaunch? {
        func value(_ key: String) -> String? {
            guard let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }
        guard let raw = value("-parityEndpoint"), let endpoint = URL(string: raw),
              endpoint.host != nil, let token = value("-parityToken"), !token.isEmpty
        else { return nil }
        return ParityLaunch(
            endpoint: endpoint,
            token: token,
            environmentId: value("-parityEnvironment"),
            screen: value("-parityScreen").flatMap(ParityScreen.init(argument:))
        )
    }

    /// The in-memory connection the session uses.
    var connection: Connection {
        Connection(
            id: "parity-harness",
            name: "Parity fixture",
            host: endpoint.host ?? "127.0.0.1",
            port: endpoint.port ?? 8799,
            serverEnvironmentId: environmentId,
            serverScopes: ["admin", "client"]
        )
    }
}

/// Opens the requested reference screen once the roster has arrived.
struct ParityScreenLauncher: ViewModifier {
    @EnvironmentObject private var session: Session
    @State private var presented: ParityScreen?
    @State private var launched = false

    func body(content: Content) -> some View {
        content
            .task {
                guard !launched, let screen = ParityLaunch.current?.screen else { return }
                launched = true
                if screen.opensAraChat {
                    // Wait for the fleet, then push Ara's chat the way a deep link does.
                    for _ in 0..<150 {
                        if let ara = session.state.bots.first(where: { $0.name == "Ara" }) {
                            session.openChat(threadId: ara.threadId)
                            return
                        }
                        try? await Task.sleep(nanoseconds: 100_000_000)
                    }
                    return
                }
                if screen.opensFromHome { return }
                for _ in 0..<150 where session.state.bots.isEmpty {
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
                presented = screen
            }
            .sheet(isPresented: sheetBinding) {
                switch presented {
                default:
                    EmptyView()
                }
            }
            .fullScreenCover(isPresented: coverBinding) {
                if presented == .themeGallery {
                    ThemeGalleryView()
                } else {
                    ParityPlaceholderView(screen: presented ?? .home) { presented = nil }
                }
            }
    }

    private static let sheetScreens: Set<ParityScreen> = []

    private var sheetBinding: Binding<Bool> {
        Binding(
            get: { presented.map(Self.sheetScreens.contains) ?? false },
            set: { if !$0 { presented = nil } }
        )
    }

    private var coverBinding: Binding<Bool> {
        Binding(
            get: { presented.map { !Self.sheetScreens.contains($0) && !$0.opensAraChat && !$0.opensFromHome } ?? false },
            set: { if !$0 { presented = nil } }
        )
    }
}

/// A screen that a later phase builds. Drawn on the theme background so the
/// diff measures the gap honestly instead of comparing against the home.
struct ParityPlaceholderView: View {
    let screen: ParityScreen
    let close: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Theme.bg.ignoresSafeArea()
            GlassCircleButton(systemImage: "xmark", action: close)
                .padding(.leading, Theme.Metric.screenEdge)
                .padding(.top, 12)
            Text(verbatim: "Parity placeholder: \(screen.rawValue)")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .preferredColorScheme(.dark)
    }
}
#endif

extension View {
    /// The parity harness's screen launcher in DEBUG; nothing otherwise.
    @ViewBuilder
    func parityLauncher() -> some View {
        #if DEBUG
        if ParityLaunch.current != nil {
            modifier(ParityScreenLauncher())
        } else {
            self
        }
        #else
        self
        #endif
    }
}
