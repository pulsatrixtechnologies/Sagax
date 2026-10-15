// Browser mode of the Computer tab, drawn like the VM's screen (the desktop's
// BrowserComputerScreen and SandboxDesktopModal kind "browser", #473).
//
// The card is a live preview: the same screencast as taking control, asked
// watch-only (`GET /api/bots/:id/browser/live?preview=1`: the server never
// launches the browser for it, streams 5 frames a second and takes only the
// acknowledgements). A closed browser or a failed preview is asked again
// every 10 seconds. Take control opens the browser in a modal on the full
// stream, where taps, drags and the keyboard drive the page
// (`POST /api/bots/:id/browser/action`, BrowserLive.swift). The first touch
// takes the browser from the bot; 8 idle seconds hand it back, as on the
// desktop. While the modal is open the card streams nothing.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - The preview

@MainActor
final class BrowserPreviewModel: ObservableObject {
    enum Phase: Equatable { case connecting, busy, live, offline, error }

    @Published private(set) var phase: Phase = .connecting
    @Published private(set) var image: UIImage?

    /// A closed browser or a failed preview is asked again this often.
    static let retrySeconds: UInt64 = 10

    private let botId: String
    private var provider: @MainActor () -> CompanionClient? = { nil }
    private var loop: Task<Void, Never>?

    init(botId: String) {
        self.botId = botId
    }

    func start(_ provider: @escaping @MainActor () -> CompanionClient?) {
        self.provider = provider
        guard loop == nil else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        image = nil
    }

    /// Error > Retry: ask now rather than at the next 10 seconds.
    func retry() {
        let provider = provider
        stop()
        start(provider)
    }

    private func run() async {
        while !Task.isCancelled {
            phase = .connecting
            image = nil
            var ended: Phase = .error
            if let client = provider() {
                var state = BrowserLiveState()
                do {
                    for try await message in try client.browserLive(botId: botId, preview: true) {
                        if case .offline = message { ended = .offline; break }
                        if case .waiting = message { phase = .busy }
                        guard let seq = state.apply(message) else { continue }
                        if let data = state.image, let picture = UIImage(data: data) {
                            image = picture
                            phase = .live
                        }
                        if let viewer = state.viewerId {
                            try? await client.browserAck(botId: botId, viewerId: viewer, seq: seq)
                        }
                    }
                } catch {}
            }
            if Task.isCancelled { return }
            image = nil
            phase = ended
            try? await Task.sleep(nanoseconds: Self.retrySeconds * 1_000_000_000)
        }
    }

    #if DEBUG
    /// The browser gallery (`-browserGallery`): a state drawn without a stream.
    func show(_ phase: Phase, image: UIImage?) {
        self.phase = phase
        self.image = image
    }
    #endif
}

/// The Computer tab's browser card. Kept under its old name and signature so
/// the three places that draw it (phone, profile sheet, iPad panel) do not move.
struct BrowserLiveView: View {
    let bot: Bot
    let secondary: Color
    let track: Color

    var body: some View {
        BrowserComputerScreen(botId: bot.id, botName: bot.name, secondary: secondary, track: track)
    }
}

struct BrowserComputerScreen: View {
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    let botId: String
    let botName: String
    let secondary: Color
    let track: Color
    @StateObject private var preview: BrowserPreviewModel
    @State private var takeover = false
    #if DEBUG
    private var fixture: BrowserPreviewModel.Phase?
    private var fixtureImage: UIImage?
    private var fixtureCover = false
    #endif

    init(botId: String, botName: String, secondary: Color, track: Color) {
        self.botId = botId
        self.botName = botName
        self.secondary = secondary
        self.track = track
        _preview = StateObject(wrappedValue: BrowserPreviewModel(botId: botId))
    }

