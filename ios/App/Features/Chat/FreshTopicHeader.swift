// The top of a fresh topic (Session+FreshTopic.swift): the bot's name and
// what it does, and one discreet "Earlier topics" line that shows the topic
// under it. The bot keeps the whole history either way.
import SwiftUI

struct FreshTopicHeader: View {
    let botName: String
    let description: String?
    let showEarlier: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button(action: showEarlier) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                    Text("Earlier topics")
                        .font(.footnote)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.freshTopic.earlier")
            .accessibilityHint(Text("Shows the previous topic of this conversation"))
            Spacer(minLength: 120)
            VStack(spacing: 6) {
                Text(verbatim: botName)
                    .font(.headline)
                Text(description?.isEmpty == false ? description! : String(localized: "New topic"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 360)
            .accessibilityIdentifier("chat.freshTopic")
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }
}
