// A room's goal (matrix RM11; Composer.tsx goal chip): "+" > Goal puts the
// composer in goal mode the phone's way, a leading "/goal ", which
// `goalTextFromComposer` sends as `mode: "goal"` (ChatComposer). Tapping
// Goal again takes it back out, like the desktop chip. The run's receipt is
// the goal card (CA14, Cards/GoalRunCardView.swift).
import CompanionCore
import SwiftUI

extension ChatView {
    func toggleRoomGoal() {
        guard case let .room(room) = current, room.dm != true else { return }
        if let goal = goalTextFromComposer(draft) {
            draft = goal
        } else {
            draft = "/goal " + draft
        }
        composerFocused = true
    }
}
