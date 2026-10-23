import Foundation
import CryptoKit

/// Snapshot written by each device into the shared (e.g. Syncthing) folder.
struct LWSyncSnapshot: Codable {
    let format: String
    let version: Int
    let deviceId: UUID
    let deviceName: String
    let exportedAt: Date
    let state: SyncState

    static let formatId = "librewallet-sync"
    static let currentVersion = 1
}

struct SyncState: Codable, Equatable {
    var groups: [LWBackup.GroupDTO] = []
    var portfolios: [LWBackup.PortfolioDTO] = []
    var transactions: [LWBackup.TransactionDTO] = []
    var targets: [LWBackup.TargetDTO] = []
}

/// What we agreed on with one peer the last time we merged (3-way merge base).
struct SyncBase: Codable, Equatable {
    /// "<kind>:<local id>" → content hash both sides had.
    var hashes: [String: String] = [:]
    /// "<kind>:<peer id>" → local id, for records created independently on both devices
    /// (e.g. the same XTB report imported twice) that we matched by content.
    var aliases: [String: String] = [:]
}

struct SyncPlan {
    var upsertGroups: [LWBackup.GroupDTO] = []
    var upsertPortfolios: [LWBackup.PortfolioDTO] = []
    var upsertTransactions: [LWBackup.TransactionDTO] = []
    var upsertTargets: [LWBackup.TargetDTO] = []
    var deleteGroupIds: [UUID] = []
    var deletePortfolioIds: [UUID] = []
    var deleteTransactionIds: [UUID] = []
    var deleteTargetIds: [UUID] = []
    var base = SyncBase()

    var changeCount: Int {
        upsertGroups.count + upsertPortfolios.count + upsertTransactions.count + upsertTargets.count
            + deleteGroupIds.count + deletePortfolioIds.count + deleteTransactionIds.count + deleteTargetIds.count
    }
}


protocol SyncDTO: Codable {
    var id: UUID { get }
    static var syncKind: String { get }
}

extension LWBackup.GroupDTO: SyncDTO { static var syncKind: String { "group" } }
extension LWBackup.PortfolioDTO: SyncDTO { static var syncKind: String { "portfolio" } }
extension LWBackup.TransactionDTO: SyncDTO { static var syncKind: String { "transaction" } }
extension LWBackup.TargetDTO: SyncDTO { static var syncKind: String { "target" } }