    #if DEBUG
    init(fixture: BrowserPreviewModel.Phase, image: UIImage?, botName: String, secondary: Color, track: Color,
         takeover: Bool = false, cover: Bool = false) {
        self.init(botId: "gallery", botName: botName, secondary: secondary, track: track)
        self.fixture = fixture
        self.fixtureCover = cover
        self.fixtureImage = image
        _takeover = State(initialValue: takeover)
    }
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(botName)'s browser")
                .font(.system(size: 13))
                .foregroundStyle(secondary)
                .lineLimit(1)
                .truncationMode(.tail)
            ZStack {
                if showsPicture, let image = preview.image {
                    Color.black
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .accessibilityLabel(Text("\(botName)'s browser"))
                    // Watch-only, like the VM's square: one button in the middle takes the wheel.
                    Button { takeover = true } label: {
                        Label("Take control", systemImage: "hand.raised")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .background(Color.black.opacity(0.65), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("browser-take-control")
                } else {
                    track
                    note
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 10, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(showsPicture && preview.image != nil ? "browser-preview" : "browser-idle")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browser-live")
        .onAppear { sync() }
        .onDisappear { preview.stop() }
        .onValueChange(of: scenePhase) { _ in sync() }
        .onValueChange(of: takeover) { _ in sync() }
        .fullScreenCover(isPresented: isGallery && !galleryCover ? .constant(false) : $takeover) {
            BrowserTakeoverWindow(botId: botId, botName: botName, gallery: isGallery) { takeover = false }
                .environmentObject(session)
        }
    }

    private var isGallery: Bool {
        #if DEBUG
        return fixture != nil
        #else
        return false
        #endif
    }

    private var galleryCover: Bool {
        #if DEBUG
        return fixtureCover
        #else
        return false
        #endif
    }

    private var showsPicture: Bool { !takeover && preview.phase == .live }

    /// The preview runs while the card is on screen, the app is active and the
    /// take-control window is closed.
    private func sync() {
        #if DEBUG
        if let fixture {
            preview.show(fixture, image: fixtureImage)
            return
        }
        #endif
        if scenePhase == .active, !takeover {
            preview.start { [weak session] in session?.computerClient }
        } else {
            preview.stop()
        }
    }

    /// What the card says when it shows no picture, and its buttons.
    private var note: some View {
        VStack(spacing: 10) {
            if takeover {
                Image(systemName: "hand.raised").font(.system(size: 20))
                    .foregroundStyle(secondary)
            } else if preview.phase == .connecting || preview.phase == .busy {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "globe").font(.system(size: 22))
                    .foregroundStyle(secondary)
            }
            Text(message)
                .font(.system(size: 13))
                .multilineTextAlignment(.center)
                .foregroundStyle(secondary)
                .padding(.horizontal, 16)
                .accessibilityIdentifier("browser-preview-message")
            if !takeover {
                HStack(spacing: 8) {
                    if preview.phase == .error {
                        noteButton(String(localized: "Retry"), primary: false, id: "browser-preview-retry") { preview.retry() }
                    }
                    if preview.phase == .offline || preview.phase == .error {
                        noteButton(String(localized: "Take control"), primary: preview.phase == .offline, id: "browser-take-control") {
                            takeover = true
                        }
                    }
                }
            }
        }
        .padding(.vertical, 12)
    }

    private var message: String {
        if takeover { return String(localized: "You have control in the large window.") }
        switch preview.phase {
        case .offline: return String(localized: "\(botName)'s browser is closed. It opens at its next task, or take control to open it now.")
        case .error: return String(localized: "The browser preview could not connect.")
        case .busy: return String(localized: "\(botName) is using this browser. The preview appears when it's free…")
        case .connecting, .live: return String(localized: "Connecting to the browser…")
        }
    }

    private func noteButton(_ title: String, primary: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(primary ? Theme.primaryInk : secondary)
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .background(primary ? Theme.primaryFill : secondary.opacity(0.15), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}

// MARK: - Take control

@MainActor
final class BrowserTakeoverModel: ObservableObject {
    @Published private(set) var state = BrowserLiveState()
    @Published private(set) var image: UIImage?
    @Published private(set) var problem: String?
    @Published private(set) var connected = false
    /// This window holds the browser, as far as it knows.
    @Published private(set) var holding = false

    /// Idle time before control goes back to the bot (BROWSER_HAND_BACK_MS).
    static let handBackSeconds: UInt64 = 8

    private let botId: String
    private var provider: @MainActor () -> CompanionClient? = { nil }
    private var loop: Task<Void, Never>?
    private var chain: Task<Void, Never>?
    private var idle: Task<Void, Never>?

    init(botId: String) {
        self.botId = botId
    }

    func start(_ provider: @escaping @MainActor () -> CompanionClient?) {
        self.provider = provider
        guard loop == nil else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    /// Closing the window: hand the browser back and end the stream.
    func stop() {
        idle?.cancel()
        if holding, let viewer = state.viewerId, let client = provider() {
            let botId = botId
            Task { try? await client.browserAction(botId: botId, viewerId: viewer, action: .release) }
        }
        holding = false
        loop?.cancel()
        loop = nil
        connected = false
    }

    private func run() async {
        let delays: [UInt64] = [1, 2, 4, 8, 15]
        var attempt = 0
        while !Task.isCancelled {
            guard let client = provider() else {
                problem = String(localized: "Not connected.")
                return
            }
            do {
                for try await message in try client.browserLive(botId: botId) {
                    attempt = 0
                    if case .ready = message { connected = true; problem = nil }
                    if case let .error(text, _) = message { problem = text }
                    let seq = state.apply(message)
                    // the server took the browser back (the bot, another window, a restart)
                    if case .control = message, !state.owned { holding = false }
                    guard let seq else { continue }
                    if let data = state.image, let picture = UIImage(data: data) { image = picture }
                    if let viewer = state.viewerId {
                        try? await client.browserAck(botId: botId, viewerId: viewer, seq: seq)
                    }
                }
            } catch {
                if Task.isCancelled { return }
                problem = (error as? LocalizedError)?.errorDescription ?? String(localized: "The browser stream was interrupted.")
            }
            connected = false
            holding = false
            if Task.isCancelled { return }
            let delay = delays[min(attempt, delays.count - 1)]
            attempt += 1
            try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
        }
    }

    /// One action on the page, in order behind the ones before it. The first
    /// interaction takes the browser from the bot.
    func send(_ action: BrowserLiveAction) {
        guard connected, let viewer = state.viewerId, let client = provider() else { return }
        let botId = botId
        let previous = chain
        chain = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            do {
                if action.interacts, !self.holding {
                    let waited = try await client.browserAction(botId: botId, viewerId: viewer, action: .take)
                    self.holding = true
                    // the bot's own action finished first: the page may have
                    // moved, so what was aimed at it is dropped
                    if waited {
                        self.problem = String(localized: "The page changed while the bot finished. Try again.")
                        self.scheduleHandBack()
                        return
                    }
                }
                try await client.browserAction(botId: botId, viewerId: viewer, action: action)
                self.problem = nil
            } catch {
                self.problem = (error as? LocalizedError)?.errorDescription ?? String(localized: "The browser stream was interrupted.")
            }
            self.scheduleHandBack()
        }
    }

    /// Take control now (the header's button), without touching the page.
    func take() {
        guard connected, !holding, let viewer = state.viewerId, let client = provider() else { return }
        let botId = botId
        let previous = chain
        chain = Task { [weak self] in
            await previous?.value
            do {
                try await client.browserAction(botId: botId, viewerId: viewer, action: .take)
                self?.holding = true
                self?.problem = nil
            } catch {
                self?.problem = (error as? LocalizedError)?.errorDescription
            }
            self?.scheduleHandBack()
        }
    }

    private func scheduleHandBack() {
        idle?.cancel()
        guard holding else { return }
        idle = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.handBackSeconds * 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.handBack()
        }
    }

    /// Give the browser back to the bot now (Release control, or idle).
    func handBack() {
        idle?.cancel()
        guard holding, let viewer = state.viewerId, let client = provider() else { holding = false; return }
        holding = false
        let botId = botId
        let previous = chain
        chain = Task {
            await previous?.value
            try? await client.browserAction(botId: botId, viewerId: viewer, action: .release)
        }
    }

    #if DEBUG
    func show(image: UIImage?, url: String, holding: Bool) {
        self.image = image
        connected = true
        self.holding = holding
        var state = BrowserLiveState()
        _ = state.apply(.url(url))
        if let image, let data = image.pngData() {
            _ = state.apply(.frame(seq: 1, image: data, width: Int(image.size.width * image.scale),
                                   height: Int(image.size.height * image.scale)))
        }
        self.state = state
    }
    #endif
}

/// The take-control window: the bot's browser over the screen, with the VM
/// window's header (name and state, Release / Take control, close).
struct BrowserTakeoverWindow: View {
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    let botId: String
    let botName: String
    var gallery = false
    let onClose: () -> Void
    @StateObject private var model: BrowserTakeoverModel
    @State private var keyboardUp = false
    @State private var modifiers: Set<ComputerModifier> = []
    @State private var lastDrag: CGSize = .zero

    init(botId: String, botName: String, gallery: Bool = false, onClose: @escaping () -> Void) {
        self.botId = botId
        self.botName = botName
        self.gallery = gallery
        self.onClose = onClose
        _model = StateObject(wrappedValue: BrowserTakeoverModel(botId: botId))
    }

    var body: some View {
        ZStack {
            // the phone's keyboard, for typing into the page (as the VM's full screen)
            RemoteKeyboardField(
                isActive: $keyboardUp,
                showsSpecialKeys: true,
                modifiers: modifiers,
                onInsert: { text in
                    BrowserLiveAction.typed(text).forEach(model.send)
                    modifiers = []
                },
                onDelete: { model.send(.key("Backspace")); modifiers = [] },
                onSpecial: { key in model.send(.special(key)); modifiers = [] },
                onModifier: { modifier in
                    if modifiers.contains(modifier) { modifiers.remove(modifier) } else { modifiers.insert(modifier) }
                }
            )
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .accessibilityHidden(true)
            VStack(spacing: 8) {
                header
                address
                page
                if let problem = model.problem {
                    Text(problem)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("browser-takeover-problem")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(Color.black.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
        .statusBarHidden(true)
        .onAppear { begin() }
        .onDisappear { model.stop() }
        .onValueChange(of: scenePhase) { phase in
            if gallery { return }
            if phase == .active { begin() } else { model.stop() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browser-takeover")
    }

    private func begin() {
        #if DEBUG
        if gallery {
            model.show(image: BrowserGallery.page(), url: "https://exemple.test/rapport", holding: true)
            return
        }
        #endif
        model.start { [weak session] in session?.computerClient }
    }

    private var stateText: String {
        if !model.connected { return String(localized: "Connecting to the browser…") }
        if model.holding { return String(localized: "You have control") }
        return String(localized: "Touch the page to take control")
    }

    private var header: some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(botName)'s browser")
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                Text(stateText)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.65))
                    .lineLimit(1)
                    .accessibilityIdentifier("browser-takeover-state")
            }
            .foregroundStyle(.white)
            Spacer(minLength: 4)
            Button {
                if model.holding { model.handBack() } else { model.take() }
            } label: {
                Text(model.holding ? String(localized: "Hand back control") : String(localized: "Take control"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(Color.white.opacity(0.16), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("browser-takeover-control")
            circle("xmark", label: "Close", id: "browser-takeover-close") {
                model.stop()
                onClose()
            }
        }
    }

    private var address: some View {
        let url = model.state.url
        let shown = URL(string: url)?.host ?? (url.isEmpty ? String(localized: "No page yet") : url)
        return HStack(spacing: 4) {
            circle("chevron.left", label: "Back", id: "browser-back") { model.send(.back) }
            circle("chevron.right", label: "Forward", id: "browser-forward") { model.send(.forward) }
            circle("arrow.clockwise", label: "Reload", id: "browser-reload") { model.send(.reload) }
            HStack(spacing: 6) {
                Image(systemName: url.hasPrefix("https://") ? "lock.fill" : "globe")
                    .font(.system(size: 11, weight: .medium))
                Text(verbatim: shown)
                    .font(.system(size: 12))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .foregroundStyle(Color.white.opacity(0.75))
            .padding(.horizontal, 12)
            .frame(height: 30)
            .frame(maxWidth: .infinity)
            .background(Color.white.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("browser-live-address")
            circle(keyboardUp ? "keyboard.chevron.compact.down" : "keyboard",
                   label: keyboardUp ? "Hide keyboard" : "Keyboard", id: "browser-keyboard") {
                keyboardUp.toggle()
            }
        }
    }

    private var page: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black
                if let image = model.image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .accessibilityLabel(Text("\(botName)'s browser"))
                } else {
                    VStack(spacing: 8) {
                        ProgressView().tint(.white)
                        Text(model.state.waiting ? String(localized: "The bot is using its browser…") : String(localized: "Opening the browser…"))
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.7))
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(
                SpatialTapGesture().onEnded { value in
                    guard let point = map(value.location, in: proxy.size) else { return }
                    model.send(.mouse(event: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1))
                    model.send(.mouse(event: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1))
                }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 8)
                    .onChanged { value in
                        let step = CGSize(width: value.translation.width - lastDrag.width,
                                          height: value.translation.height - lastDrag.height)
                        lastDrag = value.translation
                        guard let point = map(value.startLocation, in: proxy.size) else { return }
                        let scale = pageScale(in: proxy.size)
                        model.send(.mouse(event: "mouseWheel", x: point.x, y: point.y,
                                          deltaX: -Double(step.width) / scale, deltaY: -Double(step.height) / scale))
                    }
                    .onEnded { _ in lastDrag = .zero }
            )
            .accessibilityIdentifier("browser-live-frame")
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func pageScale(in size: CGSize) -> Double {
        let page = model.state.size
        return max(0.01, min(Double(size.width) / Double(max(page.width, 1)), Double(size.height) / Double(max(page.height, 1))))
    }

    private func map(_ point: CGPoint, in size: CGSize) -> (x: Double, y: Double)? {
        guard model.image != nil else { return nil }
        return BrowserPagePoint.map(x: Double(point.x), y: Double(point.y), viewWidth: Double(size.width),
                                    viewHeight: Double(size.height), page: model.state.size)
    }

    private func circle(_ system: String, label: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Color.white.opacity(0.12), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }
}

// MARK: - Gallery

#if DEBUG
/// `-browserGallery <connecting|busy|live|offline|error|takeover|window>`:
/// the card in one state, without a server, for screenshots.
enum BrowserGallery {
    static var requested: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let i = arguments.firstIndex(of: "-browserGallery") else { return nil }
        return i + 1 < arguments.count ? arguments[i + 1] : "live"
    }

    /// A drawn stand-in for a page: a header bar, a title and lines of text.
    static func page() -> UIImage {
        let size = CGSize(width: 1280, height: 800)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let blue = UIColor(red: 0.16, green: 0.36, blue: 0.75, alpha: 1)
            blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: size.width, height: 96))
            let title: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 44), .foregroundColor: UIColor.white]
            ("Rapport trimestriel" as NSString).draw(at: CGPoint(x: 48, y: 22), withAttributes: title)
            UIColor(white: 0.88, alpha: 1).setFill()
            for row in 0..<8 {
                let width = row % 3 == 2 ? 640.0 : 1100.0
                context.fill(CGRect(x: 48, y: 150 + Double(row) * 64, width: width, height: 28))
            }
            blue.setFill()
            context.fill(CGRect(x: 48, y: 690, width: 220, height: 56))
        }
    }
}

struct BrowserGalleryGate<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        if let state = BrowserGallery.requested {
            gallery(state)
        } else {
            content()
        }
    }

    @ViewBuilder
    private func gallery(_ state: String) -> some View {
        if state == "window" {
            // the take-control window, presented over the card as in the app
            ZStack {
                Theme.bg.ignoresSafeArea()
                BrowserComputerScreen(fixture: .live, image: nil, botName: "Ara", secondary: Theme.textSecondary,
                                      track: Theme.card, takeover: true, cover: true)
                    .padding(.horizontal, 16)
            }
        } else {
            ZStack {
                Theme.bg.ignoresSafeArea()
                BrowserComputerScreen(fixture: Self.phase(state), image: state == "live" ? BrowserGallery.page() : nil,
                                      botName: "Ara", secondary: Theme.textSecondary, track: Theme.card,
                                      takeover: state == "takeover")
                    .padding(.horizontal, 16)
            }
        }
    }

    private static func phase(_ state: String) -> BrowserPreviewModel.Phase {
        switch state {
        case "connecting": return .connecting
        case "busy": return .busy
        case "offline": return .offline
        case "error": return .error
        default: return .live
        }
    }
}
#else
struct BrowserGalleryGate<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View { content() }
}
#endif
