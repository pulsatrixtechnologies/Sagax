// A page in the conversation (message field `pagePublish`, 2026-10-28, the
// desktop's PagePublishCard in src/components/PublishedPages.tsx): a real,
// scaled-down drawing of the top of the page fading out at the bottom, then
// its icon, its title and "Page" with where this version stands (to review,
// shared and with whom, declined, replaced, no longer shared). A tap
// anywhere opens the page over the conversation (PageSurfaceView), where
// Share puts it online and « ⋯ » declines a proposed version. The drawing is
// the same preview as the open page, inert here (no touch, no scroll). A
// page that can no longer be read draws the row's own text.
import CompanionCore
import SwiftUI

struct PagePublishCardView<Fallback: View>: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.openPagePanel) private var openPagePanel
    let ref: PagePublishRef
    /// The conversation the card sits in: its bot and thread, when the page
    /// does not say.
    let botId: String
    let threadId: String
    @ViewBuilder let fallback: () -> Fallback
    @State private var page: PublishedPageSummary?
    @State private var missing = false
    @State private var previewPath: String?
    @State private var openedAlone = false

    static var thumbHeight: CGFloat { 190 }

    var body: some View {
        if missing {
            fallback()
        } else {
            card
        }
    }

    private var theme: PageTheme { Theme.palette.isDark ? .dark : .light }

    private var title: String {
        let known = (page?.title).flatMap { $0.isEmpty ? nil : $0 } ?? ref.title
        return known.isEmpty ? String(localized: "Untitled page") : known
    }

    private var card: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                thumbnail
                HStack(spacing: 10) {
                    PageGlyph(size: 30, corner: 8)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: title)
                            .font(.system(size: 14.5, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Text(verbatim: stateLine)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                            .accessibilityIdentifier("page-card-state")
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 2)
                .padding(.bottom, 12)
            }
            .frame(maxWidth: 420, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline.opacity(0.5), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(page == nil)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(localized: "Page proposed: \(ref.title)")))
        .accessibilityValue(Text(verbatim: stateLine))
        .accessibilityHint(Text(String(localized: "Open the page \(title)")))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("page-card-\(ref.pageId)")
        .task(id: ref) { await load() }
        .fullScreenCover(isPresented: $openedAlone) {
            PageFullScreen(pageId: ref.pageId, version: ref.version, title: title) { page = $0 }
                .environmentObject(session)
        }
    }

    /// The top of the page at half its size, inert, fading into the card.
    private var thumbnail: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                Theme.bg
                if let previewPath,
                   let source = session.pageWebSource(pageId: ref.pageId, previewPath: previewPath, theme: theme, y: 0) {
                    PageWebView(source: source, apiBase: session.pageApiBase, interactive: false, dark: theme == .dark)
                        .frame(width: proxy.size.width * 2, height: Self.thumbHeight * 2)
                        .scaleEffect(0.5, anchor: .topLeading)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                } else {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .frame(height: Self.thumbHeight)
        .clipped()
        .overlay(alignment: .bottom) {
            LinearGradient(colors: [Theme.card.opacity(0), Theme.card], startPoint: .top, endPoint: .bottom)
                .frame(height: 80)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("page-card-thumb")
    }

    /// "Page", then where this version stands.
    private var stateLine: String {
        let label = String(localized: "Page")
        guard let state = PageViewRules.cardState(page: page, version: ref.version), state != .draft else { return label }
        let detail: String
        switch state {
        case .published:
            detail = String(localized: "Shared · \(accessLabel(page?.access ?? "private"))")
        case .proposed:
            detail = String(localized: "Version \(ref.version) to review")
        case .declined:
            detail = String(localized: "Version \(ref.version) declined")
        case .superseded:
            detail = String(localized: "Version \(ref.version), replaced by a newer one")
        case .revoked:
            detail = String(localized: "No longer shared")
        case .draft:
            detail = ""
        }
        return "\(label) · \(detail)"
    }

    private func accessLabel(_ access: String) -> String {
        switch access {
        case "org": String(localized: "My organization")
        case "link": String(localized: "Anyone with the link")
        default: String(localized: "Only me")
        }
    }

    private func open() {
        guard let page else { return }
        Haptics.selection()
        let opened = OpenPageRef(
            pageId: ref.pageId,
            botId: page.botId.isEmpty ? botId : page.botId,
            threadId: page.threadId.isEmpty ? threadId : page.threadId,
            title: title, version: ref.version,
            openedAt: Date().timeIntervalSince1970 * 1000
        )
        if let openPagePanel { openPagePanel(opened) } else { openedAlone = true }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            page = try await client.publishedPage(id: ref.pageId)
        } catch {
            missing = true
            return
        }
        previewPath = (try? await client.pageVersionPreview(id: ref.pageId, version: ref.version))?.previewPath
    }
}
