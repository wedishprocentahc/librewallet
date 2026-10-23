import Foundation
import SwiftData
import AppKit

/// Two-way sync through a plain folder (e.g. one shared by Syncthing). Each device writes its own
/// `librewallet-sync-<deviceId>.json` and merges the files of the other devices into its database
/// (see `SyncEngine`). The SQLite store itself is never shared.
@MainActor
final class SyncCoordinator: ObservableObject {
    static let shared = SyncCoordinator()

    @Published private(set) var folderPath: String? = UserDefaults.standard.string(forKey: Keys.folder)
    @Published private(set) var isSyncing = false
    @Published private(set) var lastSyncAt: Date?
    @Published private(set) var statusMessage: String?
    @Published private(set) var lastError: String?
    @Published private(set) var peerNames: [String] = []
    @Published private(set) var testState: TestState = .idle

    enum TestState: Equatable {
        case idle
        case running(String)
        case finished([TestCheck])
    }

    struct TestCheck: Equatable, Identifiable {
        enum Level { case ok, warning, failure }
        let id = UUID()
        let level: Level
        let text: String
    }

    /// Proposed shared folder; created on demand and meant to be added to Syncthing.
    static var defaultFolder: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("LibreWalletSync", isDirectory: true)
    }

    /// Where the app keeps its own database and caches (never shared).
    static var dataFolder: URL { LWModelContainer.storeURL().deletingLastPathComponent() }

    /// Called after a merge changed local data.
    var onDataMerged: (() -> Void)?

    private enum Keys {
        static let folder = "sync.folderPath"
        static let deviceId = "sync.deviceId"
        static let lastWrittenHash = "sync.lastWrittenHash"
        static let lastExportedAt = "sync.lastExportedAt"
        static let lastAckHash = "sync.lastAckHash"
    }

    private var container: ModelContainer?
    private var loopTask: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []

    var deviceId: UUID {
        if let s = UserDefaults.standard.string(forKey: Keys.deviceId), let id = UUID(uuidString: s) { return id }
        let id = UUID()
        UserDefaults.standard.set(id.uuidString, forKey: Keys.deviceId)
        return id
    }

    var deviceName: String { Host.current().localizedName ?? "Mac" }

    var isEnabled: Bool { folderPath != nil }

    func setFolder(_ url: URL?) {
        folderPath = url?.path
        UserDefaults.standard.set(url?.path, forKey: Keys.folder)
        UserDefaults.standard.removeObject(forKey: Keys.lastWrittenHash)
        Self.saveBases([:])
        lastError = nil
        statusMessage = nil
        peerNames = []
        if url != nil { syncNow() }
    }

    func enableWithDefaultFolder() throws {
        try FileManager.default.createDirectory(at: Self.defaultFolder, withIntermediateDirectories: true)
        setFolder(Self.defaultFolder)
    }

    func start(container: ModelContainer) {
        guard self.container == nil else { return }
        self.container = container

        let center = NotificationCenter.default
        observers.append(
            center.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.syncNow() }
            }
        )
        observers.append(
            center.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.syncNow() }
            }
        )

        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                await MainActor.run { self?.syncNow() }
                try? await Task.sleep(nanoseconds: 45 * 1_000_000_000)
            }
        }
    }

    // MARK: - Sync

    func syncNow(forceWrite: Bool = false) {
        guard let container, let folderPath, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }

        do {
            let folder = URL(fileURLWithPath: folderPath, isDirectory: true)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDir), isDir.boolValue else {
                throw SyncError.folderMissing
            }

            let context = container.mainContext
            var bases = Self.loadBases()
            var local = try Self.currentState(context: context)
            var changes = 0
            var backedUp = false
            var names: [String] = []

            let peers = try readPeers(in: folder)
            for peer in peers {
                names.append(peer.deviceName)
                let plan = SyncEngine.plan(local: local, peer: peer.state, base: bases[peer.deviceId.uuidString] ?? SyncBase())
                if plan.changeCount > 0 {
                    if !backedUp {
                        try Self.writeSafetyBackup(context: context)
                        backedUp = true
                    }
                    try Self.apply(plan, context: context)
                    changes += plan.changeCount
                    local = try Self.currentState(context: context)
                }
                bases[peer.deviceId.uuidString] = plan.base
            }
            Self.saveBases(bases)

            // An empty database next to a non-empty sync history usually means a recreated/wiped
            // store; publishing it would delete the data on the other computer.
            let looksWiped = local == SyncState() && bases.values.contains { !$0.hashes.isEmpty }
            if looksWiped {
                peerNames = names
                lastError = "Lokalna baza jest pusta, a synchronizacja miała już dane — pomijam wysyłanie, żeby nie skasować danych na drugim komputerze. Przywróć dane z backupu albo ustaw folder synchronizacji od nowa."
                return
            }
            try writeOwnSnapshot(state: local, folder: folder, force: forceWrite)
            try writeAck(for: peers, folder: folder)

            peerNames = names
            lastSyncAt = Date()
            lastError = nil
            statusMessage = changes > 0 ? "Zastosowano zmian: \(changes)" : "Aktualne"
            if changes > 0 { onDataMerged?() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Files

    private var ownFileName: String { "librewallet-sync-\(deviceId.uuidString).json" }

    private func readPeers(in folder: URL) throws -> [LWSyncSnapshot] {
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .deferredToDate
        var out: [LWSyncSnapshot] = []
        for url in files {
            let name = url.lastPathComponent
            guard name.hasPrefix("librewallet-sync-"), name.hasSuffix(".json"),
                  !name.contains(".sync-conflict"), name != ownFileName else { continue }
            guard let data = try? Data(contentsOf: url),
                  let snap = try? decoder.decode(LWSyncSnapshot.self, from: data),
                  snap.format == LWSyncSnapshot.formatId,
                  snap.version <= LWSyncSnapshot.currentVersion,
                  snap.deviceId != deviceId else { continue }
            out.append(snap)
        }
        return out
    }

    private func writeOwnSnapshot(state: SyncState, folder: URL, force: Bool = false) throws {
        let contentHash = SyncEngine.hash(state)
        let url = folder.appendingPathComponent(ownFileName)
        if !force, UserDefaults.standard.string(forKey: Keys.lastWrittenHash) == contentHash,
           FileManager.default.fileExists(atPath: url.path) {
            return  // avoid touching the file (and waking Syncthing) when nothing changed
        }
        let exportedAt = Date()
        let snapshot = LWSyncSnapshot(
            format: LWSyncSnapshot.formatId,
            version: LWSyncSnapshot.currentVersion,
            deviceId: deviceId,
            deviceName: deviceName,
            exportedAt: exportedAt,
            state: state
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .deferredToDate
        try encoder.encode(snapshot).write(to: url, options: .atomic)
        UserDefaults.standard.set(contentHash, forKey: Keys.lastWrittenHash)
        UserDefaults.standard.set(exportedAt.timeIntervalSinceReferenceDate, forKey: Keys.lastExportedAt)
    }

    // MARK: - Acknowledgements (used by the connection test)

    /// Tiny separate file telling each peer which of its snapshots we have read. Kept apart from
    /// the snapshot so acknowledging never changes a snapshot (no ping-pong between devices).
    private struct Ack: Codable {
        let format: String
        let deviceId: UUID
        let deviceName: String
        let updatedAt: Date
        let seen: [String: Double]  // peer deviceId → exportedAt (reference-date seconds) of the snapshot we read
    }

    private var ackFileName: String { "librewallet-ack-\(deviceId.uuidString).json" }

    private func writeAck(for peers: [LWSyncSnapshot], folder: URL) throws {
        var seen: [String: Double] = [:]
        for p in peers { seen[p.deviceId.uuidString] = p.exportedAt.timeIntervalSinceReferenceDate }
        guard !seen.isEmpty else { return }
        let key = seen.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ";")
        let url = folder.appendingPathComponent(ackFileName)
        if UserDefaults.standard.string(forKey: Keys.lastAckHash) == key,
           FileManager.default.fileExists(atPath: url.path) { return }
        let ack = Ack(format: "librewallet-sync-ack", deviceId: deviceId, deviceName: deviceName, updatedAt: Date(), seen: seen)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .deferredToDate
        try encoder.encode(ack).write(to: url, options: .atomic)
        UserDefaults.standard.set(key, forKey: Keys.lastAckHash)
    }

    private func readAcks(in folder: URL) -> [Ack] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .deferredToDate
        return files.compactMap { url in
            let name = url.lastPathComponent
            guard name.hasPrefix("librewallet-ack-"), name.hasSuffix(".json"), !name.contains(".sync-conflict"),
                  name != ackFileName, let data = try? Data(contentsOf: url) else { return nil }
            return try? decoder.decode(Ack.self, from: data)
        }
    }

    // MARK: - Connection test

    func testConnection() {
        guard let folderPath, container != nil else { return }
        if case .running = testState { return }
        Task { @MainActor in
            let folder = URL(fileURLWithPath: folderPath, isDirectory: true)
            var checks: [TestCheck] = []
            func add(_ level: TestCheck.Level, _ text: String) { checks.append(.init(level: level, text: text)) }

            // 1. Folder exists and is writable.
            testState = .running("Sprawdzam folder…")
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDir), isDir.boolValue else {
                add(.failure, "Folder nie istnieje: \(folderPath)")
                testState = .finished(checks)
                return
            }
            let probe = folder.appendingPathComponent(".librewallet-write-test-\(UUID().uuidString)")
            do {
                try Data("ok".utf8).write(to: probe)
                try FileManager.default.removeItem(at: probe)
                add(.ok, "Folder istnieje i mam do niego zapis.")
            } catch {
                add(.failure, "Nie mogę zapisać w folderze: \(error.localizedDescription)")
                testState = .finished(checks)
                return
            }

            // 2. Merge now and publish a fresh snapshot.
            testState = .running("Zapisuję świeży plik synchronizacji…")
            syncNow(forceWrite: true)
            if let err = lastError {
                add(.failure, err)
                testState = .finished(checks)
                return
            }
            let ownURL = folder.appendingPathComponent(ownFileName)
            let sentAt = UserDefaults.standard.double(forKey: Keys.lastExportedAt)
            if FileManager.default.fileExists(atPath: ownURL.path) {
                add(.ok, "Zapisałem plik: \(ownFileName)")
            } else {
                add(.failure, "Nie udało się zapisać pliku synchronizacji.")
                testState = .finished(checks)
                return
            }

            // 3. Do we see another computer?
            let peers = (try? readPeers(in: folder)) ?? []
            guard !peers.isEmpty else {
                add(.warning, "Ten komputer jest gotowy, ale w folderze nie ma jeszcze pliku z drugiego komputera. Syncthing przenosi tylko pliki, które ktoś zapisał — drugi komputer musi mieć uruchomioną wersję LibreWallet z synchronizacją (0.5.8 lub nowszą), z włączoną synchronizacją i tym samym folderem. Gdy to zrobisz, test pokaże drugi komputer i potwierdzi odbiór w obie strony.")
                testState = .finished(checks)
                return
            }
            for p in peers {
                let age = Int(Date().timeIntervalSince(p.exportedAt))
                add(.ok, "Odbieram dane z „\(p.deviceName)” (plik sprzed \(Self.ageText(age))).")
            }

            // 4. Did the other side read OUR file? (it acknowledges within ~45 s + Syncthing delay)
            let deadline = Date().addingTimeInterval(90)
            var confirmed: Set<String> = []
            while Date() < deadline && confirmed.count < peers.count {
                let left = Int(deadline.timeIntervalSinceNow)
                testState = .running("Czekam na potwierdzenie z drugiego komputera… (\(left) s)")
                for ack in readAcks(in: folder) {
                    if let seen = ack.seen[deviceId.uuidString], seen >= sentAt - 0.001 { confirmed.insert(ack.deviceId.uuidString) }
                }
                if confirmed.count >= peers.count { break }
                try? await Task.sleep(nanoseconds: 3 * 1_000_000_000)
            }
            for p in peers {
                if confirmed.contains(p.deviceId.uuidString) {
                    add(.ok, "„\(p.deviceName)” potwierdził odebranie moich danych — synchronizacja działa w obie strony.")
                } else {
                    add(.warning, "„\(p.deviceName)” nie potwierdził jeszcze odbioru. Upewnij się, że LibreWallet jest tam uruchomiony, i spróbuj ponownie za chwilę.")
                }
            }
            testState = .finished(checks)
        }
    }

    func dismissTestResult() { testState = .idle }

    private static func ageText(_ seconds: Int) -> String {
        if seconds < 90 { return "\(max(seconds, 0)) s" }
        if seconds < 5400 { return "\(seconds / 60) min" }
        if seconds < 172_800 { return "\(seconds / 3600) h" }
        return "\(seconds / 86_400) dni"
    }

    // MARK: - Base store

    private static var supportDir: URL {
        LWModelContainer.storeURL().deletingLastPathComponent()
    }

    private static var baseURL: URL { supportDir.appendingPathComponent("sync-base.json") }

    private static func loadBases() -> [String: SyncBase] {
        guard let data = try? Data(contentsOf: baseURL) else { return [:] }
        return (try? JSONDecoder().decode([String: SyncBase].self, from: data)) ?? [:]
    }

    private static func saveBases(_ bases: [String: SyncBase]) {
        guard let data = try? JSONEncoder().encode(bases) else { return }
        try? data.write(to: baseURL, options: .atomic)
    }

    /// Full JSON backup before a merge modifies data; keeps the 10 most recent.
    private static func writeSafetyBackup(context: ModelContext) throws {
        let dir = supportDir.appendingPathComponent("SyncBackups", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        try BackupService.export(context: context).write(to: dir.appendingPathComponent("before-sync-\(stamp).json"))
        let old = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("before-sync-") }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .dropFirst(10)
        for url in old { try? FileManager.default.removeItem(at: url) }
    }

    // MARK: - Database <-> state

    static func currentState(context: ModelContext) throws -> SyncState {
        let groups = try context.fetch(FetchDescriptor<PortfolioGroup>())
        let portfolios = try context.fetch(FetchDescriptor<Portfolio>())
        let transactions = try context.fetch(FetchDescriptor<Transaction>())
        let targets = try context.fetch(FetchDescriptor<AllocationTarget>())
        return SyncState(
            groups: groups.map { .init(id: $0.id, name: $0.name, colorHex: $0.colorHex, createdAt: $0.createdAt) },
            portfolios: portfolios.map {
                .init(
                    id: $0.id, groupId: $0.group?.id, name: $0.name, baseCurrency: $0.baseCurrency,
                    colorHex: $0.colorHex, kindRaw: $0.kindRaw, createdAt: $0.createdAt
                )
            },
            transactions: transactions.map {
                .init(
                    id: $0.id, portfolioId: $0.portfolio?.id, date: $0.date, typeRaw: $0.typeRaw,
                    symbol: $0.symbol, name: $0.name, quantity: $0.quantity, price: $0.price,
                    gross: $0.gross, fee: $0.fee, currency: $0.currency, cashDelta: $0.cashDelta,
                    externalId: $0.externalId, notes: $0.notes, source: $0.source, assetType: $0.assetType
                )
            },
            targets: targets.map {
                .init(id: $0.id, portfolioId: $0.portfolio?.id, assetType: $0.assetType, targetPct: $0.targetPct, createdAt: $0.createdAt)
            }
        )
    }

    static func apply(_ plan: SyncPlan, context: ModelContext) throws {
        var groups = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<PortfolioGroup>()).map { ($0.id, $0) })
        var portfolios = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<Portfolio>()).map { ($0.id, $0) })
        var targets = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<AllocationTarget>()).map { ($0.id, $0) })
        var transactions = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<Transaction>()).map { ($0.id, $0) })

        // Deletions first (children before parents; cascade rules handle the rest).
        for id in plan.deleteTransactionIds { if let o = transactions.removeValue(forKey: id) { context.delete(o) } }
        for id in plan.deleteTargetIds { if let o = targets.removeValue(forKey: id) { context.delete(o) } }
        for id in plan.deletePortfolioIds {
            if let o = portfolios.removeValue(forKey: id) {
                for tx in o.transactions { transactions[tx.id] = nil }
                context.delete(o)
            }
        }
        for id in plan.deleteGroupIds {
            if let o = groups.removeValue(forKey: id) {
                for p in o.portfolios {
                    for tx in p.transactions { transactions[tx.id] = nil }
                    portfolios[p.id] = nil
                }
                context.delete(o)
            }
        }

        for dto in plan.upsertGroups {
            if let g = groups[dto.id] {
                g.name = dto.name
                g.colorHex = dto.colorHex
                g.createdAt = dto.createdAt
            } else {
                let g = PortfolioGroup(id: dto.id, name: dto.name, colorHex: dto.colorHex, createdAt: dto.createdAt)
                context.insert(g)
                groups[dto.id] = g
            }
        }

        for dto in plan.upsertPortfolios {
            let group = dto.groupId.flatMap { groups[$0] }
            if let p = portfolios[dto.id] {
                p.name = dto.name
                p.baseCurrency = CurrencyCode.normalize(dto.baseCurrency)
                p.colorHex = dto.colorHex
                p.kindRaw = dto.kindRaw
                p.createdAt = dto.createdAt
                p.group = group
            } else {
                let p = Portfolio(
                    id: dto.id, name: dto.name, baseCurrency: CurrencyCode.normalize(dto.baseCurrency),
                    colorHex: dto.colorHex, kind: PortfolioKind(rawValue: dto.kindRaw) ?? .manual,
                    createdAt: dto.createdAt, group: group
                )
                context.insert(p)
                portfolios[dto.id] = p
            }
        }

        for dto in plan.upsertTargets {
            let portfolio = dto.portfolioId.flatMap { portfolios[$0] }
            if let t = targets[dto.id] {
                t.assetType = dto.assetType
                t.targetPct = dto.targetPct
                t.createdAt = dto.createdAt
                t.portfolio = portfolio
            } else {
                let t = AllocationTarget(id: dto.id, assetType: dto.assetType, targetPct: dto.targetPct, createdAt: dto.createdAt, portfolio: portfolio)
                context.insert(t)
                targets[dto.id] = t
            }
        }

        for dto in plan.upsertTransactions {
            let portfolio = dto.portfolioId.flatMap { portfolios[$0] }
            if let t = transactions[dto.id] {
                t.date = dto.date
                t.typeRaw = dto.typeRaw
                t.symbol = dto.symbol
                t.name = dto.name
                t.quantity = dto.quantity
                t.price = dto.price
                t.gross = dto.gross
                t.fee = dto.fee
                t.currency = CurrencyCode.normalize(dto.currency)
                t.cashDelta = dto.cashDelta
                t.externalId = dto.externalId
                t.notes = dto.notes
                t.source = dto.source
                t.assetType = dto.assetType
                t.portfolio = portfolio
            } else {
                let t = Transaction(
                    id: dto.id, date: dto.date, type: TransactionType(rawValue: dto.typeRaw) ?? .other,
                    symbol: dto.symbol, name: dto.name, quantity: dto.quantity, price: dto.price,
                    gross: dto.gross, fee: dto.fee, currency: CurrencyCode.normalize(dto.currency),
                    cashDelta: dto.cashDelta, externalId: dto.externalId, notes: dto.notes,
                    source: dto.source, assetType: dto.assetType, portfolio: portfolio
                )
                context.insert(t)
                transactions[dto.id] = t
            }
        }

        try context.save()
    }

    enum SyncError: LocalizedError {
        case folderMissing

        var errorDescription: String? {
            switch self {
            case .folderMissing: "Folder synchronizacji nie istnieje."
            }
        }
    }
}
