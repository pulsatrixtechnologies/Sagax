// Release notes (#184; matrix DC21): the account menu's entry above About
// opens the What's new notes with a version picker (newest first, this
// app's version marked "(current)") and "Changes since my last version".
// Read offline from docs/releases/*.md, bundled in the app as "releases".
// The large layout shows the same notes in its own dialog
// (`DesktopReleaseNotesModal`); both keep the desktop's seen record
// (`ReleaseNotesStore`).
import CompanionCore
import SwiftUI

struct ReleaseNotesPage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    @State private var version = ""
    @State private var since = false

    private var catalog: [String: String] { ReleaseNotesStore.catalog }

    private var current: String { ReleaseNotesStore.current }

    private var language: String {
        locale.language.languageCode?.identifier ?? "en"
    }

    var body: some View {
        let catalog = self.catalog
        let versions = ReleaseNotes.versions(catalog)
        let previous = ReleaseNotesStore.lastVersion
        ThemedList {
            Section {
                Picker(String(localized: "Version"), selection: $version) {
                    ForEach(versions, id: \.self) { item in
                        Text(verbatim: item == current ? String(localized: "\(item) (current)") : item).tag(item)
                    }
                }
                .accessibilityIdentifier("release-notes-version")
                if let previous, !ReleaseNotes.since(previous, current: current, catalog: catalog).isEmpty {
                    Toggle(String(localized: "Changes since my last version"), isOn: $since)
                        .accessibilityIdentifier("release-notes-since")
                }
            }
            let shown = since && previous != nil ? ReleaseNotes.since(previous ?? "", current: current, catalog: catalog) : [version]
            ForEach(shown.filter { catalog[$0] != nil }, id: \.self) { item in
                Section {
                    MarkdownText(source: ReleaseNotes.section(catalog[item] ?? "", language: language))
                        .accessibilityIdentifier("release-notes-text.\(item)")
                } header: {
                    Text(verbatim: "Sagax \(item)")
                }
            }
            if versions.isEmpty {
                Text(String(localized: "No release notes in this build.")).foregroundStyle(Theme.textSecondary)
            }
        }
        .navigationTitle(String(localized: "Release notes"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if version.isEmpty { version = catalog[current] != nil ? current : (versions.first ?? "") }
            ReleaseNotesStore.markSeen()
        }
    }
}
