// The quiet centered line a bot-to-bot conversation takes in the chat, at its
// place in time (the desktop's BotConversationLine). Tapping it opens the
// read-only page; nothing here can send.
import SwiftUI
import CompanionCore

struct BotConversationLineView: View {
    let row: BotConversation
    let other: Bot?
    let open: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            Button(action: open) {
                HStack(spacing: 6) {
                    Text("Go to conversation")
                    BotConversationAvatar(bot: other, name: row.otherName, size: 16)
                    Text(row.otherName).fontWeight(.medium)
                    if row.running == true {
                        ProgressView().controlSize(.mini)
                            .accessibilityLabel(Text("Working"))
                    }
                }
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("bot-conversation-line")
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

/// A small avatar for one end of an exchange: the bot's own, else its initial.
struct BotConversationAvatar: View {
    let bot: Bot?
    let name: String
    let size: CGFloat

    var body: some View {
        if let bot {
            BotMascotView(bot: bot, size: size, state: .idle, animated: false)
                .frame(width: size, height: size)
        } else {
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.55, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.secondary.opacity(0.2)))
        }
    }
}

extension ChatView {
    /// One bot-to-bot conversation, drawn as its quiet line.
    func conversationLine(_ row: BotConversation) -> some View {
        BotConversationLineView(row: row, other: session.state.bot(row.otherBotId)) {
            openBotConversation = row
        }
    }
}
