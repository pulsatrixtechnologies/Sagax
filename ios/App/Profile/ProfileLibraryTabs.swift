// The profile's Links, Media and Files tabs (references 08, 09, 10). Each
// pages through its own server route (`GET /api/bots/:id/links`,
// `GET /api/bots/:id/files?kind=`), shows the first page the reference shows
// and "Show more" after it.
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

// MARK: - Media (09)

struct MediaTab: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var loader: LibraryLoader<BotLibraryFile>
    @State private var viewing: BotLibraryFile?

    private let columns = [
        GridItem(.fixed(Theme.Profile.mediaTile), spacing: Theme.Profile.mediaGap),
        GridItem(.fixed(Theme.Profile.mediaTile), spacing: Theme.Profile.mediaGap),
    ]

    var body: some View {
        VStack(spacing: 0) {
            if let page = loader.page, !page.items.isEmpty {
                LazyVGrid(columns: columns, spacing: Theme.Profile.mediaGap) {
                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, file in
                        Button {
                            Haptics.selection()
                            viewing = file
                        } label: {
                            LibraryThumbnail(file: file)
                                .frame(width: Theme.Profile.mediaTile, height: Theme.Profile.mediaTile)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: file.name))
                        .accessibilityIdentifier("profile-media.\(index)")
                    }
                }
                if page.hasMore { ShowMoreButton(loading: loader.loading) { loader.loadMore() }.padding(.top, 0.3) }
            } else {
                LibraryEmptyState(loading: loader.loading || loader.page == nil && loader.problem == nil, problem: loader.problem, empty: Text("No media yet"))
            }
        }
        .fullScreenCover(item: $viewing) { file in
            MediaViewer(file: file)
        }
    }
}

/// A thumbnail through the authenticated preview route.
struct LibraryThumbnail: View {
    @Environment(\.themePalette) var themePalette
    let file: BotLibraryFile
    @EnvironmentObject private var session: Session
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.card
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "photo").font(.system(size: 22)).foregroundStyle(Theme.textTertiary)
            }
        }
        .task(id: file.id) {
            guard image == nil, let client = session.profileClient else { return }
            if let data = try? await client.botFileData(file, preview: true) { image = UIImage(data: data) }
        }
    }
}

/// One image, full screen, at its full size.
struct MediaViewer: View {
    @Environment(\.themePalette) var themePalette
    let file: BotLibraryFile
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var failed = false
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            Group {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .gesture(MagnificationGesture().onChanged { scale = max(1, min(4, $0)) }.onEnded { _ in
                            withAnimation(.spring()) { if scale < 1.05 { scale = 1 } }
                        })
                        .accessibilityIdentifier("media-viewer-image")
                } else if failed {
                    Text("This image could not be loaded.").foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Close") { dismiss() }
                .padding(.leading, Theme.Metric.screenEdge)
                .padding(.top, 6)
                .accessibilityIdentifier("media-viewer-close")
        }
        .task {
            guard let client = session.profileClient else { failed = true; return }
            do { image = UIImage(data: try await client.botFileData(file, preview: false)) } catch { failed = true }
            if image == nil { failed = true }
        }
    }
}

// MARK: - Files (10)

struct FilesTab: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var loader: LibraryLoader<BotLibraryFile>
    @EnvironmentObject private var session: Session
    @State private var previewing: IdentifiedURL?
    @State private var downloading: String?

    var body: some View {
        VStack(spacing: 0) {
            if let page = loader.page, !page.items.isEmpty {
                ProfileCard {
                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, file in
                        if index > 0 { ProfileDivider() }
                        Button {
                            Task { await open(file) }
                        } label: {
                            ProfileRow(
                                icon: ProfileRowIcon(systemImage: "doc.text", size: 16),
                                title: Text(verbatim: file.name),
                                height: Theme.Profile.fileRow
                            ) {
                                if downloading == file.id {
                                    ProgressView().controlSize(.small).padding(.trailing, Theme.Profile.textInset)
                                } else {
                                    ProfileChevronTrailing()
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(!file.available)
                        .accessibilityIdentifier("profile-file.\(index)")
                    }
                }
                if page.hasMore { ShowMoreButton(loading: loader.loading) { loader.loadMore() } }
            } else {
                LibraryEmptyState(loading: loader.loading || loader.page == nil && loader.problem == nil, problem: loader.problem, empty: Text("No files yet"))
            }
        }
        .sheet(item: $previewing) { item in
            ProfileQuickLook(url: item.url).ignoresSafeArea()
        }
    }

    /// Download into a private temporary folder under the file's own name,
    /// then hand it to Quick Look.
    private func open(_ file: BotLibraryFile) async {
        guard downloading == nil, let client = session.profileClient else { return }
        downloading = file.id
        defer { downloading = nil }
        do {
            let data = try await client.botFileData(file, preview: false)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("bot-files/\(file.id)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(file.localFileName)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            previewing = IdentifiedURL(url: url)
        } catch {
            session.actionError = error.localizedDescription
        }
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
