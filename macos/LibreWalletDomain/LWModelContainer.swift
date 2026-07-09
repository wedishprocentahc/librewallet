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
        // Make the store location predictable so it can be wiped easily in dev.
        let url = storeURL()
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let config = ModelConfiguration(schema: schema, url: url)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            // SwiftData doesn't always auto-migrate when the schema changes during development.
            // If we hit a schema mismatch, wipe the local store and recreate it.
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + "-shm"))
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + "-wal"))
            return try! ModelContainer(for: schema, configurations: [config])
        }
    }()

    static func storeURL() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        // Unsandboxed dev builds store here; sandboxed builds will still work but use this explicit path.
        let dir = appSupport.appendingPathComponent("LibreWallet", isDirectory: true)
        return dir.appendingPathComponent("LibreWallet.sqlite")
    }
}

