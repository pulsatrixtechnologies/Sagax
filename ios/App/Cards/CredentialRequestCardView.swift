// The credential request card (kind "secret"). Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import UIKit

/// A credential entered here is encrypted for the exact computer whose
/// public key was pinned by the pairing QR. Password AutoFill remains
/// provider-neutral: Apple Passwords works without another subscription,
/// while 1Password, Bitwarden and other enabled providers work as usual.
struct CredentialRequestCardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    let secret: SecretRequestCardData
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    @State private var value = ""
    @State private var fieldID = UUID()
    @State private var preparedSubmission: PreparedPhoneCredential?
    @State private var submissionTask: Task<Void, Never>?
    @State private var activeSubmissionID: UUID?
    @State private var submitting = false
    @State private var submitted = false
    @State private var submissionError: String?

    private struct RequestIdentity: Equatable {
        let connectionID: String?
        let botID: String?
        let threadID: String
        let messageID: String
        let target: String?
        let requestKey: String?
    }

    private var tint: Color { MausPalette.color(message.from?.color ?? chat.color) }
    private var requester: String { message.from?.name ?? chat.name }
    private var label: String { visible(secret.label) ?? "API credential" }
    private var accessibilityStatus: Text {
        if secret.provided == true {
            return secret.resumed == true
            ? Text("Saved securely. The task resumed.")
            : Text("Saved securely on your computer.")
        }
        if secret.dismissed == true { return Text("Not provided.") }
        if submitted { return Text("Encrypted and sent to your computer.") }
        if canEnterOnPhone { return Text("Enter it securely on this phone.") }
        if !hasSecurePairing { return Text("Pair again by QR code, or finish on your computer.") }
        return Text("Use secure phone access or Tailscale, or finish on your computer.")
    }

    private func visible(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var helpURL: URL? {
        guard let raw = secret.helpUrl,
              let url = URL(string: raw),
              url.scheme?.lowercased() == "https",
              url.host != nil,
              url.user == nil,
              url.password == nil
        else { return nil }
        return url
    }

    private var hasSecurePairing: Bool {
        guard secret.isPending,
              visible(secret.target) != nil,
              visible(secret.requestKey) != nil,
              let connection = session.connection
        else { return false }
        return connection.secretPublicKey != nil && connection.companionDeviceId != nil
    }

    private var hasProtectedTransport: Bool {
        session.phoneCredentialTransportIsProtected
    }

    private var canEnterOnPhone: Bool { hasSecurePairing && hasProtectedTransport }

    private var placeholder: String { visible(secret.placeholder) ?? label }

    private var canSubmit: Bool {
        guard canEnterOnPhone, !submitting, !submitted else { return false }
        return preparedSubmission != nil
            || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var requestIdentity: RequestIdentity {
        let botID: String?
        switch chat {
        case let .bot(bot): botID = bot.id
        case .room: botID = message.from?.botId
        }
        return RequestIdentity(
            connectionID: session.connection?.id,
            botID: botID,
            threadID: chat.threadId,
            messageID: message.id,
            target: secret.target,
            requestKey: secret.requestKey
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: "key.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.readable(tint))
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.system(size: 16, weight: .semibold))
                    Text("Requested by \(requester)")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            if let description = visible(secret.description) {
                Text(description)
                    .font(.system(size: 14.5))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if secret.provided == true {
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        secret.resumed == true ? "Saved securely. The task resumed." : "Saved securely on your computer.",
                        systemImage: "checkmark.shield.fill"
                    )
                    .foregroundStyle(Theme.success)

                    if secret.resumed != true, let preparedSubmission {
                        Button(action: { send(preparedSubmission) }) {
                            HStack(spacing: 7) {
                                if submitting { ProgressView() }
                                Image(systemName: "arrow.clockwise")
                                Text(submitting ? "Resuming…" : "Try resuming the task")
                            }
                            .font(.system(size: 13, weight: .semibold))
                        }
                        .disabled(submitting || !hasProtectedTransport)
                    }
                }
            } else if secret.dismissed == true {
                Label("Not provided", systemImage: "xmark.circle")
                    .foregroundStyle(Theme.textSecondary)
            } else if submitted {
                Label("Encrypted and saved on your computer", systemImage: "checkmark.shield.fill")
                    .foregroundStyle(Theme.success)
            } else if canEnterOnPhone {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Enter securely on this phone", systemImage: "lock.shield.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))

                    if preparedSubmission == nil {
                        SecureField(placeholder, text: $value)
                            .id(fieldID)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .privacySensitive()
                            .disabled(submitting)
                            .submitLabel(.done)
                            .onSubmit { submit() }
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(
                                Theme.card,
                                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                            )
                            .accessibilityLabel(label)
                    } else {
                        Label(
                            submitting ? "Encrypted and saving…" : "Encrypted and ready to retry",
                            systemImage: "lock.fill"
                        )
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12)
                        .background(
                            Theme.card,
                            in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                        )
                    }

                    Button(action: submit) {
                        HStack(spacing: 7) {
                            if submitting { ProgressView().tint(.white) }
                            Image(systemName: "lock.fill")
                            Text(
                                submitting
                                    ? "Saving securely…"
                                    : preparedSubmission == nil ? "Save securely" : "Try again securely"
                            )
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(tint)
                    .disabled(!canSubmit)

                    if preparedSubmission != nil, !submitting, submissionError != nil {
                        Button("Enter a different value") {
                            discardPreparedSubmission()
                        }
                        .font(.system(size: 13, weight: .medium))
                    }

                    Text("Use Apple Passwords, 1Password, Bitwarden, or paste. The value is encrypted for your computer and never added to chat.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            } else if !hasSecurePairing {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Pair again to enter here", systemImage: "qrcode")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))
                    Text("This pairing predates secure phone entry. Scan a fresh QR from Sagax, or finish this request on your computer.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Secure connection required", systemImage: "lock.shield.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))
                    Text("Switch to Secure phone access (HTTPS) or Tailscale, then try again. You can still finish this request on your computer.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }

            if let submissionError = visible(submissionError) {
                Label(submissionError, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error = visible(secret.error) {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let helpURL {
                Link(destination: helpURL) {
                    Label("Where to get this key", systemImage: "arrow.up.right")
                        .font(.system(size: 13, weight: .medium))
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.inset)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(secret.isPending ? tint.opacity(0.65) : Color.clear, lineWidth: 1.25)
        }
        .accessibilityElement(children: canEnterOnPhone ? .contain : .combine)
        .accessibilityLabel("\(label). \(accessibilityStatus)")
        .onAppear {
            preparedSubmission = session.preparedCredential(
                chat: chat,
                message: message,
                secret: secret
            )
        }
        .onValueChange(of: requestIdentity) { _ in
            resetSensitiveState(clearPrepared: true)
            preparedSubmission = session.preparedCredential(
                chat: chat,
                message: message,
                secret: secret
            )
            submitted = false
        }
        .onValueChange(of: session.credentialEntryResetGeneration) { _ in
            suspendSensitiveEntry()
        }
        .onValueChange(of: session.status) { status in
            if status != .live { suspendSensitiveEntry() }
        }
        .onValueChange(of: scenePhase) { phase in
            // Password AutoFill and its Face ID sheet temporarily make the
            // scene inactive. Removing the SecureField at that point breaks
            // the very fill operation the user requested. A true background
            // transition (including locking the phone) still scrubs it.
            if phase == .background { suspendSensitiveEntry() }
        }
        .onDisappear {
            // The async request owns only ciphertext and is safe to finish.
            // Its envelope stays in Session so returning to this card can
            // retry the exact same operation after an ambiguous response.
            clearPlaintext()
            submissionError = nil
        }
    }

    private func submit() {
        guard canSubmit else { return }
        submissionError = nil
        if let preparedSubmission {
            send(preparedSubmission)
            return
        }

        do {
            // Encryption happens synchronously. No task closure ever captures
            // the cleartext, and the native field is replaced immediately.
            let prepared = try session.prepareCredential(
                value,
                chat: chat,
                message: message,
                secret: secret
            )
            clearPlaintext()
            preparedSubmission = prepared
            send(prepared)
        } catch {
            clearPlaintext()
            submissionError = error.localizedDescription
            Haptics.notification(.error)
        }
    }

    private func send(_ prepared: PreparedPhoneCredential) {
        submissionTask?.cancel()
        let submissionID = UUID()
        activeSubmissionID = submissionID
        submissionError = nil
        submitting = true

        submissionTask = Task { @MainActor in
            do {
                try await session.provideCredential(prepared)
                guard !Task.isCancelled, activeSubmissionID == submissionID else { return }
                submitted = true
                Haptics.success()
            } catch {
                guard !Task.isCancelled, activeSubmissionID == submissionID else { return }
                // Keep only the exact ciphertext so Retry is the same
                // idempotent operation. The cleartext field is already gone.
                submissionError = error.localizedDescription
                Haptics.notification(.error)
            }

            guard activeSubmissionID == submissionID else { return }
            activeSubmissionID = nil
            submissionTask = nil
            submitting = false
        }
    }

    private func clearPlaintext() {
        value.removeAll(keepingCapacity: false)
        // Replacing the SecureField also clears UIKit's backing control,
        // including text inserted by Password AutoFill.
        fieldID = UUID()
    }

    private func suspendSensitiveEntry() {
        clearPlaintext()
        activeSubmissionID = nil
        submissionTask?.cancel()
        submissionTask = nil
        submitting = false
        submissionError = nil
        // Keep an already-encrypted envelope. If the request reached the
        // computer before iOS suspended it, foreground Retry must send the
        // exact same operation instead of generating fresh HPKE randomness.
    }

    private func resetSensitiveState(clearPrepared: Bool) {
        suspendSensitiveEntry()
        if clearPrepared, let preparedSubmission {
            session.discardPreparedCredential(preparedSubmission)
            self.preparedSubmission = nil
        }
    }

    private func discardPreparedSubmission() {
        resetSensitiveState(clearPrepared: true)
        submitted = false
    }

}
