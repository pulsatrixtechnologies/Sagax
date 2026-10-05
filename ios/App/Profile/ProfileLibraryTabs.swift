// The bot's links (`GET /api/bots/:id/links`), the Library tab's Links chip
// in the bot panel: the first page, then "Show more". (The profile's Media
// and Files tabs became the Library's kind chips over the conversation's
// files, as on the desktop.)
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Links (08)

struct LinksTab: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var loader: LibraryLoader<BotLink>
    @State private var opened: IdentifiedURL?

    var body: some View {
        VStack(spacing: 0) {
            if let page = loader.page, !page.items.isEmpty {
                ProfileCard {
                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, link in
                        if index > 0 { ProfileDivider() }
                        Button {
                            Haptics.selection()
                            if let url = link.webURL { opened = IdentifiedURL(url: url) }
                        } label: {
                            linkRow(link)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("profile-link.\(index)")
                    }
                }
                if page.hasMore { ShowMoreButton(loading: loader.loading) { loader.loadMore() } }
            } else {
                LibraryEmptyState(loading: loader.loading || loader.page == nil && loader.problem == nil, problem: loader.problem, empty: Text("No links yet"))
            }
        }
        .sheet(item: $opened) { link in
            CloudDesktopBrowser(url: link.url).ignoresSafeArea()
        }
    }

    private func linkRow(_ link: BotLink) -> some View {
        HStack(spacing: 0) {
            ProfileRowIcon(systemImage: "globe", size: 17.5)
                .frame(width: Theme.Profile.iconColumn, alignment: .leading)
            VStack(alignment: .leading, spacing: 0.9) {
                Text(verbatim: link.domain)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(verbatim: link.url)
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .lineSpacing(0.4)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 12)
            ProfileChevronTrailing()
        }
        .frame(height: Theme.Profile.linkRow)
        .contentShape(Rectangle())
    }
}

// MARK: - Empty

struct LibraryEmptyState: View {
    @Environment(\.themePalette) var themePalette
    let loading: Bool
    let problem: String?
    let empty: Text

    var body: some View {
        ProfileCard {
            HStack {
                if loading {
                    ProgressView().controlSize(.small)
                } else if let problem {
                    Text(verbatim: problem).foregroundStyle(Theme.textSecondary)
                } else {
                    empty.foregroundStyle(Theme.textDisabled)
                }
                Spacer()
            }
            .font(Theme.Font.body)
            .padding(.leading, Theme.Profile.textInset)
            .frame(height: Theme.Profile.singleRow)
        }
        .accessibilityIdentifier("profile-library-empty")
    }
}
