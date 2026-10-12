import SwiftUI
import CompanionCore

extension Notification.Name {
    /// "Edit rule" under an approval card: open the bot's Access settings,
    /// where a saved Allow rule is changed or removed. `object` is the bot id.
    static let approvalEditRule = Notification.Name("ca.pulsatrix.sagax.approvalEditRule")
}

/// Under a card answered with Always allow (ApprovalCard.tsx AllowRuleInset):
/// "Added to your Allow rules", the rule in plain words, and Edit rule.
struct AllowRuleInset: View {
    let rule: String
    let botId: String?
    var font: (CGFloat) -> Font = { .system(size: $0) }
    var ink: Color = .primary
    var secondary: Color = .secondary
    var accent: Color = .accentColor
    var surface: Color = Color.secondary.opacity(0.1)

    /// The bot whose rule it is: the card's sender in a room, else the chat's bot.
    static func botId(of message: Message, in chat: Chat) -> String? {
        if case let .bot(bot) = chat { return bot.id }
        return message.from?.botId
    }

    static func ruleText(_ rule: String) -> String {
        guard let action = AllowRuleText.action(of: rule) else { return rule }
        let phrase = ApprovalDock.phrase(action)
        let capitalized = phrase.prefix(1).uppercased() + phrase.dropFirst()
        return String(localized: "\(capitalized), with any details")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Added to your Allow rules")
                .font(font(12.5).weight(.medium))
                .foregroundStyle(ink)
            Text(verbatim: "« \(Self.ruleText(rule)) »")
                .font(font(12.5))
                .foregroundStyle(secondary)
            Button {
                NotificationCenter.default.post(name: .approvalEditRule, object: botId)
            } label: {
                Text("Edit rule").font(font(12.5))
            }
            .buttonStyle(.plain)
            .foregroundStyle(accent)
            .accessibilityIdentifier("allow-rule-edit")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .padding(.top, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("allow-rule-inset")
    }
}
