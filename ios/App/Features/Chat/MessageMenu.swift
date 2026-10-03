// The long-press menu on a transcript message: reactions, Copy, Select Text,
// Edit and retry. One seam for the message actions the parity packages add
// (reply, regenerate, speak, view source, pin: WP1), shared by the iPhone's
// context menu and the iPad's hover row. Items and order are unchanged from
// the menu that lived inline in ChatView.swift.
import SwiftUI
import CompanionCore

struct MessageMenu: View {
    let message: Message
    let chat: Chat
    /// What Copy and Select Text take: the words, never transport tags.
    let visibleText: String
    /// False for an edit the computer has not answered yet.
    let canReact: Bool
    /// A plain text line of yours with no attachments, not pending.
    let canEdit: Bool
    /// Another edit is in flight on this thread.
    let editDisabled: Bool
    let selectText: (String) -> Void
    let edit: () -> Void
    @EnvironmentObject private var session: Session

    static let reactionChoices = ["👍", "❤️", "😂", "🎉", "👀"]

    var body: some View {
        if canReact {
            ForEach(Self.reactionChoices, id: \.self) { emoji in
                Button(emoji) {
                    Haptics.selection()
                    Task { await session.react(to: message, in: chat.threadId, emoji: emoji) }
                }
            }
        }
        if !visibleText.isEmpty {
            Divider()
            Button("Copy", systemImage: "doc.on.doc") {
                PlatformBridge.copyToPasteboard(visibleText)
            }
        }
        // Copy above takes the whole reply. Selection happens in a sheet
        // because long-press on the bubble already opens this menu.
        if !visibleText.isEmpty {
            Button("Select Text", systemImage: "selection.pin.in.out") {
                selectText(visibleText)
            }
        }
        // An attachment edit cannot faithfully reconstruct the upload.
        // Hiding this action is safer than silently dropping the file or
        // sending its computer-local transport path back as prose.
        if canEdit, case let .bot(bot) = chat {
            Divider()
            Button("Edit and retry", systemImage: "pencil") { edit() }
                .disabled(bot.busy == true || editDisabled)
        }
    }
}
