// iPad I3: the model picker (ModelPicker.tsx), opened by the composer's
// model chip: a centred 880 x 640 dialog over a 50 % scrim. On the left the
// engine rail (Cloud: each engine with its state; API keys), on the right
// the engine's name and version, where the change applies (only this
// thread, or the thread and the bot's default), a search, the suggested
// models (current, default, then the catalogue, five) or all of them, and
// a footer to the providers. Picking writes through the routes the profile
// already uses (`updateModel` on the task, then the bot default).
import SwiftUI
import UIKit
import CompanionCore

struct DesktopModelPicker: View {
    enum Scope { case thread, bot }

    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let close: () -> Void
    let openProviders: () -> Void

    @State private var instances: [Instance] = []
    @State private var railId: String?
    @State private var scope: Scope = .thread
    @State private var query = ""
    @State private var showAll = false
    @State private var saving = false

    private var selection: ModelSelection { bot.currentTaskModelSelection }
    private var rail: Instance? {
        instances.first { $0.instanceId == (railId ?? selection.instanceId) } ?? instances.first
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture(perform: close)
            GeometryReader { geometry in
                dialog
                    .frame(width: min(880, geometry.size.width - 40), height: min(640, geometry.size.height - 96))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { instances = await DesktopModelCatalog.shared.instances(session) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-model-picker")
    }

    private var dialog: some View {
        HStack(spacing: 0) {
            engineRail
                .frame(width: 224)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(theme.panel)
                .overlay(alignment: .trailing) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 1) }
            VStack(spacing: 0) {
                ScrollView { pane.padding(.horizontal, 24).padding(.top, 21).padding(.bottom, 12) }
                footer
            }
        }
        .background(theme.app)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 32, height: 32)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .keyboardShortcut(.cancelAction)
            .padding(10)
            .accessibilityLabel(Text("Close"))
        }
        .shadow(color: .black.opacity(0.35), radius: 30, y: 12)
    }

    // MARK: Rail

    private var engineRail: some View {
        VStack(alignment: .leading, spacing: 4) {
            railHeading("Cloud")
            ForEach(instances) { instance in
                Button {
                    railId = instance.instanceId
                    showAll = false
                    query = ""
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: instance.driverKind.lowercased().contains("codex") ? "circle.hexagongrid" : "asterisk")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(instance.driverKind.lowercased().contains("codex") ? theme.ink : Color(red: 0.85, green: 0.47, blue: 0.34))
                            .frame(width: 28, height: 28)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        VStack(alignment: .leading, spacing: 0) {
                            Text(verbatim: instance.displayName ?? instance.instanceId)
                                .font(theme.font(13, .medium))
                                .foregroundStyle(theme.ink)
                                .lineLimit(1)
                                .frame(height: 19.5)
                            status(instance)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 52)
                    .background(instance.instanceId == rail?.instanceId ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        if instance.instanceId == rail?.instanceId {
                            RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
            }
            railHeading("API keys").padding(.top, 6)
            Button(action: openProviders) {
                Label("Add API keys", systemImage: "plus")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(12)
    }

    private func railHeading(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .textCase(.uppercase)
            .font(theme.font(10, .medium))
            .tracking(0.8)
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 10)
            .frame(height: 19, alignment: .bottom)
    }

    @ViewBuilder
    private func status(_ instance: Instance) -> some View {
        let signedOut = instance.snapshot.authenticated == false
        let warn = signedOut || !instance.snapshot.isAvailable || instance.snapshot.reason != nil
        HStack(spacing: 4) {
            Circle().fill(warn ? theme.warning : theme.success).frame(width: 6, height: 6)
            Group {
                if signedOut {
                    Text("Sign-in required")
                } else {
                    Text(verbatim: instance.snapshot.version ?? instance.driverKind)
                }
            }
            .font(theme.font(11))
            .foregroundStyle(warn ? theme.warning : theme.inkSecondary)
            .lineLimit(1)
        }
        .frame(height: 16.5)
    }

    // MARK: Pane

    @ViewBuilder
    private var pane: some View {
        if let rail {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Text(verbatim: rail.displayName ?? rail.instanceId)
                        .font(theme.font(16, .semibold))
                        .foregroundStyle(theme.ink)
                        .frame(height: 24)
                    Spacer(minLength: 8)
                    if let version = rail.snapshot.version {
                        Text(verbatim: version)
                            .font(theme.font(10.5, .medium))
                            .foregroundStyle(theme.success)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(theme.success.opacity(0.1), in: Capsule())
                    }
                }
                .padding(.trailing, 40)

                Text("Apply model changes to")
                    .font(theme.font(12.5, .medium))
                    .foregroundStyle(theme.ink)
                    .padding(.top, 20)
                HStack(spacing: 4) {
                    scopeButton("Only this thread", .thread)
                    scopeButton("Thread + bot default", .bot)
                }
                .padding(.top, 6)
                Group {
                    if scope == .bot {
                        Text("This thread, groups, and new threads. Other existing threads keep their model.")
                    } else {
                        Text("Other threads and groups keep their model.")
                    }
                }
                .font(theme.font(11.5))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 6)

                Text("Model")
                    .font(theme.font(12.5, .medium))
                    .foregroundStyle(theme.ink)
                    .padding(.top, 18)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.inkSecondary)
                    TextField("Search models", text: $query)
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.ink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 10)
                .frame(height: 32.8)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                .padding(.horizontal, 8)
                .padding(.top, 4)

                models(rail).padding(.top, 8)
            }
        } else {
            Text("No model providers yet.")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 40)
        }
    }

    private func scopeButton(_ title: LocalizedStringKey, _ value: Scope) -> some View {
        Button { scope = value } label: {
            Text(title)
                .font(theme.font(12))
                .foregroundStyle(scope == value ? theme.ink : theme.inkSecondary)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(scope == value ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    @ViewBuilder
    private func models(_ rail: Instance) -> some View {
        let current = selection.instanceId == rail.instanceId ? (selection.model.isEmpty ? rail.models.default : selection.model) : nil
        let options = rail.models.options
        let shown = !query.isEmpty ? ModelSuggestions.filter(options, query: query)
            : showAll ? options : ModelSuggestions.suggested(options, defaultId: rail.models.default, currentId: current)
        VStack(alignment: .leading, spacing: 0) {
            Text(query.isEmpty && !showAll ? "Suggested" : "Models")
                .textCase(.uppercase)
                .font(theme.font(10, .medium))
                .tracking(0.8)
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 8)
                .frame(height: 21, alignment: .top)
            ForEach(shown) { option in
                Button { pick(rail, option) } label: {
                    HStack(spacing: 8) {
                        Text(verbatim: option.label)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                        if option.id == rail.models.default {
                            Text("Default")
                                .font(theme.font(10))
                                .foregroundStyle(theme.inkSecondary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(theme.inset, in: RoundedRectangle(cornerRadius: 4))
                        }
                        Spacer(minLength: 8)
                        if option.id == current {
                            Image(systemName: "checkmark")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.accent)
                        }
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 35.5)
                    .background(option.id == current ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .disabled(saving || bot.busy == true)
                .accessibilityIdentifier("desktop-model-\(option.id)")
            }
            if query.isEmpty, !showAll, options.count > shown.count {
                Button { showAll = true } label: {
                    HStack {
                        Text("Show all \(options.count) models")
                        Spacer()
                        Image(systemName: "chevron.down").font(.system(size: 11))
                    }
                    .font(theme.font(12.5, .medium))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(height: 35.8)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 0) {
            Button(action: openProviders) {
                Text("Model providers and accounts")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button(action: openProviders) {
                Label("Add API keys", systemImage: "key")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 38)
            }
            .buttonStyle(.plain)
        }
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
    }

    private func pick(_ rail: Instance, _ option: ModelOption) {
        let next = ModelSelection(instanceId: rail.instanceId, model: option.id, effort: selection.effort)
        saving = true
        Task {
            if await session.updateModel(next, for: bot) != nil, scope == .bot {
                await session.updateModelDefault(next, for: bot)
            }
            saving = false
            close()
        }
    }
}

extension Session {
    /// "Thread + bot default": the bot's own default too (the profile route).
    func updateModelDefault(_ selection: ModelSelection, for bot: Bot) async {
        guard let client = profileClient else { return }
        do {
            applyProfileBot(try await client.updateModel(botId: bot.id, selection: selection))
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
        }
    }
}
