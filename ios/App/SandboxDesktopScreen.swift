// The person's server-environment desktop on an organization server
// (`SandboxDesktopView.tsx` + `ServerComputerScreen` in OrgComputerTab.tsx).
// POST /api/bots/:id/computer/screenshot answers 409 org_user_sandbox; this
// uses GET /api/desktop-viewer/sandbox/me and a native WebSocket (no Origin)
// into bundled noVNC, plus POST /api/me/server-environment/power.
import CompanionCore
import SwiftUI
import WebKit

struct SandboxDesktopScreen: View {
    let botName: String
    var ink: Color = Theme.textPrimary
    var secondary: Color = Theme.textSecondary
    var card: Color = Theme.card

    @EnvironmentObject private var session: Session
    @State private var pending: ServerEnvironmentPowerAction?
    @State private var error: String?
    @State private var confirmAction: ServerEnvironmentPowerAction?
    /// The viewer, control/full-screen mode and environment status outlive
    /// this view: the iPad bot panel is rebuilt on rotation and Split View
    /// resizes, and a rebuild must not drop full screen or reconnect.
    @ObservedObject private var store = SandboxDesktopStore.shared
    @ObservedObject private var viewer = SandboxDesktopStore.shared.viewer
    #if DEBUG
    /// Once per launch, not per screen: the iPad panel rebuilds this
    /// screen on rotation, and a fresh screen must not take control again.
    private static var parityApplied = false
    #endif

    private var mode: SandboxDesktopMode { store.mode }
    private var status: ServerEnvironmentStatus? { store.status }
    private var control: Bool { mode.control }
    private var viewState: String { store.viewState }

