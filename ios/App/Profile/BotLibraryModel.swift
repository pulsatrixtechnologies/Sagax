// The Library tab's data on the phone and the iPad: the conversation's files,
// the bot's artifacts and the pages it made (2026-10-28), and the pin on any
// of them. A pin shows at once; the server keeps it, and a refusal puts it
// back.
import CompanionCore
import SwiftUI

@MainActor
final class BotLibraryModel: ObservableObject {
    /// nil until the first load answers.
    @Published var files: [ThreadFile]?
    @Published var artifacts: [BotArtifact] = []
    /// This bot's pages (GET /api/pages, filtered by bot).
    @Published var pages: [PublishedPageSummary] = []
    @Published var failed = false

    func load(client: CompanionClient, threadId: String, botId: String, withArtifacts: Bool) async {
        do {
            files = try await client.threadFiles(threadId: threadId)
            failed = false
        } catch {
            failed = true
        }
        // Artifacts are a bonus: a server that does not list them shows files only.
        if withArtifacts { artifacts = (try? await client.botArtifacts(botId: botId)) ?? artifacts }
        // Pages too: a server without them shows the rest.
        if let all = try? await client.publishedPages() { pages = PageLibraryRules.pages(all, botId: botId) }
    }

    func groups(now: Date = Date()) -> LibraryGroups {
        LibraryRules.groups(files: files ?? [], artifacts: artifacts, pages: pages, now: now.timeIntervalSince1970 * 1000)
    }

    /// A page changed elsewhere (Share, a rename): the list follows.
    func replace(_ page: PublishedPageSummary) {
        if let index = pages.firstIndex(where: { $0.id == page.id }) { pages[index] = page }
    }

    /// `DELETE /api/pages/:id`, after the person confirmed.
    func delete(_ page: PublishedPageSummary, client: CompanionClient) async throws {
        try await client.deletePublishedPage(id: page.id)
        pages.removeAll { $0.id == page.id }
    }

    func setPinned(_ entry: LibraryEntry, _ pinned: Bool, client: CompanionClient, threadId: String) async throws {
        switch entry {
        case let .file(file):
            guard let index = files?.firstIndex(where: { $0.id == file.id }) else { return }
            files?[index].pinned = pinned
            do {
                try await client.setThreadFilePin(threadId: threadId, fileId: file.id, pinned: pinned)
            } catch {
                if let back = files?.firstIndex(where: { $0.id == file.id }) { files?[back].pinned = !pinned }
                throw error
            }
        case let .artifact(artifact):
            guard let index = artifacts.firstIndex(where: { $0.id == artifact.id }) else { return }
            artifacts[index].favorite = pinned
            do {
                try await client.setBotArtifactPin(botId: artifact.botId, artifactId: artifact.id, pinned: pinned)
            } catch {
                if let back = artifacts.firstIndex(where: { $0.id == artifact.id }) { artifacts[back].favorite = !pinned }
                throw error
            }
        case let .page(page):
            guard let index = pages.firstIndex(where: { $0.id == page.id }) else { return }
            pages[index].pinned = pinned
            do {
                replace(try await client.setPagePinned(id: page.id, pinned: pinned))
            } catch {
                if let back = pages.firstIndex(where: { $0.id == page.id }) { pages[back].pinned = !pinned }
                throw error
            }
        }
    }
}

/// One artifact opened over the panel: its document in the widget sandbox.
struct BotArtifactSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let artifact: BotArtifact

    @State private var document: BotArtifactDocument?
    @State private var failed = false
    @State private var height: CGFloat = 0

    var body: some View {
        NavigationStack {
            Group {
                if let document {
                    SandboxedWidget(
                        source: RichBlocks.artifactSource(html: document.html, dataJSON: document.dataJSON, dataAt: document.dataAt),
                        dark: Theme.palette.isDark,
                        height: $height
                    ) {}
                    .ignoresSafeArea(edges: .bottom)
                } else if failed {
                    Text("Couldn't open this artifact.")
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(Text(verbatim: artifact.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .task {
            guard let client = session.profileClient else { failed = true; return }
            do {
                document = try await client.botArtifactDocument(botId: artifact.botId, artifactId: artifact.id)
            } catch {
                failed = true
            }
        }
        .accessibilityIdentifier("library-artifact-sheet")
    }
}
