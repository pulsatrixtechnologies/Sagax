// The Library tab's data on the phone and the iPad: the conversation's files
// and the bot's artifacts, and the pin on either. A pin shows at once; the
// server keeps it, and a refusal puts it back.
import CompanionCore
import SwiftUI

@MainActor
final class BotLibraryModel: ObservableObject {
    /// nil until the first load answers.
    @Published var files: [ThreadFile]?
    @Published var artifacts: [BotArtifact] = []
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
    }

    func groups(now: Date = Date()) -> LibraryGroups {
        LibraryRules.groups(files: files ?? [], artifacts: artifacts, now: now.timeIntervalSince1970 * 1000)
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