    private var power: String {
        if pending == .start || pending == .resume { return "starting" }
        switch status?.state {
        case "running": return "running"
        case "paused": return "paused"
        case "missing", "stopped": return "off"
        default: return status == nil ? "starting" : "unavailable"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(botName)'s screen")
                .font(.system(size: 13))
                .foregroundStyle(secondary)
            ZStack {
                card
                // The one web view lives here until full screen takes it.
                SandboxDesktopHost(session: viewer, active: !mode.fullScreen)
                    .opacity(viewer.rfbReady ? 1 : 0)
                if !viewer.rfbReady {
                    VStack(spacing: 8) {
                        if viewState == "connecting" || power == "starting" {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "display").font(.system(size: 22))
                        }
                        Text(verbatim: message)
                            .font(.system(size: 13))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(secondary)
                            .padding(.horizontal, 16)
                    }
                }
                if viewer.rfbReady, !control {
                    Button {
                        send(.takeControl)
                    } label: {
                        Text("Take control")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(height: 36)
                            .background(Color.black.opacity(0.65), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("sandbox-take-control")
                }
                if viewer.rfbReady {
                    Button {
                        send(.enterFullScreen)
                    } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(Color.black.opacity(0.65), in: Circle())
                            .padding(8)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .accessibilityLabel(Text("Full screen"))
                    .accessibilityIdentifier("sandbox-full-screen")
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 10, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            HStack(spacing: 12) {
                if power == "off" {
                    powerButton("play.fill", "Start", .start)
                }
                if power == "paused" {
                    powerButton("play.fill", "Resume", .resume)
                }
                if power == "running" {
                    powerButton("pause.fill", "Pause", .pause)
                    powerButton("stop.fill", "Stop", .shutdown)
                }
                Spacer(minLength: 0)
                if control {
                    Button(String(localized: "Release control")) { send(.releaseControl) }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(ink)
                        .accessibilityIdentifier("sandbox-release-control")
                }
            }
            if let error {
                Text(verbatim: error)
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
            }
        }
        .task {
            // The first load connects through the power change below. Coming
            // back to the screen (from full screen too) re-runs this: keep a
            // live stream, reconnect only a dropped one.
            store.client = session.computerClient
            let wasRunning = power == "running"
            await load()
            if wasRunning, power == "running", !viewer.isStreaming { await connect() }
        }
        .onValueChange(of: power) { next in
            // A rebuilt screen finds the stream live: keep it.
            if next == "running" { if !viewer.isStreaming { Task { await connect() } } }
            else { viewer.stop(); store.viewState = "idle"; send(.desktopLost) }
        }
        #if DEBUG
        .onValueChange(of: viewer.rfbReady) { ready in applyParity(ready) }
        #endif
        // A full-screen cover takes the presenting screen off the window:
        // that is not leaving the desktop.
        .onAppear {
            store.keyboardOnOpen = parityKeyboard
            store.mount()
        }
        // Stops only when no screen shows the desktop and full screen is
        // closed: a full-screen cover or a rebuild is not leaving it.
        .onDisappear { store.unmount() }
        .confirmationDialog(
            String(localized: "A bot is working on this desktop. Stop it anyway?"),
            isPresented: Binding(get: { confirmAction != nil }, set: { if !$0 { confirmAction = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Stop anyway"), role: .destructive) {
                if let action = confirmAction { Task { await act(action, confirm: true) } }
            }
            Button(String(localized: "Cancel"), role: .cancel) { confirmAction = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sandbox-desktop")
    }

    private func send(_ event: SandboxDesktopMode.Event) {
        store.client = session.computerClient
        store.send(event)
    }

    #if DEBUG
    /// `-paritySandbox fullscreen|control|keyboard`: the harness opens full
    /// screen (view-only), takes control, or takes control with the keyboard
    /// up once the desktop shows.
    private static let parityArgument: String? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-paritySandbox"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }()

    private func applyParity(_ ready: Bool) {
        guard ready, !Self.parityApplied, let argument = Self.parityArgument else { return }
        Self.parityApplied = true
        send(argument == "fullscreen" ? .enterFullScreen : .takeControl)
    }

    private var parityKeyboard: Bool { Self.parityArgument == "keyboard" }
    #else
    private var parityKeyboard: Bool { false }
    #endif

    private var message: String {
        if let error { return error }
        switch viewState {
        case "connecting": return String(localized: "Starting the desktop…")
        case "closed": return String(localized: "Your server environment is closed.")
        case "busy": return String(localized: "Every server environment slot is in use. Try again in a few minutes.")
        case "outdated": return String(localized: "Your server environment is from before the desktop and a bot is working in it. Try again when the bot is done, or stop the environment (Stop) and show the desktop again: your files in /workspace are kept.")
        case "stopped": return String(localized: "The desktop stopped (your server environment went idle). Show it again to restart it.")
        case "unavailable": return String(localized: "The desktop is not available right now. Try again in a moment.")
        default: break
        }
        if status?.configured == false { return String(localized: "This server has no server environment yet.") }
        if power == "off" { return String(localized: "This bot's computer is off") }
        if power == "starting" { return String(localized: "Starting your bot's computer…") }
        return String(localized: "Bots working for you in your server environment use this desktop for computer use. Only you can see it.")
    }

    private func powerButton(_ system: String, _ label: LocalizedStringKey, _ action: ServerEnvironmentPowerAction) -> some View {
        Button {
            Task { await act(action) }
        } label: {
            Image(systemName: system)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(ink)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(pending != nil)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier("sandbox-power.\(action.rawValue)")
    }

    private func load() async {
        guard let client = session.computerClient else { return }
        do {
            store.status = try await client.serverEnvironment()
            error = nil
        } catch {
            store.status = ServerEnvironmentStatus(configured: true, state: "unavailable")
            self.error = error.localizedDescription
        }
    }

    private func act(_ action: ServerEnvironmentPowerAction, confirm: Bool = false) async {
        guard let client = session.computerClient else { return }
        pending = action
        defer { pending = nil }
        do {
            let next = try await client.powerServerEnvironment(action, confirm: confirm)
            if next == nil {
                confirmAction = action
                return
            }
            store.status = next
            error = nil
            confirmAction = nil
        } catch {
            self.error = String(localized: "Could not change the computer.")
            await load()
        }
    }

    private func connect() async {
        guard power == "running" else { return }
        store.client = session.computerClient
        await store.connect()
    }
}

/// The person's server-environment desktop (one per person: `sandbox/me`),
/// shared by every screen that shows it.
@MainActor
final class SandboxDesktopStore: ObservableObject {
    static let shared = SandboxDesktopStore()

    let viewer = SandboxViewerSession()
    @Published var mode = SandboxDesktopMode() {
        didSet { if mode.fullScreen != oldValue.fullScreen { syncFullScreen() } }
    }
    /// The scene of the window that last showed the desktop inline.
    weak var scene: UIWindowScene?
    var keyboardOnOpen = false
    /// Full screen is its own window over the scene, owned here rather than
    /// a cover presented by a screen: the iPad bot panel is rebuilt on
    /// rotation and Split View resizes, and a cover whose presenter is
    /// rebuilt away stays on screen with its controls dead.
    private var fullScreenWindow: UIWindow?
    @Published var status: ServerEnvironmentStatus?
    @Published var viewState = "idle"
    /// Set by the screen that shows the desktop. Actions from the
    /// full-screen control go through the store, never a screen that a
    /// rebuild may already have removed.
    var client: CompanionClient?
    private var mounted = 0

    /// Control changes reconnect with (or without) the control lease.
    func send(_ event: SandboxDesktopMode.Event) {
        if mode.handle(event), status?.state == "running" {
            Task { await connect() }
        }
    }

    func connect() async {
        guard let client, status?.state == "running" else { return }
        let control = mode.control
        if !viewer.rfbReady { viewState = "connecting" }
        do {
            let config = try await client.sandboxViewer(control: control)
            let request = try client.sandboxViewerSocketRequest(control: control)
            viewer.start(request: request, password: config.password ?? "", viewOnly: config.viewOnly != false && !control)
            viewState = "connected"
        } catch let APIError.status(code, _) {
            viewState = code == 403 || code == 404 ? "closed" : code == 429 ? "busy" : "unavailable"
        } catch {
            viewState = "unavailable"
        }
    }

    func mount() { mounted += 1 }

    private func syncFullScreen() {
        if mode.fullScreen {
            guard fullScreenWindow == nil, let scene = scene ?? Self.activeScene else { return }
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .normal + 1
            let host = UIHostingController(rootView: SandboxFullScreenDesktop(
                store: self, viewer: viewer, startWithKeyboard: keyboardOnOpen
            ))
            host.view.backgroundColor = .black
            window.rootViewController = host
            window.makeKeyAndVisible()
            fullScreenWindow = window
        } else if let window = fullScreenWindow {
            fullScreenWindow = nil
            window.isHidden = true
            window.windowScene?.windows.first { $0 !== window && !$0.isHidden && $0.windowLevel == .normal }?.makeKey()
            // The inline host takes the web view back as it updates; make
            // sure it does even if nothing else changes.
            objectWillChange.send()
        }
    }

    private static var activeScene: UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }

    /// A rebuild mounts the new screen and unmounts the old one in either
    /// order; decide on the next turn of the main loop.
    func unmount() {
        mounted = max(0, mounted - 1)
        DispatchQueue.main.async { [self] in
            guard mounted == 0, !mode.fullScreen else { return }
            viewer.stop()
            if mode.control { mode.handle(.releaseControl) }
        }
    }
}

@MainActor
final class SandboxViewerSession: NSObject, ObservableObject {
    @Published private(set) var rfbReady = false
    /// The one web view, made on first use and kept for the session's life:
    /// full screen moves it between hosts instead of loading a second page,
    /// so the noVNC connection survives entering and leaving full screen.
    private var webView: WKWebView?
    private var bridge: Bridge?
    private var socket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var password = ""
    private var viewOnly = true
    /// Opens noVNC once per socket. SwiftUI re-attaches the web view on
    /// every update; that re-attach must change nothing, or a running
    /// environment loops the main thread until the watchdog kills the app.
    private var gate = SandboxRFBGate()
    private var relay: Relay?
    /// What the server sent before noVNC was open in a loaded page (its
    /// RFB greeting comes first, often before the page finishes loading).
    /// Dropping it stalled the handshake on a black desktop.
    private var early: [String] = []

    /// A socket is open or opening: coming back to the screen keeps it.
    var isStreaming: Bool { socket != nil }

    /// The web view for a host to show. Every host calls this on every
    /// update; only the first call is an event for the gate.
    func hostedView() -> WKWebView {
        if let webView {
            apply(.attached(newView: false))
            return webView
        }
        let bridge = Bridge(owner: self)
        self.bridge = bridge
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "sagaxRfb")
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.scrollView.pinchGestureRecognizer?.isEnabled = false
        view.navigationDelegate = bridge
        if let html = Bundle.main.url(forResource: "sandbox-desktop", withExtension: "html") {
            let access = Bundle.main.url(forResource: "novnc.min", withExtension: "js")?.deletingLastPathComponent()
                ?? html.deletingLastPathComponent()
            view.loadFileURL(html, allowingReadAccessTo: access)
        }
        webView = view
        apply(.attached(newView: true))
        return view
    }

    fileprivate func markHTMLReady() {
        apply(.pageLoaded)
    }

    func start(request: URLRequest, password: String, viewOnly: Bool) {
        stopSocket()
        self.password = password
        self.viewOnly = viewOnly
        early = []
        _ = gate.handle(.socketClosed)
        setReady(false)
        let relay = Relay(owner: self)
        self.relay = relay
        let session = URLSession(configuration: .default, delegate: relay, delegateQueue: .main)
        self.urlSession = session
        let socket = session.webSocketTask(with: request)
        // One RFB update of a full desktop in raw encoding is several MB;
        // past the 1 MB default the receive fails and the socket closes.
        socket.maximumMessageSize = 32 * 1024 * 1024
        self.socket = socket
        socket.resume()
        listen()
    }

    func send(_ data: Data) {
        socket?.send(.data(data)) { _ in }
    }

    /// Keys from the phone keyboard. noVNC ignores them while view-only.
    func sendKeys(_ events: [VNCKeyEvent]) {
        guard !events.isEmpty else { return }
        let list = events.map { "[\($0.keysym),\($0.down ? 1 : 0)]" }.joined(separator: ",")
        js("window.sagaxKeys && window.sagaxKeys([\(list)])")
    }

    func stop() {
        stopSocket()
        early = []
        _ = gate.handle(.socketClosed)
        setReady(false)
        js("window.sagaxClose && window.sagaxClose()")
    }

    /// Callbacks name their socket: a replaced socket (Take control
    /// reconnects) still reports its cancellation afterwards, and that
    /// report closed noVNC on the socket that replaced it.
    fileprivate func handleSocketOpen(_ task: URLSessionWebSocketTask) {
        guard task === socket else { return }
        apply(.socketOpened)
    }

    fileprivate func handleSocketClose(_ task: URLSessionWebSocketTask) {
        guard task === socket else { return }
        _ = gate.handle(.socketClosed)
        setReady(false)
        js("window.sagaxOnClose && window.sagaxOnClose()")
    }

    private func apply(_ event: SandboxRFBGate.Event) {
        guard gate.handle(event) else { return }
        js("window.sagaxOpen(\(jsString(password)), \(viewOnly ? "true" : "false"))")
        js("window.sagaxOnOpen()")
        for message in early { js("window.sagaxOnMessage('\(message)')") }
        early = []
        setReady(true)
    }

    /// Publishes only a change: `@Published` notifies on every assignment,
    /// and each notification re-renders the screen.
    private func setReady(_ ready: Bool) {
        if rfbReady != ready { rfbReady = ready }
    }

    private func stopSocket() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        relay = nil
    }

    private final class Relay: NSObject, URLSessionWebSocketDelegate {
        nonisolated(unsafe) weak var owner: SandboxViewerSession?
        init(owner: SandboxViewerSession) { self.owner = owner }
        func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
            Task { @MainActor in self.owner?.handleSocketOpen(webSocketTask) }
        }
        func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
            Task { @MainActor in self.owner?.handleSocketClose(webSocketTask) }
        }
    }

    /// The page's script messages and load events. Weak, so the web view
    /// (which retains its message handlers) does not keep the session alive.
    private final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var owner: SandboxViewerSession?
        init(owner: SandboxViewerSession) { self.owner = owner }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            owner?.markHTMLReady()
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
            if op == "send", let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) {
                owner?.send(data)
            } else if op == "close" {
                owner?.stop()
            }
        }
    }

