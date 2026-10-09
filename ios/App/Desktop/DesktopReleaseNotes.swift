// Release notes on the large layout (#184; matrix DC21, P2-3): the desktop's
// `ReleaseNotesPrompt.tsx` as a modal over the shell, 520 pt wide at most.
//
// - What's new: once per version after an update, never on a fresh install
//   (`ReleaseNotes.whatsNew`, the desktop's `whatsNewDecision`), with the
//   running version's notes.
// - Release notes (the account menu, above About): the same dialog with a
//   version picker, newest first, the running one marked "(current)", and
//   "Changes since my last version".
//
// Same notes as the phone's account menu page (docs/releases/*.md, bundled
// as "releases"), in the person's language. The desktop also shows the next
// version's notes before it installs; on iOS the App Store and TestFlight
// install updates, so the app shows them after.
import CompanionCore
import SwiftUI

/// The notes bundled in the app, and what the person has seen of them.
enum ReleaseNotesStore {
    /// `seenReleaseRecord` (`sagax.releaseNotes.seen.v1` on the desktop); the
    /// phone's first record held the plain version under the same key.
    static let seenKey = "companion.releaseNotes.seen"

    static var catalog: [String: String] {
        guard let folder = Bundle.main.url(forResource: "releases", withExtension: nil) else { return [:] }
        return ReleaseNotes.catalog(in: folder)
    }

    static var current: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    static var record: ReleaseNotesSeen? {
        ReleaseNotesSeen.read(UserDefaults.standard.string(forKey: seenKey))
    }

    /// The version "Changes since my last version" starts after.
    static var lastVersion: String? { record?.lastVersion(before: current) }

    /// The notes of `current` were seen: the version seen before is kept for "since".
    static func markSeen() {
        let next = record?.seeing(current) ?? ReleaseNotesSeen(version: current)
        UserDefaults.standard.set(next.json, forKey: seenKey)
    }

    /// Whether the app had a pairing when it launched (the desktop's
    /// `releaseNotesPriorInstall`): a fresh install has none.
    private(set) static var launchedPaired = false
    private static var captured = false
    private static var decided = false

    /// Called once at launch, before any pairing of this launch.
    static func captureLaunch(paired: Bool) {
        guard !captured else { return }
        captured = true
        launchedPaired = paired
    }

    /// What's new decides once per launch. A parity or UI test launch stays
    /// quiet unless it asks with `-releaseNotesWhatsNew`, which may also set
    /// the version seen before (`-releaseNotesSeen 0.4.10`).
    static func whatsNewOnLaunch(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        guard !decided else { return false }
        decided = true
        let asked = arguments.contains("-releaseNotesWhatsNew")
        if asked, let i = arguments.firstIndex(of: "-releaseNotesSeen"), i + 1 < arguments.count {
            UserDefaults.standard.set(ReleaseNotesSeen(version: arguments[i + 1]).json, forKey: seenKey)
        }
        let test = arguments.contains("-parityEndpoint") || arguments.contains("-uiTesting")
        let seen = record
        let decision = ReleaseNotes.whatsNew(version: current, dev: test && !asked, seen: seen?.version,
                                             previouslyInstalled: launchedPaired || asked)
        if let version = decision.seen, version != seen?.version {
            UserDefaults.standard.set((seen?.seeing(version) ?? ReleaseNotesSeen(version: version)).json, forKey: seenKey)
        }
        return decision.show
    }
}

/// The dialog: What's new (`current`) or Release notes (`browse`).
struct DesktopReleaseNotesModal: View {
    enum Mode { case current, browse }

    @Environment(\.desktopTheme) private var theme
    @Environment(\.locale) private var locale
    let mode: Mode
    let close: () -> Void
    @State private var picked = ReleaseNotesStore.current
    @State private var since = false

    private var language: String { locale.language.languageCode?.identifier ?? "en" }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                AnyView(box)
                    .frame(width: min(520, geometry.size.width - 48))
                    .frame(maxHeight: geometry.size.height - 48)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-release-notes")
    }

    private var box: some View {
        let catalog = ReleaseNotesStore.catalog
        let current = ReleaseNotesStore.current
        var versions = ReleaseNotes.versions(catalog)
        // the running version is always offered, even without its file
        if mode == .browse, !versions.contains(current) { versions.insert(current, at: 0) }
        let previous = ReleaseNotesStore.lastVersion
        let sinceEntries = mode == .browse && previous != nil ? ReleaseNotes.since(previous ?? "", current: current, catalog: catalog) : []
        let shown = mode == .browse ? picked : current
        let notes = catalog[shown].map { ReleaseNotes.section($0, language: language) } ?? ""
        return VStack(alignment: .leading, spacing: 0) {
            Text(mode == .browse ? String(localized: "Release notes") : String(localized: "What's new in \(current)"))
                .font(theme.font(16, .semibold))
                .foregroundStyle(theme.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("release-notes-title")
            if mode == .browse {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(versions, id: \.self) { version in
                            Button(version == current ? String(localized: "\(version) (current)") : version) {
                                picked = version
                                since = false
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(verbatim: picked == current ? String(localized: "\(picked) (current)") : picked)
                            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                        }
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(theme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                    }
                    .accessibilityLabel(Text("Version"))
                    .accessibilityValue(Text(verbatim: picked))
                    .accessibilityIdentifier("release-notes-version")
                    if !sinceEntries.isEmpty, let previous {
                        Button { since.toggle() } label: {
                            Text("Changes since my last version (\(previous))")
                                .font(theme.font(12))
                                .foregroundStyle(since ? Color.white : theme.ink)
                                .padding(.horizontal, 8)
                                .frame(height: 28)
                                .background(since ? theme.accent : theme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(since ? .isSelected : [])
                        .accessibilityIdentifier("release-notes-since")
                    }
                }
                .padding(.top, 12)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if mode == .browse, since {
                        ForEach(sinceEntries.filter { catalog[$0] != nil }, id: \.self) { version in
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Version \(version)").font(theme.font(14, .semibold)).foregroundStyle(theme.ink)
                                MarkdownText(source: ReleaseNotes.section(catalog[version] ?? "", language: language))
                            }
                            .accessibilityIdentifier("release-notes-text.\(version)")
                        }
                    } else if !notes.isEmpty {
                        MarkdownText(source: notes)
                            .accessibilityIdentifier("release-notes-text.\(shown)")
                    } else {
                        Text("Release notes for \(shown) are not in this copy of Sagax.")
                            .font(theme.font(13))
                            .foregroundStyle(theme.inkSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 12)
            Button(action: close) {
                Text("Close")
                    .font(theme.font(13, .medium))
                    .foregroundStyle(theme.ink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 34)
                    .background(theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 16)
            .accessibilityIdentifier("release-notes-close")
        }
        .padding(20)
        .background(theme.elevated)
        .background(theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 25, y: 12)
        .onAppear { ReleaseNotesStore.markSeen() }
    }
}
