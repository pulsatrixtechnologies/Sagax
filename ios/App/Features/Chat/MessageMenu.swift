// The long-press menu on a transcript message: reactions, Copy, Select Text,
// then the desktop's message actions (WP1: View Source, Reply, Read Aloud,
// Regenerate, Pin), Edit and retry, and the routed-by line of an Auto room.
// One seam shared by the iPhone's context menu and the iPad's hover row: it
// takes what each action does as closures and decides nothing about layout.
// An action is passed as nil when this message or this pairing cannot do it
// (MessageActionRules, SurfaceGate), and nil hides it: never drawn disabled.
import SwiftUI
import CompanionCore

/// The message actions a row offers, already gated. Built by `MessageRow`.
struct MessageActionSet {
    var reply: (() -> Void)?
    /// View source / hide source; `showingSource` says which.
    var toggleSource: (() -> Void)?
    var showingSource = false
    var speak: (() -> Void)?
    var speaking = false
    var regenerate: (() -> Void)?
    var togglePin: (() -> Void)?
    var pinned = false
    /// An Auto room picked this speaker (RM10).
    var routedBy: RoutedBy?
}

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
    var actions = MessageActionSet()
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
        if let toggle = actions.toggleSource {
            if actions.showingSource {
                Button("Hide Source", systemImage: "eye", action: toggle)
            } else {
                Button("View Source", systemImage: "chevron.left.forwardslash.chevron.right", action: toggle)
            }
        }
        if let reply = actions.reply {
            Button("Reply", systemImage: "arrowshape.turn.up.left", action: reply)
        }
        if let speak = actions.speak {
            if actions.speaking {
                Button("Stop Speaking", systemImage: "stop.fill", action: speak)
            } else {
                Button("Read Aloud", systemImage: "speaker.wave.2", action: speak)
            }
        }
        if let regenerate = actions.regenerate {
            Button("Regenerate", systemImage: "arrow.clockwise", action: regenerate)
        }
        if let togglePin = actions.togglePin {
            if actions.pinned {
                Button("Unpin", systemImage: "pin.slash", action: togglePin)
            } else {
                Button("Pin", systemImage: "pin", action: togglePin)
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
        if let routedBy = actions.routedBy {
            Section {
                Text("Picked by Jev · \(routedBy.percent)%")
            }
        }
    }
}
