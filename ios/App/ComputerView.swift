// A bot's computer, live, and driven from the phone (parity 13 and 11).
//
// Black screen, a glass top bar (back, the bot's 24 pt mascot and name, "?"
// for the gestures, "..." for control and view options), the remote screen
// full width at 16:10, and the clipboard and keyboard circles under it.
//
// Watching costs nothing extra: frames come from the event stream while this
// view is on screen (`watchScreen`). Taking control turns the frame into a
// trackpad and the keyboard button into a remote keyboard; while held the
// picture is also refreshed with direct captures, faster than the stream.
// See `ComputerController` for the wire side.
import SwiftUI
import CompanionCore
import UIKit

enum ComputerFit: String { case fit, fill }

struct ComputerView: View {
    let bot: Bot
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @StateObject private var controller: ComputerController
    @State private var keyboardUp = false
    @State private var showingHelp = false
    @State private var confirmingDesktop = false
    @State private var openingDesktop = false
    @State private var desktopURL: URL?
    @AppStorage("companion.computer.fit") private var fitRaw = ComputerFit.fit.rawValue
    @AppStorage("companion.computer.specialKeys") private var specialKeys = false

    init(bot: Bot) {
        self.bot = bot
        _controller = StateObject(wrappedValue: ComputerController(botId: bot.id, client: { nil }))
    }