/// Three-way merge of two device states (no I/O). Records are matched by UUID; records created
/// independently on both devices are matched by content so a re-import on the second computer
/// does not double the data. Deletions propagate; conflicts resolve deterministically.
enum SyncEngine {
    static func contentHash<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .deferredToDate
        let data = (try? encoder.encode(value)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func hash(_ state: SyncState) -> String {
        var s = state
        s.groups.sort { $0.id.uuidString < $1.id.uuidString }
        s.portfolios.sort { $0.id.uuidString < $1.id.uuidString }
        s.transactions.sort { $0.id.uuidString < $1.id.uuidString }
        s.targets.sort { $0.id.uuidString < $1.id.uuidString }
        return contentHash(s)
    }

    enum Decision: Equatable {
        case none        // nothing to do locally
        case takePeer    // insert/update local from peer
        case deleteLocal
    }

    /// Core rule. `local`/`peer`/`base` are content hashes (nil = absent).
    static func decide(local: String?, peer: String?, base: String?) -> Decision {
        if local == peer { return .none }
        guard let base else {
            if local == nil { return .takePeer }
            if peer == nil { return .none }
            return peer! > local! ? .takePeer : .none  // deterministic tie-break on both sides
        }
        if local == base {
            return peer == nil ? .deleteLocal : .takePeer
        }
        if peer == base { return .none }  // only we changed it; peer will follow
        // Both changed.
        if local == nil { return .takePeer }  // we deleted, peer edited: keep the data
        if peer == nil { return .none }       // peer deleted, we edited: keep ours
        return peer! > local! ? .takePeer : .none
    }

    static func plan(local: SyncState, peer: SyncState, base inBase: SyncBase) -> SyncPlan {
        var base = inBase
        let translated = translate(peer: peer, local: local, base: &base)
        var plan = SyncPlan()

        merge(
            local: local.groups, peer: translated.groups, base: &base,
            upserts: &plan.upsertGroups, deletes: &plan.deleteGroupIds
        )
        merge(
            local: local.portfolios, peer: translated.portfolios, base: &base,
            upserts: &plan.upsertPortfolios, deletes: &plan.deletePortfolioIds
        )
        merge(
            local: local.targets, peer: translated.targets, base: &base,
            upserts: &plan.upsertTargets, deletes: &plan.deleteTargetIds
        )
        merge(
            local: local.transactions, peer: translated.transactions, base: &base,
            upserts: &plan.upsertTransactions, deletes: &plan.deleteTransactionIds
        )
        plan.base = base
        return plan
    }

    // MARK: - Generic merge

    private static func merge<T: SyncDTO>(
        local: [T],
        peer: [T],
        base: inout SyncBase,
        upserts: inout [T],
        deletes: inout [UUID]
    ) {
        let kind = T.syncKind
        var localById: [UUID: (item: T, hash: String)] = [:]
        for item in local { localById[item.id] = (item, contentHash(item)) }
        var peerById: [UUID: (item: T, hash: String)] = [:]
        for item in peer { peerById[item.id] = (item, contentHash(item)) }

        var ids = Set(localById.keys).union(peerById.keys)
        let prefix = "\(kind):"
        for key in base.hashes.keys where key.hasPrefix(prefix) {
            if let id = UUID(uuidString: String(key.dropFirst(prefix.count))) { ids.insert(id) }
        }

        for id in ids {
            let key = prefix + id.uuidString
            let l = localById[id]?.hash
            let p = peerById[id]?.hash
            let b = base.hashes[key]

            switch decide(local: l, peer: p, base: b) {
            case .takePeer:
                if let item = peerById[id]?.item { upserts.append(item) }
                base.hashes[key] = p
            case .deleteLocal:
                deletes.append(id)
                base.hashes[key] = nil
            case .none:
                if l == p {
                    base.hashes[key] = l  // agreed (or both absent → removes entry)
                }
                // else: leave base alone until the peer has caught up.
            }
        }
    }

    // MARK: - Matching independently created records

    private static func translate(peer: SyncState, local: SyncState, base: inout SyncBase) -> SyncState {
        func resolved(kind: String, peerId: UUID, localIds: Set<UUID>, match: () -> UUID?) -> UUID {
            if localIds.contains(peerId) { return peerId }
            let aliasKey = "\(kind):\(peerId.uuidString)"
            if let alias = base.aliases[aliasKey], let id = UUID(uuidString: alias) { return id }
            if base.hashes[aliasKey] != nil { return peerId }  // known id that we deleted locally
            if let id = match() {
                base.aliases[aliasKey] = id.uuidString
                return id
            }
            return peerId
        }

        // Groups
        let localGroupIds = Set(local.groups.map(\.id))
        var claimedGroups = Set(peer.groups.map(\.id)).intersection(localGroupIds)
        var groupMap: [UUID: UUID] = [:]
        var groups: [LWBackup.GroupDTO] = []
        for g in peer.groups {
            let id = resolved(kind: "group", peerId: g.id, localIds: localGroupIds) {
                local.groups.first {
                    !claimedGroups.contains($0.id) && $0.name.caseInsensitiveCompare(g.name) == .orderedSame
                }?.id
            }
            claimedGroups.insert(id)
            groupMap[g.id] = id
            groups.append(.init(id: id, name: g.name, colorHex: g.colorHex, createdAt: g.createdAt))
        }

        // Portfolios
        let localPortfolioIds = Set(local.portfolios.map(\.id))
        var claimedPortfolios = Set(peer.portfolios.map(\.id)).intersection(localPortfolioIds)
        var portfolioMap: [UUID: UUID] = [:]
        var portfolios: [LWBackup.PortfolioDTO] = []
        for p in peer.portfolios {
            let id = resolved(kind: "portfolio", peerId: p.id, localIds: localPortfolioIds) {
                local.portfolios.first {
                    !claimedPortfolios.contains($0.id)
                        && $0.name.caseInsensitiveCompare(p.name) == .orderedSame
                        && $0.baseCurrency.uppercased() == p.baseCurrency.uppercased()
                }?.id
            }
            claimedPortfolios.insert(id)
            portfolioMap[p.id] = id
            portfolios.append(
                .init(
                    id: id,
                    groupId: p.groupId.map { groupMap[$0] ?? $0 },
                    name: p.name,
                    baseCurrency: p.baseCurrency,
                    colorHex: p.colorHex,
                    kindRaw: p.kindRaw,
                    createdAt: p.createdAt
                )
            )
        }

        // Targets
        let localTargetIds = Set(local.targets.map(\.id))
        var claimedTargets = Set(peer.targets.map(\.id)).intersection(localTargetIds)
        var targets: [LWBackup.TargetDTO] = []
        for t in peer.targets {
            let portfolioId = t.portfolioId.map { portfolioMap[$0] ?? $0 }
            let id = resolved(kind: "target", peerId: t.id, localIds: localTargetIds) {
                local.targets.first {
                    !claimedTargets.contains($0.id) && $0.portfolioId == portfolioId && $0.assetType == t.assetType
                }?.id
            }
            claimedTargets.insert(id)
            targets.append(
                .init(id: id, portfolioId: portfolioId, assetType: t.assetType, targetPct: t.targetPct, createdAt: t.createdAt)
            )
        }

        // Transactions: same externalId or same content fingerprint (see ImportDeduper).
        let localTxIds = Set(local.transactions.map(\.id))
        var claimedTx = Set(peer.transactions.map(\.id)).intersection(localTxIds)
        var localByExternal: [String: [LWBackup.TransactionDTO]] = [:]
        var localByFingerprint: [String: [LWBackup.TransactionDTO]] = [:]
        for t in local.transactions {
            if let ext = t.externalId?.trimmingCharacters(in: .whitespacesAndNewlines), !ext.isEmpty {
                localByExternal[ext, default: []].append(t)
            }
            localByFingerprint[fingerprint(t), default: []].append(t)
        }
        var transactions: [LWBackup.TransactionDTO] = []
        for t in peer.transactions {
            let portfolioId = t.portfolioId.map { portfolioMap[$0] ?? $0 }
            let id = resolved(kind: "transaction", peerId: t.id, localIds: localTxIds) {
                if let ext = t.externalId?.trimmingCharacters(in: .whitespacesAndNewlines), !ext.isEmpty,
                   let hit = localByExternal[ext]?.first(where: { !claimedTx.contains($0.id) }) {
                    return hit.id
                }
                return localByFingerprint[fingerprint(t)]?.first(where: { !claimedTx.contains($0.id) })?.id
            }
            claimedTx.insert(id)
            transactions.append(
                .init(
                    id: id,
                    portfolioId: portfolioId,
                    date: t.date,
                    typeRaw: t.typeRaw,
                    symbol: t.symbol,
                    name: t.name,
                    quantity: t.quantity,
                    price: t.price,
                    gross: t.gross,
                    fee: t.fee,
                    currency: t.currency,
                    cashDelta: t.cashDelta,
                    externalId: t.externalId,
                    notes: t.notes,
                    source: t.source,
                    assetType: t.assetType
                )
            )
        }

        return SyncState(groups: groups, portfolios: portfolios, transactions: transactions, targets: targets)
    }

    static func fingerprint(_ t: LWBackup.TransactionDTO) -> String {
        ImportDeduper.fingerprint(
            type: t.typeRaw,
            symbol: t.symbol,
            date: t.date,
            quantity: t.quantity,
            cashDelta: t.cashDelta,
            currency: t.currency
        )
    }
}
