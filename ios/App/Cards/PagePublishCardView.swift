// The card under a bot's propose_page row (message field `pagePublish`;
// the desktop's PagePublishCard in src/components/PublishedPages.tsx). The
// person previews the page, chooses who can see it and until when, then
// publishes or declines it. A public link asks a second press. The
// organization's switch for public links turns that option off here too.
// A page that can no longer be read draws the row's own text.
import CompanionCore
import SwiftUI

struct PagePublishCardView<Fallback: View>: View {
    @EnvironmentObject private var session: Session
    let ref: PagePublishRef
    let accent: Color
    @ViewBuilder let fallback: () -> Fallback
    @Environment(\.desktopChatText) private var desktop
    @State private var page: PublishedPageSummary?
    @State private var missing = false
    @State private var policy = PagesPolicy.default
    @State private var access: PublishedPageAccess = .private
    @State private var hours = 0
    @State private var confirmLink = false
    @State private var busy = false
    @State private var error = ""
    @State private var previewing = false
    @State private var copied = false

    var body: some View {
        if missing {
            fallback()
        } else {
            card
        }
    }

    private var card: some View {
        let ink = ApprovalInk.of(desktop, accent: desktop?.accent ?? accent)
        let state = page.flatMap { PagePublishCardRules.state(page: $0, ref: ref) }
        return VStack(alignment: .leading, spacing: 0) {
            header(ink)
            VStack(alignment: .leading, spacing: 10) {
                if let page {
                    Button { previewing = true } label: {
                        Label(String(localized: "Preview"), systemImage: "eye")
                            .font(ink.font(12.5, .regular))
                            .foregroundStyle(ink.accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("page-card-preview")
                    if state == .proposed { proposed(ink) }
                    if state == .published { published(page, ink) }
                    if state == .declined { note(String(localized: "You declined this version. It will never be published."), ink) }
                    if state == .superseded { note(String(localized: "A newer version of this page is published."), ink) }
                    if PagePublishCardRules.showsRevokedNote(page: page, state: state) {
                        note(String(localized: "This page is no longer published. Its old link no longer works."), ink)
                    }
                } else {
                    ProgressView().controlSize(.small)
                }
                if !error.isEmpty {
                    Text(verbatim: error)
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("page-card-error")
                }
            }
            .padding(12)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .background(desktop?.panel ?? Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ink.hairline.opacity(0.4), lineWidth: 1))
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "Page proposed: \(ref.title)"))
        .accessibilityIdentifier("page-card-\(ref.pageId)")
        .task(id: ref) { await load() }
        .sheet(isPresented: $previewing) {
            PagePreviewSheet(pageID: ref.pageId, version: ref.version)
        }
        .alert(String(localized: "Published pages"), isPresented: $copied) {
            Button(String(localized: "OK"), role: .cancel) {}
        } message: {
            Text(String(localized: "Link copied."))
        }
    }

    // MARK: Parts

