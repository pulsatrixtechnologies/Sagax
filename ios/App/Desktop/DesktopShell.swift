// iPad I1: the desktop shell. A row like the Electron window's: the sidebar
// (280), the content, and the bot panel (360) docked at 1024 pt and wider,
// over the leading edge below (spec "SwiftUI architecture", "At each iPad
// width"). Not `NavigationSplitView`: it cannot say "dock at 1024, overlay
// below" and brings its own columns, toolbars and glass.
//
// The iPhone never reaches this file: `HomeRoot` picks the desktop shell only
// on an iPad in a regular-width window of 768 pt or more (Slide Over, a
// third of Split View and narrow Stage Manager windows keep the phone UI).
//
// Each column is type-erased (`AnyView`): build 6 overflowed the main
// thread's stack at launch on iPad resolving one deep SwiftUI type.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Which home

/// The home for the window: the phone's roster, or the desktop shell.
struct HomeRoot: View {
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if UIDevice.current.userInterfaceIdiom != .pad {
            // the iPhone: exactly the phone home, no measuring around it
            AnyView(ChatListView().parityLauncher())
        } else {
            AnyView(padHome)
        }
    }

    private var padHome: some View {
        GeometryReader { geometry in
            if DesktopShellRules.usesDesktop(
                idiomIsPad: UIDevice.current.userInterfaceIdiom == .pad,
                regularWidth: sizeClass == .regular,
                width: geometry.size.width
            ) {
                AnyView(DesktopShell())
            } else {
                AnyView(ChatListView().parityLauncher())
            }
        }
    }
}

/// The size rules, by window width (`w`).
enum DesktopShellRules {
    static let desktopMinWidth: CGFloat = 768
    static let dockMinWidth: CGFloat = 1024
    static let sidebarWidth: CGFloat = 280
    static let panelWidth: CGFloat = 360
    /// The desktop's title band: the top inset of the sidebar and the panel.
    static let topBand: CGFloat = 36
    /// The transcript and composer column caps here (ChatView.tsx:1482).
    static let chatColumn: CGFloat = 960

    static func usesDesktop(idiomIsPad: Bool, regularWidth: Bool, width: CGFloat) -> Bool {
        idiomIsPad && regularWidth && width >= desktopMinWidth
    }

    static func docksPanel(width: CGFloat) -> Bool { width >= dockMinWidth }
}

// MARK: - State

/// The renderer's store, for the shell: what is selected, which panel and
/// modal are open.
@MainActor
final class DesktopShellModel: ObservableObject {
    enum Modal: String, Identifiable {
        case settings, search, newBot, newGroup, teamMap, automations
        var id: String { rawValue }
    }

    @Published var selected: Chat?
    @Published var panelOpen = false
    @Published var panelTab: BotPanelTab = .details
    @Published var modal: Modal?
    /// The composer's model picker (I3), over the whole window.
    @Published var modelPickerOpen = false

    func open(_ chat: Chat) {
        selected = chat
    }

    func togglePanel() {
        withAnimation(.easeOut(duration: 0.2)) { panelOpen.toggle() }
    }
}

// MARK: - Shell

struct DesktopShell: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = DesktopShellModel()

    var body: some View {
        let theme = DesktopTheme.of(themePalette.id)
        return GeometryReader { geometry in
            AnyView(columns(width: geometry.size.width, theme: theme))
        }
        .ignoresSafeArea(.container)
        .environment(\.desktopTheme, theme)
        .environmentObject(model)
        .statusBarHidden(true)
        // no home indicator over the composer: the desktop window has none
        .persistentSystemOverlays(.hidden)
        .parityLauncher()
        .modifier(DesktopShellPresenter(model: model))
        .modifier(DesktopShellRouting(model: model))
    }

    private func columns(width: CGFloat, theme: DesktopTheme) -> some View {
        let docked = DesktopShellRules.docksPanel(width: width)
        let botOpen = model.panelOpen && selectedBot != nil
        return ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                AnyView(DesktopSidebar())
                    .frame(width: DesktopShellRules.sidebarWidth)
                AnyView(DesktopContent())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if docked, botOpen, let bot = selectedBot {
                    AnyView(BotPanel(bot: bot, docked: true))
                        .frame(width: DesktopShellRules.panelWidth)
                        .transition(.move(edge: .trailing))
                }
            }
            if !docked, botOpen, let bot = selectedBot {
                // Below 1024 the panel covers the leading edge (measured at
                // 834: x 0, 360 wide), the chat still visible to its right.
                Color.black.opacity(0.001)
                    .onTapGesture { model.togglePanel() }
                AnyView(BotPanel(bot: bot, docked: false))
                    .frame(width: DesktopShellRules.panelWidth)
                    .frame(maxHeight: .infinity)
                    .shadow(color: .black.opacity(0.35), radius: 24, x: 4)
                    .transition(.move(edge: .leading))
            }
            if model.modelPickerOpen, let bot = selectedBot {
                AnyView(DesktopModelPicker(
                    bot: bot.projected(forThread: model.selected?.threadId ?? bot.threadId) ?? bot,
                    close: { model.modelPickerOpen = false },
                    openProviders: {
                        model.modelPickerOpen = false
                        model.modal = .settings
                    }
                ))
                .transition(.opacity)
            }
        }
        .background(theme.app)
    }

    private var selectedBot: Bot? {
        guard case let .bot(bot) = model.selected else { return nil }
        return session.state.bot(bot.id) ?? bot
    }
}

