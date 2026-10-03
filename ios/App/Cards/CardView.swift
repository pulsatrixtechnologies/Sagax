// The option card (approvals and plain options). Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import UIKit

/// An option card. When it still has a request behind it, this is the
/// screen the companion exists for — a bot stopped, and only a person can
/// let it continue.
struct CardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session
    @State private var answering = false

    /// The option this card offers that means "go ahead".
    ///
    /// Deliberately not the literal string "Allow". `options` is whatever the
    /// harness sent, and it only falls back to ["Allow", "Deny"] when the
    /// provider event named no choices of its own (`server/index.ts`) — a card
    /// is free to say "Yes", "Approve", "Allow once". Answering with a string
    /// the card never offered writes the grant and then hands the harness a
    /// choice it can reject, so the bot stays stopped with nothing on screen
    /// to explain it. The conventional label wins when it is present, which
    /// keeps the ordinary permission card behaving exactly as before.
    private var allowChoice: String? {
        guard let options = message.card?.options else { return nil }
        return options.first { $0.caseInsensitiveCompare("Allow") == .orderedSame }
            ?? options.first { !Self.isRefusal($0) }
    }

    /// One definition of "the refusal", shared by the button tint and the
    /// choice above so the two cannot drift apart.
    private static func isRefusal(_ option: String) -> Bool { OptionCard.isRefusal(option) }

    private var tint: Color { MausPalette.color(chat.color) }

    var body: some View {
        if let card = message.card {
            VStack(alignment: .leading, spacing: 10) {
                if card.isPending {
                    Label("\(chat.name) is waiting on you", systemImage: "hand.raised.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))
                }
                Text(card.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.attentionText)
                    .fixedSize(horizontal: false, vertical: true)
                if !card.subtitle.isEmpty {
                    Text(card.subtitle)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.attentionSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let skill = card.skillRequest {
                    if let preview = skill.preview, let sha256 = skill.reviewedSha256 {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("Review the complete SKILL.md")
                                    .font(.system(size: 12, weight: .semibold))
                                Spacer()
                                Text("sha256 \(String(sha256.prefix(8)))")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(Theme.attentionSecondary)
                            }
                            Text(skill.source.map { LocalizedStringKey("Source: \($0)") } ?? "Source: unknown")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.attentionSecondary)
                                .textSelection(.enabled)
                            ScrollView(.vertical) {
                                Text(preview)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(Theme.attentionText)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 220)
                            .padding(10)
                            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10))
                        }
                    } else {
                        Label(
                            "This proposal was created by an older build and cannot be safely applied. Deny it and ask the bot to create it again.",
                            systemImage: "exclamationmark.shield"
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.warning)
                    }
                }

                if let held = card.held {
                    Label(held, systemImage: "exclamationmark.shield")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.warning)
                }

                if card.isPending {
                    HStack(spacing: 8) {
                        ForEach(card.options, id: \.self) { option in
                            Button {
                                Haptics.selection()
                                answering = true
                                Task {
                                    await session.answer(chat: chat, card: card, choice: option)
                                    answering = false
                                }
                            } label: {
                                Text(option)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Self.isRefusal(option) ? Theme.attentionText : .white)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 40)
                                    .background(
                                        Capsule().fill(Self.isRefusal(option) ? Theme.cardRaised : Theme.readable(tint))
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(
                                answering ||
                                    (card.skillRequest != nil && !Self.isRefusal(option) &&
                                        card.skillRequest?.reviewedSha256 == nil)
                            )
                        }
                    }
                    .padding(.top, 2)

                    // The grant key comes from the card. The phone never
                    // derives its own, so it cannot permit something subtly
                    // wider than the computer would have. The same goes for
                    // the answer: it is one of the options the card offered,
                    // never a string invented here.
                    if card.allowKey != nil, let allow = allowChoice, case let .bot(bot) = chat {
                        Button("Always allow this tool") {
                            Haptics.selection()
                            answering = true
                            Task {
                                await session.alwaysAllow(bot: bot, card: card)
                                await session.answer(
                                    chat: chat,
                                    card: card,
                                    choice: allow,
                                    rememberingPermission: false
                                )
                                answering = false
                            }
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.attentionSecondary)
                        .frame(maxWidth: .infinity)
                        .disabled(answering)
                    }
                } else if let answered = card.answered {
                    Label(answered, systemImage: "checkmark.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.attentionSecondary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(card.isPending ? Theme.attentionSurface : Theme.card)
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(card.isPending ? tint.opacity(0.08) : Color.clear))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(card.isPending ? tint : .clear, lineWidth: 1.5)
            }
        }
    }
}
