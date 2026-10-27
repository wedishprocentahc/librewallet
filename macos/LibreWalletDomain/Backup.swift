import Foundation
import SwiftData
import UniformTypeIdentifiers
import SwiftUI

struct LWBackup: Codable {
    let format: String
    let version: Int
    let exportedAt: Date

    let groups: [GroupDTO]
    let portfolios: [PortfolioDTO]
    let transactions: [TransactionDTO]
    let targets: [TargetDTO]
    let quotes: [QuoteDTO]
    /// Added in v2; absent in v1 files.
    let bonds: [BondDTO]?
    /// Added in v2; absent in v1 files.
    let alerts: [PriceAlert]?

    static let formatId = "librewallet-backup"
    static let currentVersion = 2

    struct GroupDTO: Codable, Equatable {
        let id: UUID
        let name: String
        let colorHex: String
        let createdAt: Date
    }

    struct PortfolioDTO: Codable, Equatable {
        let id: UUID
        let groupId: UUID?
        let name: String
        let baseCurrency: String
        let colorHex: String
        let kindRaw: String
        let createdAt: Date
    }

    struct TransactionDTO: Codable, Equatable {
        let id: UUID
        let portfolioId: UUID?
        let date: Date
        let typeRaw: String
        let symbol: String?
        let name: String?
        let quantity: Double?
        let price: Double?
        let gross: Double
        let fee: Double
        let currency: String
        let cashDelta: Double?
        let externalId: String?
        let notes: String?
        let source: String?
        let assetType: String?
    }

    struct TargetDTO: Codable, Equatable {
        let id: UUID
        let portfolioId: UUID?
        let assetType: String
        let targetPct: Double
        let createdAt: Date
    }

    struct BondDTO: Codable, Equatable {
        let id: UUID
        let portfolioId: UUID?
        let symbol: String
        let currency: String
        let termMonths: Int
        let firstYearRate: Double
        let margin: Double
        let indexation: String
        let capitalization: Bool
        let earlyRedemptionFee: Double
    }

    struct QuoteDTO: Codable {
        let id: UUID
        let symbol: String
        let currency: String
        let price: Double
        let asOf: Date
    }
}