    private func listen() {
        guard let task = socket else { return }
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, task === self.socket else { return }
                switch result {
                case .success(.data(let data)):
                    self.receive(data.base64EncodedString())
                    self.listen()
                case .success(.string(let text)):
                    self.receive(Data(text.utf8).base64EncodedString())
                    self.listen()
                case .failure:
                    self.handleSocketClose(task)
                default:
                    self.listen()
                }
            }
        }
    }

    private func receive(_ base64: String) {
        if gate.opened { js("window.sagaxOnMessage('\(base64)')") } else { early.append(base64) }
    }

    private func js(_ script: String) {
        webView?.evaluateJavaScript(script, completionHandler: { _, _ in })
    }

    private func jsString(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "'\(escaped)'"
    }
}

/// Shows the session's web view. Not observed: hosting never depends on the
/// viewer's state, and adopting the view publishes nothing, so an update
/// here can never cause another one.
private struct SandboxDesktopHost: UIViewRepresentable {
    let session: SandboxViewerSession
    /// False while another host (full screen) has the view: leave it there.
    var active = true
    /// Full screen: pinch to zoom, two fingers to pan while zoomed.
    var zoomable = false

    func makeUIView(context: Context) -> SandboxDesktopHostView {
        let host = SandboxDesktopHostView(zoomable: zoomable)
        configure(host)
        return host
    }

