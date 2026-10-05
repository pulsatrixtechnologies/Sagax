// A server's own sections (matrix row SB4): rename, add or remove bots,
// delete, as the desktop's team menu does (TeamDialog.tsx, Sidebar.tsx).
// PATCH, PUT and DELETE /api/sidebar-sections are admin only on a server
// (SurfaceGate `.sectionManagement`). Each write refreshes the roster from
// the server, which moves the bots; a failure leaves its sentence in
// `actionError`.
import CompanionCore
import Foundation

extension Session {
    func renameServerSection(_ name: String, to newName: String) async -> Bool {
        guard let client = settingsClient else { return false }
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await client.renameSidebarSection(name, to: trimmed)
            // the section's fold and place follow its name (renamedTeam)
            SidebarPrefsModel.shared.update(self) { $0.renameSectionID(from: name, to: trimmed) }
            await refresh()
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    func setServerSectionBots(_ name: String, add: [String], remove: [String]) async -> Bool {
        guard let client = settingsClient else { return false }
        do {
            try await client.setSidebarSectionBots(name, add: add, remove: remove)
            await refresh()
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    func deleteServerSection(_ name: String) async -> Bool {
        guard let client = settingsClient else { return false }
        do {
            try await client.deleteSidebarSection(name)
            await refresh()
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }
}
