// The open chat's files (matrix rows BF1, BF3, BF4), as the desktop's bot
// panel Files section shows them (`bot-settings/FilesSection.tsx`): every
// file of the conversation from GET /api/threads/:id/files, newest first,
// with the search, the kind chips and their counts, who sent it, the sort,
// grid or list, and each file's actions: open, download, show in chat and
// copy path. The phone opens it from the profile's Files tab ("This chat");
// the view is layout-agnostic for the iPad's `panel-files`.
import CompanionCore
import SwiftUI
import UIKit

struct ThreadFilesView: View {
    @Environment(\.themePalette) var themePalette
    let threadId: String
    /// Show the file's message in the chat; the host closes what covers it.
    let onShowInChat: (ThreadFile) -> Void

    @EnvironmentObject private var session: Session
    @State private var files: [ThreadFile]?
    @State private var failed = false
    @State private var query = ThreadFileQuery()
    @AppStorage("omb-files-view") private var pickedView = ""
    @State private var previewing: IdentifiedURL?
    @State private var sharing: IdentifiedURL?
    @State private var working: String?
    @State private var status: String?

    private var all: [ThreadFile] { files ?? [] }
    private var counts: [ThreadFileFilter: Int] { ThreadFileRules.counts(all, origin: query.origin, search: query.search) }
    private var chips: [ThreadFileFilter] { ThreadFileRules.visibleFilters(counts: counts, selected: query.filter) }
    /// With no chips on screen the list is never narrowed by a hidden filter.
    private var shown: [ThreadFile] {
        var effective = query
        if chips.isEmpty { effective.filter = .all }
        return ThreadFileRules.visible(all, query: effective)
    }
    /// Grid suits pictures; a chosen view sticks.
    private var grid: Bool {
        if pickedView == "grid" { return true }
        if pickedView == "list" { return false }
        return query.filter == .image || query.filter == .video
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                controls
                content
            }
            .padding(.vertical, 12)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("thread-files")
        }
        .background(Theme.bg)
        .overlay(alignment: .top) {
            // "Path copied", as the profile's own Copied toast
            if let status {
                Text(verbatim: status)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .themeGlass(Capsule(), interactive: false)
                    .padding(.top, 8)
                    .transition(.opacity)
                    .accessibilityIdentifier("thread-files-status")
            }
        }
        .searchable(text: $query.search, prompt: Text("Search files"))
        .navigationTitle(Text("This chat's files"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    pickedView = grid ? "list" : "grid"
                } label: {
                    Image(systemName: grid ? "list.bullet" : "square.grid.2x2")
                }
                .accessibilityLabel(Text(grid ? "List view" : "Grid view"))
                .accessibilityIdentifier("thread-files-view")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $previewing) { item in ProfileQuickLook(url: item.url).ignoresSafeArea() }
        .sheet(item: $sharing) { item in ProfileShareSheet(items: [item.url]) }
    }

    // MARK: Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(chips, id: \.self) { chip in
                            let selected = query.filter == chip
                            Button {
                                Haptics.selection()
                                query.filter = chip
                            } label: {
                                HStack(spacing: 5) {
                                    Text(Self.filterName(chip))
                                    Text(verbatim: "\(counts[chip] ?? 0)")
                                        .monospacedDigit()
                                        .foregroundStyle(selected ? Theme.bg.opacity(0.7) : Theme.textTertiary)
                                }
                                .font(Theme.Profile.labelFont)
                                .foregroundStyle(selected ? Theme.bg : Theme.textSecondary)
                                .padding(.horizontal, 10)
                                .frame(height: 28)
                                .background(selected ? Theme.textPrimary : Theme.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(selected ? Color.clear : Theme.hairline))
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .accessibilityIdentifier("thread-files-chip.\(chip.rawValue)")
                        }
                    }
                    .padding(.horizontal, Theme.Profile.cardMargin)
                }
                .accessibilityLabel(Text("Filter files by type"))
            }
            HStack(spacing: 8) {
                Menu {
                    Picker(String(localized: "Show files from"), selection: $query.origin) {
                        ForEach(ThreadFileOrigin.allCases, id: \.self) { Text(Self.originName($0)).tag($0) }
                    }
                } label: {
                    menuLabel(Self.originName(query.origin), systemImage: "person.2")
                }
                .accessibilityIdentifier("thread-files-origin")
                Menu {
                    Picker(String(localized: "Sort files"), selection: $query.sort) {
                        ForEach(ThreadFileSort.allCases, id: \.self) { Text(Self.sortName($0)).tag($0) }
                    }
                } label: {
                    menuLabel(Self.sortName(query.sort), systemImage: "arrow.up.arrow.down")
                }
                .accessibilityIdentifier("thread-files-sort")
            }
            .padding(.horizontal, Theme.Profile.cardMargin)
        }
    }

    private func menuLabel(_ title: String, systemImage: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage).font(.system(size: 12))
            Text(verbatim: title).lineLimit(1)
            Spacer(minLength: 4)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 10))
        }
        .font(Theme.Profile.labelFont)
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: 34)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: List

    @ViewBuilder private var content: some View {
        if files == nil, !failed {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading files…")
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if files == nil {
            VStack(spacing: 10) {
                Text("Couldn't load this chat's files.")
                Button(String(localized: "Retry")) { Task { await load() } }
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if shown.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "folder")
                Text(verbatim: emptyText).multilineTextAlignment(.center)
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 30)
            .padding(.vertical, 40)
            .accessibilityIdentifier("thread-files-empty")
        } else if grid {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                ForEach(shown) { file in
                    Button { open(file) } label: { tile(file) }
                        .buttonStyle(.plain)
                        .disabled(!file.available)
                        .contextMenu { actions(file) }
                        .accessibilityIdentifier("thread-file.\(file.name)")
                }
            }
            .padding(.horizontal, Theme.Profile.cardMargin)
        } else {
            ProfileCard {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, file in
                    if index > 0 { ProfileDivider() }
                    row(file)
                }
            }
        }
    }

    private var emptyText: String {
        let search = query.search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !search.isEmpty { return String(localized: "Nothing matches “\(search)”") }
        switch chips.isEmpty ? .all : query.filter {
        case .all: return String(localized: "Files you send and files this bot makes in this chat show up here.")
        case .image: return String(localized: "No images in this chat yet.")
        case .video: return String(localized: "No videos in this chat yet.")
        case .audio: return String(localized: "No audio in this chat yet.")
        case .document: return String(localized: "No documents in this chat yet.")
        case .code: return String(localized: "No code files in this chat yet.")
        case .other: return String(localized: "No other files in this chat yet.")
        }
    }

    /// The file (open) beside its actions menu, two separate buttons.
    private func row(_ file: ThreadFile) -> some View {
        HStack(spacing: 0) {
            Button { open(file) } label: {
                HStack(spacing: 0) {
                    ThreadFileThumbnail(threadId: threadId, file: file, size: 34)
                        .frame(width: Theme.Profile.iconColumn, alignment: .center)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: file.name)
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Text(verbatim: meta(file))
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!file.available)
            .contextMenu { actions(file) }
            .accessibilityIdentifier("thread-file.\(file.name)")
            if working == file.id {
                ProgressView().controlSize(.small).padding(.trailing, Theme.Profile.textInset)
            } else {
                Menu { actions(file) } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text("More"))
                .accessibilityIdentifier("thread-file-actions.\(file.name)")
            }
        }
        .frame(minHeight: Theme.Profile.fileRow)
        .opacity(file.available ? 1 : 0.6)
        .contentShape(Rectangle())
    }

    private func tile(_ file: ThreadFile) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ThreadFileThumbnail(threadId: threadId, file: file, size: nil)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(verbatim: file.name).font(Theme.Font.label).foregroundStyle(Theme.textPrimary).lineLimit(1)
            Text(verbatim: file.available ? (file.size.map(Self.size) ?? Self.sourceName(file.source)) : String(localized: "Not on this computer"))
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
        .opacity(file.available ? 1 : 0.6)
    }

    @ViewBuilder
    private func actions(_ file: ThreadFile) -> some View {
        Button(String(localized: "Show in chat"), systemImage: "bubble.left") { onShowInChat(file) }
            .accessibilityIdentifier("thread-file-show")
        Button(String(localized: "Download"), systemImage: "arrow.down.circle") { Task { await fetch(file, share: true) } }
            .disabled(!file.available)
        if let path = ThreadFileRules.copyablePath(of: file) {
            Button(String(localized: "Copy path"), systemImage: "doc.on.doc") { copy(path) }
                .accessibilityIdentifier("thread-file-copy-path")
        }
    }

    // MARK: Actions

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            files = try await client.threadFiles(threadId: threadId)
            failed = false
        } catch {
            failed = true
        }
    }

    private func open(_ file: ThreadFile) {
        guard file.available else { return }
        Task { await fetch(file, share: false) }
    }

    /// The file's bytes into a private temporary folder, then Quick Look
    /// (open) or the share sheet (download).
    private func fetch(_ file: ThreadFile, share: Bool) async {
        guard working == nil, let client = session.profileClient else { return }
        working = file.id
        defer { working = nil }
        do {
            let data = try await client.threadFileData(threadId: threadId, fileId: file.id, preview: false)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("thread-files/\(file.id)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let base = (file.name as NSString).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
            let url = folder.appendingPathComponent(base.isEmpty ? "file-\(file.id)" : base)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            if share { sharing = IdentifiedURL(url: url) } else { previewing = IdentifiedURL(url: url) }
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func copy(_ path: String) {
        withAnimation { status = String(localized: "Path copied") }
        // the pasteboard can stall the main thread (a simulator syncing it
        // with its Mac): write it off the main thread, after the feedback
        Task.detached(priority: .userInitiated) { UIPasteboard.general.string = path }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { status = nil }
        }
    }

    // MARK: Words

    private func meta(_ file: ThreadFile) -> String {
        let when = Date(timeIntervalSince1970: file.at / 1000).formatted(date: .abbreviated, time: .shortened)
        guard file.available else { return "\(String(localized: "Not on this computer")) · \(when)" }
        return [Self.sourceName(file.source), file.size.map(Self.size), when].compactMap { $0 }.joined(separator: " · ")
    }

    static func size(_ bytes: Int) -> String { ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file) }

    static func sourceName(_ source: ThreadFile.Source) -> String {
        switch source {
        case .upload: String(localized: "You sent")
        case .attachment: String(localized: "Bot attached")
        case .link: String(localized: "Bot linked")
        case .written, .unknown: String(localized: "Bot wrote")
        }
    }

    static func filterName(_ filter: ThreadFileFilter) -> String {
        switch filter {
        case .all: String(localized: "All")
        case .image: String(localized: "Images")
        case .video: String(localized: "Videos")
        case .audio: String(localized: "Audio")
        case .document: String(localized: "Documents")
        case .code: String(localized: "Code")
        case .other: String(localized: "Other")
        }
    }

    static func originName(_ origin: ThreadFileOrigin) -> String {
        switch origin {
        case .all: String(localized: "Everyone")
        case .bot: String(localized: "From the bot")
        case .you: String(localized: "From you")
        }
    }

    static func sortName(_ sort: ThreadFileSort) -> String {
        switch sort {
        case .newest: String(localized: "Newest")
        case .name: String(localized: "Name")
        case .size: String(localized: "Size")
        }
    }
}

/// An image file's thumbnail (`preview=1`), or its kind's symbol.
private struct ThreadFileThumbnail: View {
    @Environment(\.themePalette) var themePalette
    let threadId: String
    let file: ThreadFile
    /// Fixed side; nil fills the space it is given.
    let size: CGFloat?

    @EnvironmentObject private var session: Session
    @State private var image: UIImage?

    private var kind: ThreadFileKind { ThreadFileRules.kind(of: file) }

    var body: some View {
        ZStack {
            Theme.inset
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: Self.symbol(kind))
                    .font(.system(size: size.map { $0 * 0.5 } ?? 24))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .task(id: file.id) {
            guard kind == .image, file.available, image == nil, let client = session.profileClient else { return }
            if let data = try? await client.threadFileData(threadId: threadId, fileId: file.id, preview: true) {
                image = UIImage(data: data)
            }
        }
        .accessibilityHidden(true)
    }

    static func symbol(_ kind: ThreadFileKind) -> String {
        switch kind {
        case .image: "photo"
        case .video: "film"
        case .audio: "music.note"
        case .document: "doc.text"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .archive: "doc.zipper"
        case .other: "doc"
        }
    }
}
