// The conversation's side of the approval dock (WP2, PendingApproval.tsx
// `PendingApprovalBox`): this thread's open permission asks on the visible
// branch, then the ones its parallel tasks wait on, drawn above the field.
import SwiftUI
import CompanionCore

extension ChatView {
    var dockApprovals: [PendingApproval] {
        ApprovalDockRules.pendingApprovals(messages) + session.parallelApprovals(for: current)
    }

    @ViewBuilder
    var approvalDock: some View {
        let approvals = dockApprovals
        if !approvals.isEmpty {
            ApprovalDock(chat: current, approvals: approvals)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
