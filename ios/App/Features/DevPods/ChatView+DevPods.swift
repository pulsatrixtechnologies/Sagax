import CompanionCore
import SwiftUI

// The chat's side of the development context pods: the detector's
// evaluation as the transcript moves, the header button's visibility, and
// what the sheet or inspector shows.
extension ChatView {
    /// Changes when the thread or its transcript does (one evaluation each).
    var devPodsSignature: String {
        guard devPodsEnabled, case .bot = current else { return "" }
        let list = messages
        return "\(threadId)|\(list.count)|\(list.last?.id ?? "")"
    }

    /// The header button: Experimental on, a bot conversation, and the
    /// detector says development work (or the pods are open).
    var devPodsAvailable: Bool {
        guard devPodsEnabled, case .bot = current else { return false }
        return devMode.active || showingDevPods
    }

    /// One evaluation of the hysteresis; a new thread starts from off.
    func evaluateDevPods() {
        guard devPodsEnabled, case let .bot(bot) = current else {
            if devMode != .off { devMode = .off }
            return
        }
        var state = devModeThread == threadId ? devMode : .off
        devModeThread = threadId
        let task = bot.tasks?.first { $0.threadId == threadId }
        let place = WorkPlace.effective(botComputer: bot.computer, taskSurface: task?.surface)
        let screen = messages.suffix(DevDetector.window).contains { $0.kind == .screen }
        let computerActive = screen && (place == "cloud" || place == "vm" || place == "local")
        state = DevDetector.step(state, score: DevDetector.signals(messages, computerActive: computerActive).score)
        if state != devMode { devMode = state }
    }

    func openDevPods() {
        dictation.stop()
        showingDevPods.toggle()
    }

    @ViewBuilder
    var devPodsContent: some View {
        if case let .bot(bot) = current {
            DevPodsView(
                input: DevPodsInput(bot: bot, task: bot.tasks?.first { $0.threadId == threadId }, messages: messages),
                openComputer: { openPanel(.computerButton) },
                showMessage: { messageId in
                    let thread = threadId
                    Task { await session.jump(to: messageId, inThread: thread) }
                },
                close: { showingDevPods = false }
            )
            .environmentObject(session)
        }
    }
}