    private var fit: ComputerFit { ComputerFit(rawValue: fitRaw) ?? .fit }
    private var streamFrame: ScreenFrame? { session.state.screens[bot.id] }
    /// The bot as the stream last described it.
    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var offline: Bool {
        if case .live = session.status { return false }
        return true
    }
    private var canOpenLiveDesktop: Bool {
        current.computer == "cloud" && current.cloudBackend != "vps" && session.canAdminister
    }

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let barCentre = proxy.safeAreaInsets.top + 6 + Theme.Metric.glassLarge / 2
            let frameHeight = width / Theme.Computer.frameAspect
            ZStack(alignment: .top) {
                Theme.bgComputer.ignoresSafeArea()

                VStack(spacing: 0) {
                    topBar
                        .padding(.top, 6)
                    Color.clear.frame(height: barCentre + Theme.Computer.frameTopFromBarCentre
                        - proxy.safeAreaInsets.top - 6 - Theme.Metric.glassLarge)
                    screen(width: width, height: frameHeight)
                    statusLine
                    Spacer(minLength: 0)
                    bottomButtons
                        .padding(.bottom, Theme.Computer.buttonsBottom)
                }

                toast
                    .padding(.top, 6 - (Theme.Computer.toastSize.height - Theme.Metric.glassLarge) / 2)

                RemoteKeyboardField(
                    isActive: $keyboardUp,
                    showsSpecialKeys: specialKeys,
                    modifiers: controller.modifiers,
                    onInsert: { controller.type($0) },
                    onDelete: { controller.deleteBackward() },
                    onSpecial: { controller.special($0) },
                    onModifier: { controller.toggle($0) }
                )
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .accessibilityHidden(true)
            }
            .onAppear { controller.frameWidth = width }
            .onValueChange(of: width) { controller.frameWidth = $0 }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .background(SwipeBackBridge())
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingHelp) { ComputerGestureHelp() }
        .alert(item: $controller.prompt) { prompt in
            switch prompt {
            case .takeControl:
                Alert(
                    title: Text("Take control?"),
                    message: Text("You need control of \(current.name)'s computer to use it. The bot waits while you have it."),
                    primaryButton: .default(Text("Take control")) { Task { await controller.takeControl() } },
                    secondaryButton: .cancel()
                )
            case .heldElsewhere:
                Alert(title: Text("Someone else has control"),
                      message: Text("Another device holds control of this computer. Try again once it is released."))
            case let .message(text):
                Alert(title: Text(text))
            }
        }
        .alert("Open live desktop?", isPresented: $confirmingDesktop) {
            Button("Cancel", role: .cancel) {}
            Button("Open desktop") { Task { await openDesktop() } }
        } message: {
            Text("This gives this device full control of the cloud computer, including anything signed in inside it.")
        }
        .sheet(isPresented: Binding(get: { desktopURL != nil }, set: { if !$0 { desktopURL = nil } })) {
            if let desktopURL {
                CloudDesktopBrowser(url: desktopURL).ignoresSafeArea()
            }
        }
        .onAppear {
            controller.attach { [weak session] in session?.computerClient }
            session.watchScreen(of: bot.id)
            controller.streamFrame(streamFrame?.data)
            controller.appear()
        }
        .onDisappear {
            keyboardUp = false
            controller.disappear()
            session.stopWatchingScreen(of: bot.id)
        }
        .onValueChange(of: streamFrame) { controller.streamFrame($0?.data) }
        .onValueChange(of: controller.phase) { phase in
            if phase != .held { keyboardUp = false }
        }
        .task {
#if DEBUG
            // Parity 13 and 11: in control with the keyboard up; 11 keeps
            // the trackpad toast for its screenshot.
            if let screen = ParityLaunch.current?.screen, screen.opensComputer {
                controller.pinsToast = screen == .computerTrackpadToast
                await controller.takeControl()
                keyboardUp = true
            }
#endif
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 0) {
            GlassCircleButton(
                systemImage: "chevron.left", fill: Theme.Computer.glassFill, accessibilityLabel: "Back",
                glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25)
            ) { dismiss() }
                .accessibilityIdentifier("computer-back")
            BotMascotView(bot: current, size: Theme.Computer.mascot)
                .frame(width: Theme.Computer.mascot, height: Theme.Computer.mascot)
                .padding(.leading, Theme.Computer.mascotLeading)
                .accessibilityHidden(true)
            Text(current.name)
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, Theme.Computer.nameLeading)
            Spacer(minLength: 8)
            GlassCircleButton(
                systemImage: "questionmark", fill: Theme.Computer.glassFill, accessibilityLabel: "Gestures",
                glyphSize: 20, weight: .regular
            ) { showingHelp = true }
                .accessibilityIdentifier("computer-help")
            moreMenu
                .padding(.leading, Theme.Computer.trailingGap)
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .frame(height: Theme.Metric.glassLarge)
    }

    private var moreMenu: some View {
        Menu {
            Section {
                if controller.isHeld {
                    Button { Task { await controller.releaseControl() } } label: {
                        Label("Release control", systemImage: "hand.raised.slash")
                    }
                } else {
                    Button { Task { await controller.takeControl() } } label: {
                        Label("Take control", systemImage: "cursorarrow.rays")
                    }
                    .disabled(controller.noComputer || offline)
                }
            }
            Section {
                Picker(selection: $fitRaw) {
                    Label("Fit", systemImage: "arrow.down.right.and.arrow.up.left").tag(ComputerFit.fit.rawValue)
                    Label("Fill", systemImage: "arrow.up.left.and.arrow.down.right").tag(ComputerFit.fill.rawValue)
                } label: {
                    Text("Picture")
                }
                .pickerStyle(.inline)
                Button { Task { await controller.refreshPicture(silently: false) } } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                Toggle(isOn: $specialKeys) {
                    Label("Special keys", systemImage: "command")
                }
            }
            if canOpenLiveDesktop {
                Section {
                    Button { confirmingDesktop = true } label: {
                        Label("Open live desktop", systemImage: "display")
                    }
                    .disabled(openingDesktop)
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle(), fill: Theme.Computer.glassFill)
        .accessibilityLabel(Text("More"))
        .accessibilityIdentifier("computer-more")
    }

    // MARK: Screen

    private func screen(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            Theme.Computer.frameEmpty
            if let image = controller.image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: fit == .fill ? .fill : .fit)
                    .frame(width: width, height: height)
                    .clipped()
                    .accessibilityLabel(Text("\(current.name)'s computer"))
                    .accessibilityIdentifier("computer-picture")
            } else {
                waiting
            }
            if controller.isHeld {
                pointerIndicator(width: width, height: height)
            }
            TrackpadSurface { controller.handle($0) }
        }
        .frame(width: width, height: height)
        .clipped()
    }

    /// Where the remote pointer is believed to be, inside the picture as drawn.
    private func pointerIndicator(width: CGFloat, height: CGFloat) -> some View {
        let remote = controller.remoteSize
        let scale = fit == .fill
            ? max(width / remote.width, height / remote.height)
            : min(width / remote.width, height / remote.height)
        let drawn = CGSize(width: remote.width * scale, height: remote.height * scale)
        let x = (width - drawn.width) / 2 + drawn.width * controller.pointer.x
        let y = (height - drawn.height) / 2 + drawn.height * controller.pointer.y
        return Image(systemName: "cursorarrow")
            .font(.system(size: 16, weight: .regular))
            .foregroundStyle(Color.white)
            .shadow(color: .black.opacity(0.8), radius: 1.5)
            // The arrow's tip sits on the point.
            .offset(x: 5, y: 7)
            .position(x: x, y: y)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var waiting: some View {
        VStack(spacing: 8) {
            if controller.noComputer {
                Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                    .font(.system(size: 22))
                Text("This bot has no computer")
                    .font(Theme.Font.body)
            } else if offline {
                Text("Offline")
                    .font(Theme.Font.body)
            } else {
                ProgressView().tint(.white)
                Text(current.busy == true || controller.isHeld ? "Waiting for a picture…" : "Nothing to show yet")
                    .font(Theme.Font.body)
            }
        }
        .foregroundStyle(Theme.textSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var statusLine: some View {
        if let notice = controller.notice ?? (offline ? String(localized: "This computer is offline. Reconnecting…") : nil) {
            Text(notice)
                .font(Theme.Font.profileLabel)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .accessibilityIdentifier("computer-notice")
                .onTapGesture { controller.notice = nil }
        }
    }

    // MARK: Bottom

    private var bottomButtons: some View {
        HStack {
            Menu {
                Button { Task { await controller.sendClipboard() } } label: {
                    Label("Send clipboard to computer", systemImage: "arrow.up.doc.on.clipboard")
                }
                Button { Task { await controller.copyComputerClipboard() } } label: {
                    Label("Copy computer clipboard", systemImage: "doc.on.clipboard")
                }
            } label: {
                ClipboardGlyph()
                    .fill(Theme.textPrimary, style: FillStyle(eoFill: true))
                    .frame(width: ClipboardGlyph.size.width, height: ClipboardGlyph.size.height)
                    .frame(width: Theme.Metric.glassSmall, height: Theme.Metric.glassSmall)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .themeGlass(Circle(), fill: Theme.Computer.glassFill)
            .accessibilityLabel(Text("Clipboard"))
            .accessibilityIdentifier("computer-clipboard")
            .disabled(controller.noComputer)

            Spacer()

            Button {
                Haptics.selection()
                toggleKeyboard()
            } label: {
                KeyboardDotsGlyph()
                    .fill(Theme.textPrimary)
                    .frame(width: KeyboardDotsGlyph.size.width, height: KeyboardDotsGlyph.size.height)
                    .frame(width: Theme.Metric.glassSmall, height: Theme.Metric.glassSmall)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .themeGlass(Circle(), fill: Theme.Computer.glassFill)
            .accessibilityLabel(Text(keyboardUp ? "Hide keyboard" : "Keyboard"))
            .accessibilityIdentifier("computer-keyboard")
            .disabled(controller.noComputer)
            .onLongPressGesture { specialKeys.toggle() }
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
    }

    private func toggleKeyboard() {
        if keyboardUp { keyboardUp = false; return }
        if controller.isHeld { keyboardUp = true; return }
        Task {
            await controller.takeControl()
            if controller.isHeld { keyboardUp = true }
        }
    }

    // MARK: Toast

    @ViewBuilder
    private var toast: some View {
        if controller.showsToast {
            HStack(spacing: 0) {
                Image(systemName: "cursorarrow.motionlines")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(Theme.Computer.toastIcon)
                    .frame(width: 16.5, height: 16.5)
                    .padding(.leading, Theme.Computer.toastIconLeading - 1.4)
                Text("Trackpad mode")
                    .font(Theme.Computer.toastFont)
                    .foregroundStyle(Theme.Computer.toastText)
                    .padding(.leading, Theme.Computer.toastLabelGap - 1.4)
                Spacer(minLength: 0)
            }
            .frame(width: Theme.Computer.toastSize.width, height: Theme.Computer.toastSize.height)
            .background(alignment: .leading) {
                // The toast covers "?" and "..." (it grows out of them); the
                // "?" circle melts into the toast's glass, as in the
                // reference: a lighter lens with the glyph showing through.
                ZStack {
                    Circle()
                        .fill(Theme.Computer.toastLens)
                        .frame(width: 44, height: 44)
                        .blur(radius: 1.5)
                    Image(systemName: "questionmark")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(Theme.Computer.toastLensGlyph)
                        .blur(radius: 0.6)
                }
                .offset(x: Theme.Computer.toastLensCentre - 22)
            }
            .background(Theme.Computer.glassFill, in: Capsule())
            .themeGlass(Capsule(), fill: Theme.Computer.glassFill, interactive: false)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, Theme.Computer.toastTrailing)
            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .trailing)))
            .allowsHitTesting(false)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("computer-toast")
        }
    }

    // MARK: Live desktop (admins, cloud Boat)

    @MainActor
    private func openDesktop() async {
        openingDesktop = true
        defer { openingDesktop = false }
        do {
            desktopURL = try await session.cloudDesktop(for: current)
        } catch {
            controller.notice = error.localizedDescription
        }
    }
}

/// "?": what each gesture does.
struct ComputerGestureHelp: View {
    @Environment(\.dismiss) private var dismiss

    private let rows: [(String, LocalizedStringKey, LocalizedStringKey)] = [
        ("hand.point.up.left", "Move", "Slide one finger on the picture to move the pointer. Faster strokes go further."),
        ("hand.tap", "Click", "Tap once. Tap twice to double-click."),
        ("hand.tap.fill", "Right-click", "Tap with two fingers."),
        ("arrow.up.and.down", "Scroll", "Slide two fingers."),
        ("hand.draw", "Drag", "Touch and hold, then move without lifting."),
        ("keyboard", "Type", "The keyboard button sends what you type. Touch and hold it for Esc, Tab, Ctrl, Alt, Cmd and the arrows."),
        ("list.clipboard", "Clipboard", "Send this phone's clipboard to the computer, or copy the computer's."),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(rows, id: \.0) { row in
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: row.0)
                                .font(.system(size: 17))
                                .frame(width: 26)
                                .foregroundStyle(Theme.textSecondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(row.1).font(Theme.Font.bodyMedium)
                                Text(row.2).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } footer: {
                    Text("Take control from the \"...\" menu. While you have it, the bot cannot use its computer.")
                }
            }
            .navigationTitle("Gestures")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
    }
}