    func updateUIView(_ host: SandboxDesktopHostView, context: Context) {
        configure(host)
    }

    private func configure(_ host: SandboxDesktopHostView) {
        let session = session
        host.claim = active ? { [weak host] in host?.adopt(session.hostedView()) } : nil
        if active { host.adopt(session.hostedView()) }
    }
}

/// The web view inside a zooming scroll view. One finger stays with noVNC
/// (tap to click, drag to drag); a pinch zooms here; while zoomed, two
/// fingers pan here. At 1x two fingers reach noVNC, which scrolls.
final class SandboxDesktopHostView: UIView, UIScrollViewDelegate {
    private let scroll = ZoomScrollView()
    private weak var content: WKWebView?
    private var laidOutSize: CGSize = .zero
    /// Takes the web view back when this host enters a window: during a
    /// rebuild the outgoing host may have updated last.
    var claim: (() -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard let window else { return }
        if claim != nil, !(window.rootViewController is UIHostingController<SandboxFullScreenDesktop>) {
            SandboxDesktopStore.shared.scene = window.windowScene
        }
        claim?()
    }

    init(zoomable: Bool) {
        super.init(frame: .zero)
        backgroundColor = .clear
        scroll.delegate = self
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = zoomable ? 4 : 1
        scroll.bouncesZoom = true
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.panGestureRecognizer.minimumNumberOfTouches = 2
        scroll.panGestureRecognizer.isEnabled = false
        scroll.delaysContentTouches = false
        addSubview(scroll)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Takes the web view from wherever it is. A no-op when it is here.
    func adopt(_ web: WKWebView) {
        guard web.superview !== scroll else { return }
        web.removeFromSuperview()
        web.transform = .identity
        scroll.setZoomScale(1, animated: false)
        scroll.addSubview(web)
        content = web
        laidOutSize = .zero
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scroll.frame = bounds
        guard bounds.size != laidOutSize, let content, content.superview === scroll else { return }
        // A new size (rotation, Split View, the keyboard): back to 1x.
        laidOutSize = bounds.size
        scroll.setZoomScale(1, animated: false)
        content.transform = .identity
        content.frame = bounds
        scroll.contentSize = bounds.size
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        content?.superview === scroll ? content : nil
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        scrollView.panGestureRecognizer.isEnabled = scrollView.zoomScale > 1.01
    }
}

/// The web view's own touch recognizers (noVNC handles touches) would
/// otherwise keep the pinch and the two-finger pan from recognizing.
private final class ZoomScrollView: UIScrollView {
    @objc(gestureRecognizer:shouldRecognizeSimultaneouslyWithGestureRecognizer:)
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === pinchGestureRecognizer || gestureRecognizer === panGestureRecognizer
    }
}

