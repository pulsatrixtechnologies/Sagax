// The section header menu (matrix rows SB2, SB4, SB7, SB8) and the prompts
// behind it. On an organization server it is the desktop's OrgSectionMenu
// (New section, Rename, Move up, Move down, Collapse all or Expand all,
// Delete section) over the person's own sections; elsewhere Move up and
// Move down for every pairing, and the team menu (Add bots, Rename team,
// Delete team) for an admin pairing. Menu content only: the phone puts it
// in a header's `.contextMenu`, the iPad desktop sidebar in its own menu.
import CompanionCore
import SwiftUI

@MainActor
final class SidebarSectionActions: ObservableObject {
    enum NameEntry: Identifiable, Equatable {
        /// A new section of the person's own (organization server); with an
        /// item key, the bot or group goes in it once it exists.
        case newPersonal(assigning: String?)
        case renamePersonal(String)
        case renameServer(String)

        var id: String {
            switch self {
            case let .newPersonal(key): "new:\(key ?? "")"
            case let .renamePersonal(name): "rename:\(name)"
            case let .renameServer(name): "server:\(name)"
            }
        }
    }

    enum DeleteTarget: Equatable {
        case personal(String)
        case server(String)

        var name: String {
            switch self {
            case let .personal(name), let .server(name): name
            }
        }
    }

    struct BotsTarget: Identifiable, Equatable {
        var name: String
        var id: String { name }
    }

    @Published var nameEntry: NameEntry?
    @Published var nameDraft = ""
    @Published var deleting: DeleteTarget?
    @Published var editingBots: BotsTarget?
    @Published var error: String?

    func startNew(assigning key: String? = nil) {
        nameDraft = ""
        afterMenu { self.nameEntry = .newPersonal(assigning: key) }
    }

    func startRename(_ name: String, personal: Bool) {
        nameDraft = name
        afterMenu { self.nameEntry = personal ? .renamePersonal(name) : .renameServer(name) }
    }

    func startDelete(_ target: DeleteTarget) {
        afterMenu { self.deleting = target }
    }

    func startEditingBots(_ name: String) {
        afterMenu { self.editingBots = BotsTarget(name: name) }
    }

    /// A prompt asked for from a context menu waits for the menu to finish
    /// closing, or it is dropped with it.
    private func afterMenu(_ present: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            present()
        }
    }

    func commitName(_ session: Session) {
        guard let entry = nameEntry else { return }
        nameEntry = nil
        let model = SidebarPrefsModel.shared
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        switch entry {
        case let .newPersonal(key):
            if let key {
                error = model.assignPersonal(session, key: key, to: name)
            } else {
                error = model.editPersonal(session) { $0.creating(name) }
            }
        case let .renamePersonal(old):
            guard name != old else { return }
            error = model.renamePersonal(session, old, to: name)
        case let .renameServer(old):
            guard name != old else { return }
            Task { _ = await session.renameServerSection(old, to: name) }
        }
    }

    func confirmDelete(_ session: Session) {
        guard let target = deleting else { return }
        deleting = nil
        switch target {
        case let .personal(name):
            SidebarPrefsModel.shared.deletePersonal(session, name)
        case let .server(name):
            Task { _ = await session.deleteServerSection(name) }
        }
    }
}

/// The menu of one home section header (NavigationMenus.section). `name`
/// is nil for the phone's Unassigned buckets (Bots, Group Chats).
struct SidebarSectionMenu: View {
    let name: String?
    let sectionID: String
    let layout: SidebarLayout
    @ObservedObject var actions: SidebarSectionActions
    @ObservedObject var prefs: SidebarPrefsModel
    /// New bot here (a server team): the home's create sheet, set to it.
    var newBotHere: ((String) -> Void)? = nil
    @EnvironmentObject private var session: Session

