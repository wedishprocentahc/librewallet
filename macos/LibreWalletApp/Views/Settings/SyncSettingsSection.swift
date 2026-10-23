import SwiftUI
import AppKit

/// Settings block that walks the user through setting up Syncthing and verifies the connection.
struct SyncSettingsSection: View {
    @ObservedObject private var sync = SyncCoordinator.shared
    @State private var copied = false

    var body: some View {
        Text(L10n.t("sync.intro")).font(.caption).foregroundStyle(.secondary)

        LabeledContent(L10n.t("sync.dataFolder")) {
            pathRow(SyncCoordinator.dataFolder.path, reveal: SyncCoordinator.dataFolder)
        }
        Text(L10n.t("sync.dataFolder.note")).font(.caption).foregroundStyle(.secondary)

        if let folder = sync.folderPath {
            LabeledContent(L10n.t("sync.folder")) {
                pathRow(folder, reveal: URL(fileURLWithPath: folder))
            }
            instructions(folder: folder)
            controls
            status
        } else {
            Button(L10n.t("sync.enable")) {
                do { try sync.enableWithDefaultFolder() } catch { /* shown via lastError on next sync */ }
            }
            Text(L10n.t("sync.enable.note", ["path": SyncCoordinator.defaultFolder.path]))
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: pieces

    private func pathRow(_ path: String, reveal: URL) -> some View {
        HStack(spacing: 6) {
            Text(path).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(path, forType: .string)
                copied = true
                Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
            } label: { Image(systemName: copied ? "checkmark" : "doc.on.doc") }
                .buttonStyle(.borderless)
                .help(L10n.t("sync.copyPath"))
            Button {
                NSWorkspace.shared.activateFileViewerSelecting([reveal])
            } label: { Image(systemName: "folder") }
                .buttonStyle(.borderless)
                .help(L10n.t("sync.reveal"))
        }
    }

    private func instructions(folder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L10n.t("sync.steps.title")).font(.subheadline.weight(.semibold))
            ForEach(1...5, id: \.self) { n in
                HStack(alignment: .top, spacing: 6) {
                    Text("\(n).").monospacedDigit().foregroundStyle(.secondary)
                    Text(L10n.t("sync.step.\(n)", ["path": folder]))
                        
                }
                .font(.callout)
            }
            Link(L10n.t("sync.syncthingLink"), destination: URL(string: "https://syncthing.net/downloads/")!)
                .font(.callout)
        }
        .padding(.vertical, 4)
    }

    private var controls: some View {
        HStack {
            Button(L10n.t("sync.test")) { sync.testConnection() }
                .buttonStyle(.borderedProminent)
                .disabled(isTesting)
            Button(L10n.t("settings.sync.now")) { sync.syncNow() }
                .disabled(sync.isSyncing || isTesting)
            Spacer()
            Button(L10n.t("settings.sync.disable"), role: .destructive) { sync.setFolder(nil) }
        }
    }

    private var isTesting: Bool {
        if case .running = sync.testState { return true }
        return false
    }

    @ViewBuilder private var status: some View {
        switch sync.testState {
        case .idle:
            EmptyView()
        case .running(let message):
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(message).font(.callout)
            }
        case .finished(let checks):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(checks) { check in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: icon(check.level)).foregroundStyle(color(check.level))
                        Text(check.text).font(.callout)
                    }
                }
                Button(L10n.t("sync.test.dismiss")) { sync.dismissTestResult() }
                    .buttonStyle(.link).font(.caption)
            }
        }

        if let last = sync.lastSyncAt {
            LabeledContent(
                L10n.t("settings.sync.last"),
                value: "\(last.formatted(date: .abbreviated, time: .standard)) · \(sync.statusMessage ?? "")"
            )
        }
        if !sync.peerNames.isEmpty {
            LabeledContent(L10n.t("settings.sync.peers"), value: sync.peerNames.joined(separator: ", "))
        }
        if let err = sync.lastError {
            Text(err).font(.caption).foregroundStyle(.red)
        }
    }

    private func icon(_ level: SyncCoordinator.TestCheck.Level) -> String {
        switch level {
        case .ok: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .failure: "xmark.octagon.fill"
        }
    }

    private func color(_ level: SyncCoordinator.TestCheck.Level) -> Color {
        switch level {
        case .ok: .green
        case .warning: .orange
        case .failure: .red
        }
    }
}