// MARK: - Content column

/// The selected conversation, or a quiet empty state.
struct DesktopContent: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        if let chat = model.selected {
            AnyView(DesktopChatColumn(chat: chat))
                .id(chat.threadId)
        } else {
            ZStack {
                DesktopAppGlow()
                Text("Pick a conversation in the sidebar.")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
    }
}

/// `main.app-glow`: the app colour with two radial accent glows from the top.
struct DesktopAppGlow: View {
    @Environment(\.desktopTheme) private var theme

    var body: some View {
        let accent = theme.accent
        let glow = theme.glow
        return ZStack {
            theme.app
            if glow.0 > 0 {
                Canvas { context, size in
                    // radial-gradient(ellipse 110% 62% at 50% 0%, accent a, transparent 70%)
                    Self.ellipse(&context, centre: CGPoint(x: size.width * 0.5, y: 0),
                                 radii: CGSize(width: size.width * 1.10, height: size.height * 0.62),
                                 color: accent, alpha: glow.0, end: 0.70)
                    // radial-gradient(ellipse 72% 44% at 80% 0%, accent b, transparent 68%)
                    Self.ellipse(&context, centre: CGPoint(x: size.width * 0.8, y: 0),
                                 radii: CGSize(width: size.width * 0.72, height: size.height * 0.44),
                                 color: accent, alpha: glow.1, end: 0.68)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    /// One CSS elliptical gradient: a unit circle's radial gradient,
    /// stretched to the ellipse's radii.
    private static func ellipse(_ context: inout GraphicsContext, centre: CGPoint, radii: CGSize, color: Color, alpha: Double, end: CGFloat) {
        var layer = context
        layer.translateBy(x: centre.x, y: centre.y)
        layer.scaleBy(x: radii.width, y: radii.height)
        let gradient = Gradient(stops: [
            .init(color: color.opacity(alpha), location: 0),
            .init(color: color.opacity(0), location: end),
        ])
        layer.fill(
            Path(ellipseIn: CGRect(x: -1, y: -1, width: 2, height: 2)),
            with: .radialGradient(gradient, center: .zero, startRadius: 0, endRadius: 1)
        )
    }
}

// MARK: - Routing

/// Deep links, notifications and the parity launch select a conversation.
private struct DesktopShellRouting: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content
            .onValueChange(of: session.notificationChat) { chat in
                guard let chat else { return }
                model.open(chat)
                session.consumeNotificationChat()
            }
            .onValueChange(of: session.pendingChat) { chat in
                guard let chat else { return }
                model.open(chat)
                session.consumePendingChat()
            }
            .task {
                if let chat = session.notificationChat {
                    model.open(chat)
                    session.consumeNotificationChat()
                }
                if let chat = session.pendingChat {
                    model.open(chat)
                    session.consumePendingChat()
                }
                #if DEBUG
                await applyParityLaunch()
                #endif
                await openDefault()
            }
            .task(id: session.connection?.id) {
                await session.loadAccount()
                await SidebarPrefsModel.shared.load(session)
            }
    }

    /// The desktop opens on a conversation: the Primary Bot, else the first bot.
    private func openDefault() async {
        for _ in 0..<150 where model.selected == nil {
            let bots = session.state.bots.filter { $0.hidden != true }
            if let first = bots.first(where: { $0.chiefOfStaff == true }) ?? bots.first {
                model.open(session.threadSelection.restoringThread(.bot(first), connectionID: session.connection?.id))
                return
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    #if DEBUG
    /// `-parityIPadScreen main | panel-details`: Ara's chat, the panel open
    /// for the panel surfaces (the desktop references select Ara).
    private func applyParityLaunch() async {
        guard let screen = ParityLaunch.current?.iPadScreen, screen.implemented else { return }
        for _ in 0..<150 {
            if let ara = session.state.bots.first(where: { $0.name == "Ara" }) {
                model.open(.bot(ara))
                model.panelOpen = screen.opensBotPanel
                model.modelPickerOpen = screen == .chatModelPicker
                return
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }
    #endif
}

// MARK: - Modals

/// The surfaces I5-I8 turn into desktop modals; for now the phone's own
/// sheets, presented as iPad form sheets.
private struct DesktopShellPresenter: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content.sheet(item: $model.modal) { modal in
            AnyView(sheet(modal))
                .environmentObject(session)
        }
    }

    @ViewBuilder
    private func sheet(_ modal: DesktopShellModel.Modal) -> some View {
        switch modal {
        case .settings:
            SettingsView(close: { model.modal = nil })
        case .search:
            SearchSheet(close: { model.modal = nil }) { chat in
                model.modal = nil
                model.open(session.threadSelection.restoringThread(chat, connectionID: session.connection?.id))
            } openHit: { hit in
                Task {
                    if let chat = await session.open(hit) {
                        model.modal = nil
                        model.open(chat)
                    }
                }
            }
        case .newBot:
            CreateBotSheet(close: { model.modal = nil }) { bot in
                model.modal = nil
                model.open(.bot(bot))
            }
        case .newGroup:
            NewGroupSheet(close: { model.modal = nil }) { room in
                model.modal = nil
                model.open(.room(room))
            }
        case .teamMap:
            TeamMapSheet { chat in
                model.modal = nil
                model.open(chat)
            }
        case .automations:
            AutomationsSheet()
        }
    }
}