// MARK: - Glyphs

/// The clipboard circle's glyph as measured (ink 14 x 17.3): a board with a
/// clip and three bars. Drawn: the system symbol differs between releases.
struct ClipboardGlyph: Shape {
    static let size = CGSize(width: 14, height: 17.3)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.size.width, sy = rect.height / Self.size.height
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        let stroke: CGFloat = 1.35
        let inset = stroke / 2
        var board = Path()
        let left = inset, right = 14 - inset, top: CGFloat = 1.6, bottom = 17.3 - inset, r: CGFloat = 2
        board.move(to: p(2.2, top))
        board.addLine(to: p(left + r, top))
        board.addQuadCurve(to: p(left, top + r), control: p(left, top))
        board.addLine(to: p(left, bottom - r))
        board.addQuadCurve(to: p(left + r, bottom), control: p(left, bottom))
        board.addLine(to: p(right - r, bottom))
        board.addQuadCurve(to: p(right, bottom - r), control: p(right, bottom))
        board.addLine(to: p(right, top + r))
        board.addQuadCurve(to: p(right - r, top), control: p(right, top))
        board.addLine(to: p(11.8, top))
        var path = board.strokedPath(StrokeStyle(lineWidth: stroke * sx, lineCap: .round, lineJoin: .round))
        // The clip, with its hole.
        path.addRoundedRect(in: CGRect(origin: p(3.6, 0), size: CGSize(width: 6.8 * sx, height: 3.4 * sy)),
                            cornerSize: CGSize(width: 1.2 * sx, height: 1.2 * sx), style: .continuous)
        path.addEllipse(in: CGRect(origin: p(6.2, 0.9), size: CGSize(width: 1.6 * sx, height: 1.6 * sx)))
        for y in [8.3, 10.4, 12.5] as [CGFloat] {
            path.addRoundedRect(in: CGRect(origin: p(3.5, y - 0.72), size: CGSize(width: 7 * sx, height: 1.44 * sy)),
                                cornerSize: CGSize(width: 0.72 * sx, height: 0.72 * sy))
        }
        return path
    }
}

/// The keyboard circle's glyph as measured (ink 17.3 x 14): a rounded frame
/// with three dots over two.
struct KeyboardDotsGlyph: Shape {
    static let size = CGSize(width: 17.3, height: 14)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.size.width, sy = rect.height / Self.size.height
        let stroke: CGFloat = 1.35
        let frame = CGRect(x: rect.minX + stroke / 2 * sx, y: rect.minY + stroke / 2 * sy,
                           width: (17.3 - stroke) * sx, height: (14 - stroke) * sy)
        var path = Path(roundedRect: frame, cornerRadius: 2.2 * sx, style: .continuous)
            .strokedPath(StrokeStyle(lineWidth: stroke * sx))
        let d: CGFloat = 2.3
        for (x, y) in [(5.05, 4.9), (8.65, 4.9), (12.25, 4.9), (6.85, 8.6), (10.45, 8.6)] as [(CGFloat, CGFloat)] {
            path.addEllipse(in: CGRect(x: rect.minX + (x - d / 2) * sx, y: rect.minY + (y - d / 2) * sy, width: d * sx, height: d * sy))
        }
        return path
    }
}
