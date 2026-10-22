// Phone tools on this iPhone (audit row 81, JC 2026-10-21). A bot asks the
// person's own phone for something only it knows; the person approves on
// this phone (Refuser / Toujours permettre / Permettre une fois) and the
// phone runs the iOS call in the foreground. Rules and shaping are in
// CompanionCore (PhoneTools.swift); the iOS calls in PhoneToolRunner.
//
// When the center looks for requests: the stream opened (`streamOpened`),
// the `phone-tools` frame arrived, the app came back on screen. It never
// runs anything while the app is in the background: a push only brings the
// person here. Nothing a tool read is kept: the answer goes to the server
// and is dropped.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class PhoneToolCenter: ObservableObject {
    static let shared = PhoneToolCenter()

    /// The card on screen.
    @Published private(set) var current: PhoneToolRequest?
    private var queue: [PhoneToolRequest] = []
    /// Requests already answered here, so a refresh racing the answer does
    /// not show the same card twice.
    private var answered: Set<String> = []
    private weak var session: Session?
    private var heartbeat: Task<Void, Never>?
    private var presented: UIViewController?

    /// Settings > Phone tools: the tools this person turned off on this phone.
    static let disabledKey = "phoneTools.disabled"

    static var disabled: Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: disabledKey) ?? [])
    }

    static func setEnabled(_ tool: PhoneTool, _ enabled: Bool) {
        var off = disabled
        if enabled { off.remove(tool.rawValue) } else { off.insert(tool.rawValue) }
        UserDefaults.standard.set(Array(off).sorted(), forKey: disabledKey)
    }

    var offered: [PhoneTool] { PhoneToolRules.offered(disabled: Self.disabled) }

    /// The stream is live: say what this phone can do, then look.
    func streamOpened(_ session: Session) {
        guard !session.isDemo else { return }
        self.session = session
        Task { await register() }
        Task { await refresh() }
        heartbeat?.cancel()
        // while the app is open, the server keeps offering the tools
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5 * 60 * 1_000_000_000)
                guard !Task.isCancelled, UIApplication.shared.applicationState == .active else { continue }
                await self?.register()
            }
        }
    }

    /// The person changed a switch in Settings: tell the server now.
    func register() async {
        guard let session else { return }
        let tools = offered
        await session.perform(quietly: true) { client in
            try await client.registerPhoneTools(deviceName: UIDevice.current.name, tools: tools)
        }
    }

    /// The `phone-tools` frame, or the app back on screen.
    func refresh() async {
        guard let session, UIApplication.shared.applicationState == .active else { return }
        var fetched: [PhoneToolRequest] = []
        await session.perform(quietly: true) { client in fetched = try await client.phoneToolRequests() }
        let open = fetched.filter { !answered.contains($0.id) && !PhoneToolRules.isExpired($0) }
        let ids = Set(open.map(\.id))
        // answered or expired elsewhere: the card goes
        if let current, !ids.contains(current.id) { close() }
        queue = open.filter { $0.id != current?.id }
        await next()
    }

    private func next() async {
        guard current == nil, !queue.isEmpty else { return }
        let request = queue.removeFirst()
        let offeredSet = Set(offered)
        if PhoneToolRules.runsWithoutCard(request, appActive: UIApplication.shared.applicationState == .active, offered: offeredSet) {
            // "Toujours permettre" given earlier, the app open: run it now
            await run(request, decision: .always)
            await next()
            return
        }
        current = request
        present(request)
    }

    /// The person's choice on the card. Photos pass the picked images.
    func choose(_ choice: PhoneToolRules.Choice, photos: [Data]? = nil) async {
        guard let request = current else { return }
        close()
        if choice == .deny || request.tool == nil || !offered.contains(request.tool!) {
            await send(request, PhoneToolAnswer.denied)
        } else {
            await run(request, decision: PhoneToolRules.decision(choice), photos: photos)
        }
        await next()
    }

    private func run(_ request: PhoneToolRequest, decision: PhoneToolDecision, photos: [Data]? = nil) async {
        let answer: PhoneToolAnswer
        do {
            let result = try await PhoneToolRunner.run(request, photos: photos)
            answer = PhoneToolAnswer(decision: decision, result: result)
        } catch {
            answer = PhoneToolAnswer(decision: decision, error: error.localizedDescription)
        }
        await send(request, answer)
    }

    private func send(_ request: PhoneToolRequest, _ answer: PhoneToolAnswer) async {
        answered.insert(request.id)
        if answered.count > 200 { answered = [request.id] }
        await session?.perform(quietly: true) { client in
            try await client.answerPhoneTool(id: request.id, answer: answer)
        }
    }

    // MARK: - The card

    private func present(_ request: PhoneToolRequest) {
        guard let top = Self.topViewController() else { return }
        let host = UIHostingController(rootView: PhoneToolCard(request: request).themeOverlay())
        // a question stays until answered: no swipe away, Refuser is the way out
        host.isModalInPresentation = true
        if let sheet = host.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = false
        }
        presented = host
        top.present(host, animated: true)
    }

    private func close() {
        current = nil
        presented?.dismiss(animated: true)
        presented = nil
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}

extension View {
    /// Phone tools: looks for requests when the app comes back on screen.
    func phoneToolsHost(_ session: Session) -> some View { modifier(PhoneToolsHost(session: session)) }
}

private struct PhoneToolsHost: ViewModifier {
    @ObservedObject var session: Session
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.onValueChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await PhoneToolCenter.shared.register()
                await PhoneToolCenter.shared.refresh()
            }
        }
    }
}