    var body: some View {
        let ids = layout.sectionIds
        let groups = NavigationMenus.section(SectionMenuContext(
            gate: session.surfaceGate,
            personalSections: layout.personal,
            name: name,
            canMoveUp: name.map { layout.canMove($0, by: -1) } ?? false,
            canMoveDown: name.map { layout.canMove($0, by: 1) } ?? false,
            anyExpanded: ids.contains { !prefs.isCollapsed($0) }
        ), canCreateBotHere: newBotHere != nil)
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { item in
                entry(item, ids: ids)
            }
        }
    }

    @ViewBuilder
    private func entry(_ item: SectionMenuItem, ids: [String]) -> some View {
        switch item {
        case .newSection:
            Button { actions.startNew() } label: { Label(String(localized: "New section…"), systemImage: "plus") }
        case .rename:
            Button { if let name { actions.startRename(name, personal: true) } } label: {
                Label(String(localized: "Rename…"), systemImage: "pencil")
            }
        case .moveUp:
            Button { if let name { prefs.moveSection(session, name, by: -1) } } label: {
                Label(String(localized: "Move up"), systemImage: "arrow.up")
            }
        case .moveDown:
            Button { if let name { prefs.moveSection(session, name, by: 1) } } label: {
                Label(String(localized: "Move down"), systemImage: "arrow.down")
            }
        case .collapseAll:
            Button { prefs.setAllCollapsed(session, ids) } label: {
                Label(String(localized: "Collapse all"), systemImage: "arrow.down.right.and.arrow.up.left")
            }
        case .expandAll:
            Button { prefs.setAllCollapsed(session, []) } label: {
                Label(String(localized: "Expand all"), systemImage: "arrow.up.left.and.arrow.down.right")
            }
        case .delete:
            Button(role: .destructive) { if let name { actions.startDelete(.personal(name)) } } label: {
                Label(String(localized: "Delete section"), systemImage: "trash")
            }
        case .addBots:
            Button { if let name { actions.startEditingBots(name) } } label: {
                Label(String(localized: "Add bots"), systemImage: "person.2")
            }
        case .renameTeam:
            Button { if let name { actions.startRename(name, personal: false) } } label: {
                Label(String(localized: "Rename team"), systemImage: "pencil")
            }
        case .deleteTeam:
            Button(role: .destructive) { if let name { actions.startDelete(.server(name)) } } label: {
                Label(String(localized: "Delete team"), systemImage: "trash")
            }
        case .newBotHere:
            Button { if let name { newBotHere?(name) } } label: {
                Label(String(localized: "New bot here"), systemImage: "plus.circle")
            }
            .accessibilityIdentifier("section-new-bot")
        }
    }
}

/// "Move to section" for a bot or a group on an organization server: the
/// person's own sections, Unassigned, or a new one (the desktop's SectionPicker).
struct PersonalSectionPicker: View {
    let key: String
    let layout: SidebarLayout
    @ObservedObject var actions: SidebarSectionActions
    var title: String = String(localized: "Move to")
    @EnvironmentObject private var session: Session

    var body: some View {
        let current = (SidebarPrefsModel.shared.personal ?? .empty).section(of: key)
        Menu {
            ForEach(layout.sectionNames.filter { $0 != current }, id: \.self) { name in
                Button(name) { assign(name) }
            }
            if current != nil {
                Button { assign("") } label: { Label("Move to Unassigned", systemImage: "tray") }
            }
            Button { actions.startNew(assigning: key) } label: { Label("New section…", systemImage: "folder.badge.plus") }
        } label: {
            Label(title, systemImage: "folder")
        }
    }

    private func assign(_ name: String) {
        actions.error = SidebarPrefsModel.shared.assignPersonal(session, key: key, to: name)
    }
}

struct SidebarSectionActionsPresenter: ViewModifier {
    @ObservedObject var actions: SidebarSectionActions
    @EnvironmentObject private var session: Session

