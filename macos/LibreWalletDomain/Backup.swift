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

    static let formatId = "librewallet-backup"
    static let currentVersion = 1

    struct GroupDTO: Codable {
        let id: UUID
        let name: String
        let colorHex: String
        let createdAt: Date
    }

    struct PortfolioDTO: Codable {
        let id: UUID
        let groupId: UUID?
        let name: String
        let baseCurrency: String
        let colorHex: String
        let kindRaw: String
        let createdAt: Date
    }

    struct TransactionDTO: Codable {
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

    struct TargetDTO: Codable {
        let id: UUID
        let portfolioId: UUID?
        let assetType: String
        let targetPct: Double
        let createdAt: Date
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
    static func export(context: ModelContext) throws -> Data {
        let groups = try context.fetch(FetchDescriptor<PortfolioGroup>())
        let portfolios = try context.fetch(FetchDescriptor<Portfolio>())
        let transactions = try context.fetch(FetchDescriptor<Transaction>())
        let targets = try context.fetch(FetchDescriptor<AllocationTarget>())
        let quotes = try context.fetch(FetchDescriptor<Quote>())

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
            quotes: quotes.map { .init(id: $0.id, symbol: $0.symbol, currency: $0.currency, price: $0.price, asOf: $0.asOf) }
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
                baseCurrency: dto.baseCurrency,
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
                currency: dto.currency,
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

        try context.save()
    }

    private static func wipe(context: ModelContext) throws {
        for tx in try context.fetch(FetchDescriptor<Transaction>()) { context.delete(tx) }
        for t in try context.fetch(FetchDescriptor<AllocationTarget>()) { context.delete(t) }
        for q in try context.fetch(FetchDescriptor<Quote>()) { context.delete(q) }
        for p in try context.fetch(FetchDescriptor<Portfolio>()) { context.delete(p) }
        for g in try context.fetch(FetchDescriptor<PortfolioGroup>()) { context.delete(g) }
        try context.save()
    }

    enum BackupError: LocalizedError {
        case invalidFormat

        var errorDescription: String? {
            switch self {
            case .invalidFormat: "To nie jest backup LibreWallet."
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

