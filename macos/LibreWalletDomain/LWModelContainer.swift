import Foundation
import SwiftData

enum LWModelContainer {
    static let shared: ModelContainer = {
        let schema = Schema([
            PortfolioGroup.self,
            Portfolio.self,
            Transaction.self,
            BondHolding.self,
            AllocationTarget.self,
            Quote.self,
        ])
        let url = storeURL()
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        // Prefer opening existing store; SwiftData applies lightweight migration when possible.
        let config = ModelConfiguration(schema: schema, url: url)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            // Last resort: back up the broken store, then recreate empty.
            // Prefer restoring from Settings → Import backup (JSON) over this wipe.
            Self.backupStoreFiles(at: url)
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + "-shm"))
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + "-wal"))
            do {
                return try ModelContainer(for: schema, configurations: [config])
            } catch {
                // Absolute fallback: in-memory container so the app still launches.
                let memory = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
                return try! ModelContainer(for: schema, configurations: [memory])
            }
        }
    }()

    static func storeURL() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("LibreWallet", isDirectory: true)
        return dir.appendingPathComponent("LibreWallet.sqlite")
    }

    private static func backupStoreFiles(at url: URL) {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let backupDir = url.deletingLastPathComponent().appendingPathComponent("StoreBackups", isDirectory: true)
        try? FileManager.default.createDirectory(at: backupDir, withIntermediateDirectories: true)
        let dest = backupDir.appendingPathComponent("LibreWallet-\(stamp).sqlite")
        try? FileManager.default.copyItem(at: url, to: dest)
        try? FileManager.default.copyItem(
            at: URL(fileURLWithPath: url.path + "-shm"),
            to: URL(fileURLWithPath: dest.path + "-shm")
        )
        try? FileManager.default.copyItem(
            at: URL(fileURLWithPath: url.path + "-wal"),
            to: URL(fileURLWithPath: dest.path + "-wal")
        )
    }
}