    private var nameTitle: LocalizedStringKey {
        switch actions.nameEntry {
        case .renameServer?: "Rename team"
        case .renamePersonal?: "Rename…"
        default: "New section…"
        }
    }

    func body(content: Content) -> some View {
        content
            .alert(nameTitle, isPresented: Binding(
                get: { actions.nameEntry != nil },
                set: { if !$0 { actions.nameEntry = nil } }
            )) {
                TextField("Section name", text: $actions.nameDraft)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("section-name-field")
                Button("Cancel", role: .cancel) { actions.nameEntry = nil }
                Button("Save") { actions.commitName(session) }
                    .accessibilityIdentifier("section-name-save")
            }
            .alert(
                Text("Delete \(actions.deleting?.name ?? "") team?"),
                isPresented: Binding(
                    get: { actions.deleting != nil },
                    set: { if !$0 { actions.deleting = nil } }
                )
            ) {
                Button("Cancel", role: .cancel) { actions.deleting = nil }
                Button("Delete team", role: .destructive) { actions.confirmDelete(session) }
                    .accessibilityIdentifier("section-delete-confirm")
            } message: {
                Text("Bots and group chats move to Unassigned with their conversations intact. The team and its shared instructions are deleted. This cannot be undone.")
            }
            .sheet(item: $actions.editingBots) { target in
                SectionBotsSheet(section: target.name)
                    .environmentObject(session)
            }
            .alert("Couldn't update", isPresented: Binding(
                get: { actions.error != nil },
                set: { if !$0 { actions.error = nil } }
            )) {
                Button("OK", role: .cancel) { actions.error = nil }
            } message: {
                Text(verbatim: actions.error ?? "")
            }
    }
}

extension View {
    func sidebarSectionActionsPresenter(_ actions: SidebarSectionActions) -> some View {
        modifier(SidebarSectionActionsPresenter(actions: actions))
    }
}

/// Add or remove bots of a server section (TeamDialog in its managing
/// mode): checked bots belong to it; unchecking one moves it to Unassigned.
struct SectionBotsSheet: View {
    @Environment(\.themePalette) var themePalette
    let section: String
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var initial: Set<String> = []
    @State private var picked: Set<String> = []
    @State private var loaded = false
    @State private var saving = false

    private var candidates: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var add: [String] { picked.subtracting(initial).sorted() }
    private var remove: [String] { initial.subtracting(picked).sorted() }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Checked bots belong to this team. Uncheck a bot to move it to Unassigned. Moving changes who they can work with and which shared instructions they read. Their chats stay with them.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .listRowBackground(Color.clear)
                }
                Section {
                    if candidates.isEmpty {
                        Text("No other bots to move. You can add bots later.")
                            .foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(candidates) { bot in
                        Button {
                            if picked.contains(bot.id) { picked.remove(bot.id) } else { picked.insert(bot.id) }
                        } label: {
                            HStack(spacing: 12) {
                                BotMascotView(bot: bot, size: 28, state: .idle, animated: false)
                                    .accessibilityHidden(true)
                                Text(verbatim: bot.name)
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer(minLength: 0)
                                if picked.contains(bot.id) {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Theme.accentText)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(picked.contains(bot.id) ? .isSelected : [])
                        .accessibilityIdentifier("section-bot.\(bot.id)")
                    }
                } header: {
                    Text("Existing bots")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(initial.isEmpty ? "Add bots" : "Add or remove bots")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            let saved = await session.setServerSectionBots(section, add: add, remove: remove)
                            saving = false
                            if saved { dismiss() }
                        }
                    }
                    .disabled(saving || (add.isEmpty && remove.isEmpty))
                    .accessibilityIdentifier("section-bots-save")
                }
            }
            .interactiveDismissDisabled(saving)
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            initial = Set(candidates.filter { $0.section?.trimmingCharacters(in: .whitespacesAndNewlines) == section }.map(\.id))
            picked = initial
        }
    }
}