/// The desktop edge to edge (within the safe area), with a small floating
/// control: keyboard, release or take control, leave full screen. Drag the
/// control to any corner.
struct SandboxFullScreenDesktop: View {
    @ObservedObject var store: SandboxDesktopStore
    @ObservedObject var viewer: SandboxViewerSession
    var startWithKeyboard = false

    private var control: Bool { store.mode.control }
    private func send(_ event: SandboxDesktopMode.Event) { store.send(event) }

    @State private var keyboardUp = false
    @State private var modifiers: Set<ComputerModifier> = []
    @State private var corner: Alignment = .topTrailing
    @State private var drag: CGSize = .zero
    @State private var chromeVisible = true
    @State private var chromeHideTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { proxy in
            let landscape = proxy.size.width > proxy.size.height
            ZStack(alignment: corner) {
                Color.black.ignoresSafeArea()
                SandboxDesktopHost(session: viewer, zoomable: true)
                    .accessibilityIdentifier("sandbox-full-screen-desktop")
                if !viewer.rfbReady {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                controls
                    .padding(10)
                    .offset(drag)
                    .opacity(showsChrome(landscape: landscape) ? 1 : 0)
                    .animation(.easeInOut(duration: 0.22), value: chromeVisible)
                    .allowsHitTesting(showsChrome(landscape: landscape))
                    .gesture(
                        DragGesture(coordinateSpace: .named("sandbox-full-screen"))
                            .onChanged { drag = $0.translation }
                            .onEnded { value in
                                let size = proxy.size
                                let p = value.location
                                corner = Alignment(
                                    horizontal: p.x < size.width / 2 ? .leading : .trailing,
                                    vertical: p.y < size.height / 2 ? .top : .bottom
                                )
                                drag = .zero
                            }
                    )
                RemoteKeyboardField(
                    isActive: $keyboardUp,
                    showsSpecialKeys: true,
                    modifiers: modifiers,
                    onInsert: { text in
                        viewer.sendKeys(VNCKeys.type(text, modifiers: modifiers))
                        modifiers = []
                    },
                    onDelete: {
                        viewer.sendKeys(VNCKeys.press(VNCKeys.backspace, modifiers: modifiers))
                        modifiers = []
                    },
                    onSpecial: { key in
                        viewer.sendKeys(VNCKeys.press(VNCKeys.keysym(key), modifiers: modifiers))
                        modifiers = []
                    },
                    onModifier: { modifier in
                        if modifiers.contains(modifier) { modifiers.remove(modifier) } else { modifiers.insert(modifier) }
                    }
                )
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .accessibilityHidden(true)
            }
            .coordinateSpace(name: "sandbox-full-screen")
            .contentShape(Rectangle())
            .onTapGesture {
                if landscape, !chromeVisible { revealChrome(landscape: landscape) }
            }
            .onAppear { revealChrome(landscape: landscape) }
            .onValueChange(of: landscape) { revealChrome(landscape: $0) }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .onAppear { if startWithKeyboard, control { keyboardUp = true } }
        .onValueChange(of: control) { held in
            if !held { keyboardUp = false; modifiers = [] }
            else if startWithKeyboard { keyboardUp = true }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sandbox-full-screen-view")
    }

    private func showsChrome(landscape: Bool) -> Bool {
        !landscape || chromeVisible
    }

    private func revealChrome(landscape: Bool) {
        chromeVisible = true
        chromeHideTask?.cancel()
        guard landscape else { return }
        chromeHideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation { chromeVisible = false }
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 2) {
            if control {
                circle(keyboardUp ? "keyboard.chevron.compact.down" : "keyboard",
                       label: keyboardUp ? "Hide keyboard" : "Keyboard",
                       id: "sandbox-full-screen-keyboard") { keyboardUp.toggle() }
                Button { send(.releaseControl) } label: {
                    Text("Release")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Release control"))
                .accessibilityIdentifier("sandbox-full-screen-release")
            } else if viewer.rfbReady {
                Button { send(.takeControl) } label: {
                    Text("Take control")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sandbox-full-screen-take-control")
            }
            circle("arrow.down.right.and.arrow.up.left", label: "Exit full screen",
                   id: "sandbox-full-screen-exit") { send(.exitFullScreen) }
        }
        .padding(2)
        .background(Color.black.opacity(0.6), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 0.5))
    }

    private func circle(_ system: String, label: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }
}