    private func header(_ ink: ApprovalInk) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.text").font(.system(size: 12, weight: .medium))
            Text(verbatim: displayTitle)
                .font(ink.font(12, .medium))
                .foregroundStyle(ink.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(String(localized: "Version \(ref.version)")).lineLimit(1)
        }
        .font(ink.font(12, .regular))
        .foregroundStyle(ink.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ink.inset.opacity(0.6))
    }

    private var displayTitle: String {
        let title = (page?.title).flatMap { $0.isEmpty ? nil : $0 } ?? ref.title
        return title.isEmpty ? String(localized: "Page") : title
    }

    @ViewBuilder
    private func proposed(_ ink: ApprovalInk) -> some View {
        note(String(localized: "The bot proposes this page. It is not online: check it, choose who can see it, then publish it."), ink)
        VStack(alignment: .leading, spacing: 6) {
            Text(String(localized: "Who can see"))
                .font(ink.font(12, .medium))
                .foregroundStyle(ink.ink)
            ForEach(PublishedPageAccess.allCases, id: \.self) { option in
                accessRow(option, ink)
            }
        }
        HStack(spacing: 8) {
            Text(String(localized: "Expires"))
                .font(ink.font(12, .medium))
                .foregroundStyle(ink.ink)
            Picker(String(localized: "Expires"), selection: $hours) {
                ForEach(PublishedPageAccess.expiryHours, id: \.self) { value in
                    Text(expiryLabel(value)).tag(value)
                }
            }
            .pickerStyle(.menu)
            .disabled(busy)
            .accessibilityIdentifier("page-card-expiry")
        }
        if confirmLink {
            Text(String(localized: "Anyone with the link will see this page, without signing in. Press again to publish."))
                .font(ink.font(12, .regular))
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("page-card-confirm-link")
        }
        HStack(spacing: 8) {
            Button { publish() } label: {
                HStack(spacing: 6) {
                    if busy { ProgressView().controlSize(.mini).tint(.white) }
                    Text(confirmLink ? String(localized: "Publish for anyone with the link") : String(localized: "Publish"))
                }
                .font(ink.font(13, .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(ink.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .disabled(busy || !PagePublishCardRules.allows(access, policy: policy))
            .opacity(busy ? 0.4 : 1)
            .accessibilityIdentifier("page-card-publish")
            Button { decline() } label: {
                Label(String(localized: "Decline"), systemImage: "xmark.circle")
                    .font(ink.font(13, .regular))
                    .foregroundStyle(ink.ink)
                    .padding(.horizontal, 14)
                    .frame(height: 32)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(ink.hairline.opacity(0.6), lineWidth: 1))
            }
            .disabled(busy)
            .opacity(busy ? 0.4 : 1)
            .accessibilityIdentifier("page-card-decline")
        }
        .buttonStyle(.plain)
    }

    private func accessRow(_ option: PublishedPageAccess, _ ink: ApprovalInk) -> some View {
        let allowed = PagePublishCardRules.allows(option, policy: policy)
        let selected = access == option
        return Button {
            access = option
            confirmLink = false
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 15))
                    .foregroundStyle(selected ? ink.accent : ink.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(accessLabel(option))
                        .font(ink.font(12.5, .regular))
                        .foregroundStyle(ink.ink)
                    Text(allowed ? accessHint(option) : String(localized: "Turned off by your organization."))
                        .font(ink.font(11.5, .regular))
                        .foregroundStyle(ink.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy || !allowed)
        .opacity(allowed ? 1 : 0.5)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("page-card-access-\(option.rawValue)")
    }

    @ViewBuilder
    private func published(_ page: PublishedPageSummary, _ ink: ApprovalInk) -> some View {
        let who = accessLabel(PublishedPageAccess(rawValue: page.access) ?? .private)
        Text(String(localized: "Published. Who can see it: \(who)."))
            .font(ink.font(12, .regular))
            .foregroundStyle(ink.success)
            .accessibilityIdentifier("page-card-published")
        if let url = page.url, RichBlocks.isSafeHttpUrl(url), let link = URL(string: url) {
            HStack(spacing: 12) {
                Link(String(localized: "Open"), destination: link)
                Button(String(localized: "Copy the link")) {
                    UIPasteboard.general.string = url
                    copied = true
                }
            }
            .buttonStyle(.borderless)
            .font(ink.font(12.5, .regular))
        }
    }

    private func note(_ text: String, _ ink: ApprovalInk) -> some View {
        Text(verbatim: text)
            .font(ink.font(12, .regular))
            .foregroundStyle(ink.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func accessLabel(_ access: PublishedPageAccess) -> String {
        switch access {
        case .private: String(localized: "Only me")
        case .org: String(localized: "My organization")
        case .link: String(localized: "Anyone with the link")
        }
    }

    private func accessHint(_ access: PublishedPageAccess) -> String {
        switch access {
        case .private: String(localized: "Only you, signed in to this server.")
        case .org: String(localized: "People signed in to this server.")
        case .link: String(localized: "Anyone who has the link, without signing in.")
        }
    }

    private func expiryLabel(_ hours: Int) -> String {
        switch hours {
        case 24: String(localized: "In 1 day")
        case 24 * 7: String(localized: "In 7 days")
        case 24 * 30: String(localized: "In 30 days")
        default: String(localized: "Never")
        }
    }

    // MARK: Actions

    private func load() async {
        guard let client = session.settingsClient else { return }
        policy = await client.pagesPolicy()
        if !PagePublishCardRules.allows(access, policy: policy) { access = .private }
        do {
            page = try await client.publishedPage(id: ref.pageId)
        } catch {
            missing = true
        }
    }

    private func publish() {
        if PagePublishCardRules.needsLinkConfirm(access, confirmed: confirmLink) {
            confirmLink = true
            return
        }
        let chosen = access
        let until = hours
        act { client in
            try await client.publishPage(id: ref.pageId, version: ref.version, access: chosen, hours: until)
        }
    }

    private func decline() {
        act { client in
            try await client.declinePage(id: ref.pageId, version: ref.version)
        }
    }

    private func act(_ call: @escaping (CompanionClient) async throws -> PublishedPageSummary) {
        guard let client = session.settingsClient else { return }
        Haptics.selection()
        busy = true
        error = ""
        Task {
            do {
                page = try await call(client)
                confirmLink = false
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
