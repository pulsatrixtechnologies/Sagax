// Share a page (2026-10-28, the desktop's Share popover in
// src/components/PageShare.tsx), the one place a page's sharing is chosen
// on the phone (the open page, the Library, Settings > Published pages):
//   - « Share "<title>" »;
//   - Add people or groups: the organization's people and teams (the
//     directory, an organization server only), invited by principal id or
//     team id (POST /invite, the whole lists);
//   - who has access: the page's person (Owner), then those invited (remove);
//   - General access: People you invite (private), Anyone in your
//     organization (org), Anyone with the link (link, off while the
//     organization turned public links off; switching to it asks a second
//     press);
//   - until when, a newer version not shared yet, Stop sharing;
//   - Copy link and Open in browser.
// A page not shared yet is shared by the person's own gesture here
// (choosing who can see it, adding someone, Copy link, Open in browser):
// the version on screen is published with the access chosen
// (PageShareRules.plan). The person shares their own page with no admin;
// the server checks every rule again.
import CompanionCore
import SwiftUI
import UIKit

struct PageShareSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State var page: PublishedPageSummary
    /// The version on screen: the one a first share publishes.
    let version: Int
    let policy: PagesPolicy
    var onChange: (PublishedPageSummary) -> Void

    @State private var directory: OrgDirectory?
    @State private var query = ""
    @State private var busy = false
    @State private var error: String?
    @State private var pendingLink = false
    @State private var copied = false

    private var organization: Bool { session.surfaceGate.organization }
    private var shared: Bool { page.status == "published" }
    private var invites: PageInvites { page.invites ?? .none }
    private var viewerId: String? { directory?.viewer?.principalId }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if organization { addField }
                    people
                    general
                    if !shared {
                        Text(String(localized: "Not shared yet. Copying the link, opening it or choosing who can see it shares version \(version)."))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        sharedRow
                    }
                    if let error {
                        Text(verbatim: error)
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("page-share-error")
                    }
                    linkButtons
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(String(localized: "Share “\(page.title.isEmpty ? String(localized: "Untitled page") : page.title)”"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Close")) { dismiss() }
                }
                if busy {
                    ToolbarItem(placement: .confirmationAction) { ProgressView().controlSize(.small) }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("page-share-sheet")
        .task {
            if organization { directory = await session.orgDirectory() }
        }
    }

    // MARK: Add people or groups

    private var addField: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField(String(localized: "Add people or groups"), text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(Theme.Font.body)
                .padding(.horizontal, 12)
                .frame(height: 42)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline.opacity(0.6)))
                .disabled(busy)
                .accessibilityIdentifier("page-share-search")
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                let people = personCandidates
                let teams = PageShareRules.teamCandidates(directory?.teams ?? [], invited: invites.teams, query: query, limit: 4)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(people) { person in
                        candidate(name: person.name.isEmpty ? person.login : person.name, detail: person.email, team: false, avatarUrl: person.avatarUrl) {
                            invite(person: true, id: person.principalId, add: true)
                        }
                    }
                    ForEach(teams) { team in
                        candidate(name: team.name, detail: String(localized: "Group · \(team.size) people"), team: true, avatarUrl: nil) {
                            invite(person: false, id: team.id, add: true)
                        }
                    }
                    if directory != nil, people.isEmpty, teams.isEmpty {
                        Text(String(localized: "No one matches."))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .padding(10)
                    }
                }
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline.opacity(0.5)))
            }
        }
    }

    private var personCandidates: [OrgDirectoryPerson] {
        guard let directory else { return [] }
        let active = OrgDirectory(people: directory.people.filter { $0.service != true }, teams: directory.teams)
        return active.candidates(taken: invites.people + (viewerId.map { [$0] } ?? []), query: query, limit: 6)
    }

    private func candidate(name: String, detail: String?, team: Bool, avatarUrl: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                avatar(name: name, team: team)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: name).font(Theme.Font.body).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    if let detail, !detail.isEmpty {
                        Text(verbatim: detail).font(Theme.Font.label).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    private func avatar(name: String, team: Bool) -> some View {
        Circle()
            .fill(Theme.cardRaised)
            .frame(width: 30, height: 30)
            .overlay {
                if team {
                    Image(systemName: "person.2.fill").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                } else {
                    Image(systemName: "person.fill").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityHidden(true)
    }

    // MARK: Who has access

    private var people: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "Who has access"))
                .font(Theme.Font.label.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                avatar(name: ownerName, team: false)
                Text(verbatim: ownerName).font(Theme.Font.body).foregroundStyle(Theme.textPrimary).lineLimit(1)
                Spacer(minLength: 8)
                Text(String(localized: "Owner")).font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
            }
            .accessibilityIdentifier("page-share-owner")
            ForEach(invites.people, id: \.self) { id in
                let person = directory?.people.first { $0.principalId.lowercased() == id.lowercased() }
                let name = person.map { $0.name.isEmpty ? $0.login : $0.name } ?? String(localized: "A person of your organization")
                invitedRow(name: name, team: false) { invite(person: true, id: id, add: false) }
            }
            ForEach(invites.teams, id: \.self) { id in
                let name = directory?.teams.first { $0.id.lowercased() == id.lowercased() }?.name ?? String(localized: "A group of your organization")
                invitedRow(name: name, team: true) { invite(person: false, id: id, add: false) }
            }
        }
    }

    private var ownerName: String {
        if let viewerId, let person = directory?.people.first(where: { $0.principalId.lowercased() == viewerId.lowercased() }), !person.name.isEmpty {
            return person.name
        }
        return String(localized: "You")
    }

    private func invitedRow(name: String, team: Bool, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            avatar(name: name, team: team)
            Text(verbatim: name).font(Theme.Font.body).foregroundStyle(Theme.textPrimary).lineLimit(1)
            Spacer(minLength: 8)
            Button(action: remove) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel(Text(String(localized: "Remove \(name)")))
        }
    }

    // MARK: General access

    private var general: some View {
        let current = PageShareRules.shownAccess(page)
        return VStack(alignment: .leading, spacing: 6) {
            Text(String(localized: "General access"))
                .font(Theme.Font.label.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
            ForEach(PublishedPageAccess.allCases, id: \.self) { access in
                accessRow(access, checked: current == access)
            }
            if pendingLink {
                VStack(alignment: .leading, spacing: 8) {
                    Text(String(localized: "Anyone with the link will see this page, without signing in. Confirm to switch it to a public link."))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        Button(String(localized: "Publish for anyone with the link")) { choose(.link) }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("page-share-confirm-link")
                        Button(String(localized: "Cancel")) { pendingLink = false }
                            .buttonStyle(.bordered)
                    }
                    .font(Theme.Font.label)
                }
                .padding(10)
                .background(Theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            if !policy.linkSharing, page.access == "link", shared {
                Text(String(localized: "Your organization turned off public links: this page is shown only to people signed in to this server until links are allowed again."))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func accessRow(_ access: PublishedPageAccess, checked: Bool) -> some View {
        let off = PageShareRules.isOff(access, page: page, policy: policy)
        return Button { choose(access) } label: {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(checked ? Theme.accent : Theme.cardRaised)
                    .frame(width: 30, height: 30)
                    .overlay(Image(systemName: icon(access)).font(.system(size: 13, weight: .medium)).foregroundStyle(checked ? Color.white : Theme.textSecondary))
                VStack(alignment: .leading, spacing: 1) {
                    Text(label(access)).font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                    Text(off ? String(localized: "Turned off by your organization.") : hint(access))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if checked {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.accent).padding(.top, 7)
                }
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(off || busy)
        .opacity(off ? 0.5 : 1)
        .accessibilityAddTraits(checked ? .isSelected : [])
        .accessibilityIdentifier("page-share-access-\(access.rawValue)")
    }

    private func icon(_ access: PublishedPageAccess) -> String {
        switch access {
        case .private: "lock.fill"
        case .org: "person.2.fill"
        case .link: "globe"
        }
    }

    private func label(_ access: PublishedPageAccess) -> String {
        switch access {
        case .private: organization ? String(localized: "People you invite") : String(localized: "Only me")
        case .org: String(localized: "Anyone in your organization")
        case .link: String(localized: "Anyone with the link")
        }
    }

    private func hint(_ access: PublishedPageAccess) -> String {
        switch access {
        case .private: organization ? String(localized: "Only you and the people or groups you add.") : String(localized: "Only you, signed in to this server.")
        case .org: String(localized: "People signed in to this server.")
        case .link: String(localized: "Anyone who has the link, without signing in.")
        }
    }

    // MARK: Shared page

    private var sharedRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(String(localized: "Expires")).font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                Menu {
                    ForEach(PublishedPageAccess.expiryHours, id: \.self) { hours in
                        Button(expiryLabel(hours)) { run(.expiry(hours: hours)) }
                    }
                } label: {
                    Text(expiryNow).font(Theme.Font.label)
                }
                .disabled(busy)
                .accessibilityIdentifier("page-share-expiry")
            }
            if page.currentVersion != version {
                Button(String(localized: "Share version \(version) instead")) { run(.version) }
                    .font(Theme.Font.label)
                    .disabled(busy)
            }
            Button(role: .destructive) { run(.stop) } label: {
                Label(String(localized: "Stop sharing"), systemImage: "xmark.circle")
            }
            .font(Theme.Font.label)
            .disabled(busy)
            .accessibilityIdentifier("page-share-stop")
            if page.reachable == false {
                Text(String(localized: "Only on this computer's network."))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.warning)
            }
            if let url = page.url {
                Text(verbatim: url)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .accessibilityIdentifier("page-share-url")
            }
        }
    }

    private var expiryNow: String {
        guard let at = page.expiresAt else { return String(localized: "Never") }
        return Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .shortened)
    }

    private func expiryLabel(_ hours: Int) -> String {
        switch hours {
        case 24: String(localized: "In 1 day")
        case 24 * 7: String(localized: "In 7 days")
        case 24 * 30: String(localized: "In 30 days")
        default: String(localized: "Never")
        }
    }

    // MARK: Link

    private var linkButtons: some View {
        HStack(spacing: 10) {
            Button {
                withLink { url in
                    UIPasteboard.general.string = url.absoluteString
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_600_000_000)
                        copied = false
                    }
                }
            } label: {
                Label(copied ? String(localized: "Copied") : String(localized: "Copy link"), systemImage: copied ? "checkmark" : "link")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .background(Theme.cardRaised, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.hairline.opacity(0.6)))
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityIdentifier("page-share-copy")
            Button {
                withLink { openURL($0) }
            } label: {
                Label(String(localized: "Open in browser"), systemImage: "arrow.up.right.square")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .background(Theme.textPrimary, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityIdentifier("page-share-browser")
        }
    }

    // MARK: Actions

    private func choose(_ next: PublishedPageAccess) {
        let current = PageShareRules.shownAccess(page)
        if next == current, shared { return }
        if PageShareRules.needsLinkConfirm(from: shared ? (PublishedPageAccess(rawValue: page.access) ?? .private) : .private, to: next), !pendingLink {
            pendingLink = true
            return
        }
        pendingLink = false
        run(.access(next))
    }

    private func invite(person: Bool, id: String, add: Bool) {
        query = ""
        run(.invites(PageShareRules.withInvite(invites, person: person, id: id, add: add)))
    }

    private func withLink(_ use: @escaping (URL) -> Void) {
        Task {
            guard let next = await perform(.link), let raw = next.url, RichBlocks.isSafeHttpUrl(raw), let url = URL(string: raw) else { return }
            use(url)
        }
    }

    private func run(_ change: PageShareChange) {
        Task { _ = await perform(change) }
    }

    @discardableResult
    private func perform(_ change: PageShareChange) async -> PublishedPageSummary? {
        let steps = PageShareRules.plan(page: page, version: version, change: change)
        if steps.isEmpty { return page }
        guard let client = session.settingsClient else { return nil }
        Haptics.selection()
        busy = true
        error = nil
        defer { busy = false }
        var next: PublishedPageSummary?
        do {
            for step in steps {
                next = try await client.pageStep(id: page.id, step)
            }
            if let next {
                page = next
                onChange(next)
            }
            return next
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }
}
