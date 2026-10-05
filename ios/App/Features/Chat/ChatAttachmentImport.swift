// Photos and files picked for the next message: read, checked against the
// attachment policy and kept per thread. Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import PhotosUI
import UniformTypeIdentifiers
import ImageIO
import UIKit

extension ChatView {
    func importPhotos(_ items: [PhotosPickerItem]) async {
        guard !preparingAttachments, !sendingMessage else { return }
        let importingThread = threadId
        let existingAttachments = attachments
        let available = AttachmentPolicy.maximumItems - existingAttachments.count
        guard items.count <= available else {
            selectedPhotos = []
            attachmentError = "Send up to \(AttachmentPolicy.maximumItems) items at a time."
            return
        }

        preparingAttachments = true
        attachmentError = nil
        defer {
            preparingAttachments = false
            selectedPhotos = []
        }

        do {
            var imported: [PendingMessageAttachment] = []
            for (index, item) in items.enumerated() {
                guard let raw = try await item.loadTransferable(type: Data.self) else {
                    throw AttachmentImportError.unreadable("that photo")
                }
                let actualType = CGImageSourceCreateWithData(raw as CFData, nil)
                    .flatMap(CGImageSourceGetType)
                    .flatMap { UTType($0 as String) }
                let actualMime = actualType?.preferredMIMEType
                    .map(AttachmentPolicy.normalizedMIME)

                let data: Data
                let mime: String
                let fileExtension: String
                if let actualMime, AttachmentPolicy.imageMIMETypes.contains(actualMime) {
                    data = raw
                    mime = actualMime
                    fileExtension = actualType?.preferredFilenameExtension ?? "jpg"
                } else if let image = UIImage(data: raw),
                          let jpeg = image.jpegData(compressionQuality: 0.9) {
                    data = jpeg
                    mime = "image/jpeg"
                    fileExtension = "jpg"
                } else {
                    throw AttachmentImportError.unsupported("that photo")
                }

                let candidate = PendingMessageAttachment(
                    id: UUID(),
                    data: data,
                    name: items.count == 1 ? "Photo.\(fileExtension)" : "Photo \(index + 1).\(fileExtension)",
                    mime: mime,
                    kind: .image
                )
                try AttachmentPolicy.validate(existingAttachments + imported + [candidate])
                imported.append(candidate)
            }
            if threadId == importingThread { attachments.append(contentsOf: imported) }
            else { threadDrafts[importingThread, default: ComposerSnapshot()].attachments.append(contentsOf: imported) }
            Haptics.selection()
        } catch {
            if threadId == importingThread { attachmentError = error.localizedDescription }
            else { threadDrafts[importingThread]?.error = error.localizedDescription }
        }
    }

    func importFiles(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result else {
            if case let .failure(error) = result { attachmentError = error.localizedDescription }
            return
        }
        guard !urls.isEmpty else { return }
        Task { await importFiles(urls) }
    }

    func importFiles(_ urls: [URL]) async {
        guard !preparingAttachments, !sendingMessage else { return }
        let importingThread = threadId
        let existingAttachments = attachments
        let available = AttachmentPolicy.maximumItems - existingAttachments.count
        guard urls.count <= available else {
            attachmentError = "Send up to \(AttachmentPolicy.maximumItems) items at a time."
            return
        }

        preparingAttachments = true
        attachmentError = nil
        defer { preparingAttachments = false }

        do {
            var imported: [PendingMessageAttachment] = []
            for url in urls {
                let usedBytes = (existingAttachments + imported).reduce(0) { $0 + $1.data.count }
                let remainingBytes = max(0, AttachmentPolicy.maximumTotalBytes - usedBytes)
                let candidate = try await Task.detached(priority: .userInitiated) {
                    try Self.readImportedFile(url, remainingBytes: remainingBytes)
                }.value
                try AttachmentPolicy.validate(existingAttachments + imported + [candidate])
                imported.append(candidate)
            }
            if threadId == importingThread { attachments.append(contentsOf: imported) }
            else { threadDrafts[importingThread, default: ComposerSnapshot()].attachments.append(contentsOf: imported) }
            Haptics.selection()
        } catch {
            if threadId == importingThread { attachmentError = error.localizedDescription }
            else { threadDrafts[importingThread]?.error = error.localizedDescription }
        }
    }

    nonisolated static func readImportedFile(
        _ url: URL,
        remainingBytes: Int
    ) throws -> PendingMessageAttachment {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        let values = try url.resourceValues(
            forKeys: [.contentTypeKey, .isRegularFileKey, .fileSizeKey]
        )
        guard values.isRegularFile != false else {
            throw AttachmentImportError.unreadable(url.lastPathComponent)
        }
        let name = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw AttachmentImportError.unreadable("that file") }
        let inferred = values.contentType ?? UTType(filenameExtension: url.pathExtension)
        let mime = AttachmentPolicy.normalizedMIME(
            inferred?.preferredMIMEType ?? "application/octet-stream"
        )
        guard let kind = AttachmentPolicy.kind(forMIME: mime) else {
            throw AttachmentImportError.unsupported(name)
        }
        let itemLimit = kind == .image
            ? AttachmentPolicy.maximumImageBytes
            : AttachmentPolicy.maximumFileBytes
        let readLimit = min(itemLimit, remainingBytes)
        if let fileSize = values.fileSize, fileSize > readLimit {
            throw AttachmentImportError.tooLarge(name, readLimit)
        }
        // Some document providers do not report a size. Never let that turn
        // into an unbounded read of a provider-controlled file: read one byte
        // past the remaining allowance and reject it before it can become a
        // large in-memory draft.
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: readLimit + 1) ?? Data()
        guard data.count <= readLimit else {
            throw AttachmentImportError.tooLarge(name, readLimit)
        }
        return PendingMessageAttachment(
            id: UUID(), data: data, name: name, mime: mime, kind: kind
        )
    }
}