enum BackupService {
    static func export(context: ModelContext, alerts: [PriceAlert] = AppPreferences.priceAlerts) throws -> Data {
        let groups = try context.fetch(FetchDescriptor<PortfolioGroup>())
        let portfolios = try context.fetch(FetchDescriptor<Portfolio>())
        let transactions = try context.fetch(FetchDescriptor<Transaction>())
        let targets = try context.fetch(FetchDescriptor<AllocationTarget>())
        let quotes = try context.fetch(FetchDescriptor<Quote>())
        let bonds = try context.fetch(FetchDescriptor<BondHolding>())

        let backup = LWBackup(
            format: LWBackup.formatId,
            version: LWBackup.currentVersion,
            exportedAt: .now,
            groups: groups.map { .init(id: $0.id, name: $0.name, colorHex: $0.colorHex, createdAt: $0.createdAt) },
            portfolios: portfolios.map {
                .init(
                    id: $0.id,
                    groupId: $0.group?.id,
                    name: $0.name,
                    baseCurrency: $0.baseCurrency,
                    colorHex: $0.colorHex,
                    kindRaw: $0.kindRaw,
                    createdAt: $0.createdAt
                )
            },
            transactions: transactions.map {
                .init(
                    id: $0.id,
                    portfolioId: $0.portfolio?.id,
                    date: $0.date,
                    typeRaw: $0.typeRaw,
                    symbol: $0.symbol,
                    name: $0.name,
                    quantity: $0.quantity,
                    price: $0.price,
                    gross: $0.gross,
                    fee: $0.fee,
                    currency: $0.currency,
                    cashDelta: $0.cashDelta,
                    externalId: $0.externalId,
                    notes: $0.notes,
                    source: $0.source,
                    assetType: $0.assetType
                )
            },
            targets: targets.map {
                .init(
                    id: $0.id,
                    portfolioId: $0.portfolio?.id,
                    assetType: $0.assetType,
                    targetPct: $0.targetPct,
                    createdAt: $0.createdAt
                )
            },
            quotes: quotes.map { .init(id: $0.id, symbol: $0.symbol, currency: $0.currency, price: $0.price, asOf: $0.asOf) },
            bonds: bonds.map {
                .init(
                    id: $0.id,
                    portfolioId: $0.portfolio?.id,
                    symbol: $0.symbol,
                    currency: $0.currency,
                    termMonths: $0.termMonths,
                    firstYearRate: $0.firstYearRate,
                    margin: $0.margin,
                    indexation: $0.indexation,
                    capitalization: $0.capitalization,
                    earlyRedemptionFee: $0.earlyRedemptionFee
                )
            },
            alerts: alerts
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(backup)
    }

    static func `import`(data: Data, context: ModelContext, wipeExisting: Bool) throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let backup = try decoder.decode(LWBackup.self, from: data)
        guard backup.format == LWBackup.formatId else {
            throw BackupError.invalidFormat
        }
        guard backup.version <= LWBackup.currentVersion else {
            throw BackupError.unsupportedVersion(backup.version)
        }

        if wipeExisting {
            try wipe(context: context)
        }

        let groupsById: [UUID: PortfolioGroup] = Dictionary(uniqueKeysWithValues: backup.groups.map { dto in
            let g = PortfolioGroup(id: dto.id, name: dto.name, colorHex: dto.colorHex, createdAt: dto.createdAt)
            context.insert(g)
            return (dto.id, g)
        })

        let portfoliosById: [UUID: Portfolio] = Dictionary(uniqueKeysWithValues: backup.portfolios.map { dto in
            let p = Portfolio(
                id: dto.id,
                name: dto.name,
                baseCurrency: CurrencyCode.normalize(dto.baseCurrency),
                colorHex: dto.colorHex,
                kind: PortfolioKind(rawValue: dto.kindRaw) ?? .manual,
                createdAt: dto.createdAt,
                group: dto.groupId.flatMap { groupsById[$0] }
            )
            context.insert(p)
            return (dto.id, p)
        })

        for dto in backup.transactions {
            let tx = Transaction(
                id: dto.id,
                date: dto.date,
                type: TransactionType(rawValue: dto.typeRaw) ?? .other,
                symbol: dto.symbol,
                name: dto.name,
                quantity: dto.quantity,
                price: dto.price,
                gross: dto.gross,
                fee: dto.fee,
                currency: CurrencyCode.normalize(dto.currency),
                cashDelta: dto.cashDelta,
                externalId: dto.externalId,
                notes: dto.notes,
                source: dto.source,
                assetType: dto.assetType,
                portfolio: dto.portfolioId.flatMap { portfoliosById[$0] }
            )
            context.insert(tx)
        }

        for dto in backup.targets {
            let t = AllocationTarget(
                id: dto.id,
                assetType: dto.assetType,
                targetPct: dto.targetPct,
                createdAt: dto.createdAt,
                portfolio: dto.portfolioId.flatMap { portfoliosById[$0] }
            )
            context.insert(t)
        }

        for dto in backup.quotes {
            context.insert(Quote(id: dto.id, symbol: dto.symbol, currency: dto.currency, price: dto.price, asOf: dto.asOf))
        }

        for dto in backup.bonds ?? [] {
            context.insert(BondHolding(
                id: dto.id,
                symbol: dto.symbol,
                currency: CurrencyCode.normalize(dto.currency),
                termMonths: dto.termMonths,
                firstYearRate: dto.firstYearRate,
                margin: dto.margin,
                indexation: dto.indexation,
                capitalization: dto.capitalization,
                earlyRedemptionFee: dto.earlyRedemptionFee,
                portfolio: dto.portfolioId.flatMap { portfoliosById[$0] }
            ))
        }

        // A full restore replaces alerts too; a v1 file has none, so keep the current ones.
        if wipeExisting, let alerts = backup.alerts {
            AppPreferences.priceAlerts = alerts
        }

        try context.save()
    }

    static func wipe(context: ModelContext) throws {
        for tx in try context.fetch(FetchDescriptor<Transaction>()) { context.delete(tx) }
        for t in try context.fetch(FetchDescriptor<AllocationTarget>()) { context.delete(t) }
        for q in try context.fetch(FetchDescriptor<Quote>()) { context.delete(q) }
        for p in try context.fetch(FetchDescriptor<Portfolio>()) { context.delete(p) }
        for g in try context.fetch(FetchDescriptor<PortfolioGroup>()) { context.delete(g) }
        // BondHolding may exist in schema
        if let bonds = try? context.fetch(FetchDescriptor<BondHolding>()) {
            for b in bonds { context.delete(b) }
        }
        try context.save()
    }

    enum BackupError: LocalizedError {
        case invalidFormat
        case unsupportedVersion(Int)

        var errorDescription: String? {
            switch self {
            case .invalidFormat: "To nie jest backup LibreWallet."
            case .unsupportedVersion(let v): "Backup w nowszej wersji formatu (\(v)) — zaktualizuj LibreWallet."
            }
        }
    }
}

struct LWBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    static var writableContentTypes: [UTType] { [.json] }

    var data: Data

    init(data: Data = Data()) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        self.data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

