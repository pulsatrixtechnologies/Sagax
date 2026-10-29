import CompanionCore
import SwiftUI

/// A routine's long-press menu (2026-10-29), the desktop's row menu: Run now
/// (Stop while a run is in flight), Pause or Resume, Rename, Open,
/// Duplicate, then Delete in red, last. Each action is shown only when its
/// closure is given.
struct RoutineActionsMenu: View {
    let routine: Routine
    var runNow: (() -> Void)? = nil
    var stop: (() -> Void)? = nil
    var toggle: (() -> Void)? = nil
    var rename: (() -> Void)? = nil
    let open: () -> Void
    var duplicate: (() -> Void)? = nil
    var delete: (() -> Void)? = nil

    var body: some View {
        if let stop {
            Button("Stop", systemImage: "stop.fill", action: stop)
        } else if let runNow {
            Button("Run now", systemImage: "play.fill", action: runNow)
        }
        if let toggle {
            Button(routine.enabled ? "Pause" : "Resume", systemImage: routine.enabled ? "pause" : "play.circle", action: toggle)
        }
        if let rename {
            Button("Rename", systemImage: "pencil", action: rename)
                .accessibilityIdentifier("routine-rename.\(routine.name)")
        }
        Button("Open", systemImage: "arrow.up.forward.app", action: open)
        if let duplicate {
            Button("Duplicate", systemImage: "plus.square.on.square", action: duplicate)
        }
        if let delete {
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive, action: delete)
        }
    }
}

/// Rename a routine (its menu's Rename, or the swipe): a text prompt, the
/// name trimmed, an empty one refused (Rename stays disabled).
struct RoutineRenamePrompt: ViewModifier {
    @Binding var routine: Routine?
    let save: (_ routine: Routine, _ name: String) async -> Void
    @State private var text = ""

    func body(content: Content) -> some View {
        content
            .alert("Rename", isPresented: Binding(get: { routine != nil }, set: { if !$0 { routine = nil } })) {
                TextField("Routine name", text: $text)
                    .accessibilityIdentifier("routine-rename-field")
                Button("Cancel", role: .cancel) { routine = nil }
                Button("Rename") {
                    guard let target = routine, let name = RoutineName.clean(text) else { return }
                    routine = nil
                    Task { await save(target, name) }
                }
                .disabled(RoutineName.clean(text) == nil)
            }
            .onValueChange(of: routine?.id) { _ in text = routine?.name ?? "" }
    }
}

extension View {
    func routineRenamePrompt(_ routine: Binding<Routine?>, save: @escaping (_ routine: Routine, _ name: String) async -> Void) -> some View {
        modifier(RoutineRenamePrompt(routine: routine, save: save))
    }
}
