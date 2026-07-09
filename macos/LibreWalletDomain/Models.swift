import Foundation
import SwiftData

@Model
final class PortfolioGroup {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date

    @Relationship(deleteRule: .cascade, inverse: \Portfolio.group)
    var portfolios: [Portfolio] = []

    init(id: UUID = UUID(), name: String, createdAt: Date) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
    }
}

enum PortfolioKind: String, Codable, CaseIterable {
    case account
    case manual
}

@Model
final class Portfolio {
    @Attribute(.unique) var id: UUID
    var name: String
    var baseCurrency: String
    var colorHex: String
    var kindRaw: String
    var createdAt: Date

    @Relationship var group: PortfolioGroup?
    @Relationship(deleteRule: .cascade, inverse: \Transaction.portfolio)
    var transactions: [Transaction] = []

    init(
        id: UUID = UUID(),
        name: String,
        baseCurrency: String,
        colorHex: String,
        kind: PortfolioKind,
        createdAt: Date,
        group: PortfolioGroup?
    ) {
        self.id = id
        self.name = name
        self.baseCurrency = baseCurrency
        self.colorHex = colorHex
        self.kindRaw = kind.rawValue
        self.createdAt = createdAt
        self.group = group
    }

    var kind: PortfolioKind {
        get { PortfolioKind(rawValue: kindRaw) ?? .account }
        set { kindRaw = newValue.rawValue }
    }
}

enum TransactionType: String, Codable, CaseIterable {
    case buy
    case sell
    case deposit
    case withdrawal
    case transfer
    case fee
    case tax
    case dividend
    case interest
    case other
}

@Model
final class Transaction {
    @Attribute(.unique) var id: UUID
    var date: Date
    var typeRaw: String
    var symbol: String?
    var name: String?
    var quantity: Double?
    var price: Double?
    var gross: Double
    var fee: Double
    var currency: String
    var cashDelta: Double?
    var externalId: String?
    var notes: String?
    var source: String?
    var assetType: String?

    @Relationship var portfolio: Portfolio?

    init(
        id: UUID = UUID(),
        date: Date,
        type: TransactionType,
        symbol: String? = nil,
        name: String? = nil,
        quantity: Double? = nil,
        price: Double? = nil,
        gross: Double,
        fee: Double,
        currency: String,
        cashDelta: Double? = nil,
        externalId: String? = nil,
        notes: String? = nil,
        source: String? = nil,
        assetType: String? = nil,
        portfolio: Portfolio?
    ) {
        self.id = id
        self.date = date
        self.typeRaw = type.rawValue
        self.symbol = symbol
        self.name = name
        self.quantity = quantity
        self.price = price
        self.gross = gross
        self.fee = fee
        self.currency = currency
        self.cashDelta = cashDelta
        self.externalId = externalId
        self.notes = notes
        self.source = source
        self.assetType = assetType
        self.portfolio = portfolio
    }

    var type: TransactionType {
        get { TransactionType(rawValue: typeRaw) ?? .other }
        set { typeRaw = newValue.rawValue }
    }
}

@Model
final class BondHolding {
    @Attribute(.unique) var id: UUID
    var symbol: String
    var currency: String
    var termMonths: Int
    var firstYearRate: Double
    var margin: Double
    var indexation: String
    var capitalization: Bool
    var earlyRedemptionFee: Double

    @Relationship var portfolio: Portfolio?

    init(
        id: UUID = UUID(),
        symbol: String,
        currency: String,
        termMonths: Int,
        firstYearRate: Double,
        margin: Double,
        indexation: String,
        capitalization: Bool,
        earlyRedemptionFee: Double,
        portfolio: Portfolio?
    ) {
        self.id = id
        self.symbol = symbol
        self.currency = currency
        self.termMonths = termMonths
        self.firstYearRate = firstYearRate
        self.margin = margin
        self.indexation = indexation
        self.capitalization = capitalization
        self.earlyRedemptionFee = earlyRedemptionFee
        self.portfolio = portfolio
    }
}

@Model
final class AllocationTarget {
    @Attribute(.unique) var id: UUID
    var assetType: String
    var targetPct: Double
    var createdAt: Date

    @Relationship var portfolio: Portfolio?

    init(id: UUID = UUID(), assetType: String, targetPct: Double, createdAt: Date, portfolio: Portfolio?) {
        self.id = id
        self.assetType = assetType
        self.targetPct = targetPct
        self.createdAt = createdAt
        self.portfolio = portfolio
    }
}

enum AssetTypeDefaults {
    static let supported: [String] = ["etf", "stock", "bond", "cash", "other"]
}

@Model
final class Quote {
    @Attribute(.unique) var id: UUID
    var symbol: String
    var currency: String
    var price: Double
    var asOf: Date

    init(id: UUID = UUID(), symbol: String, currency: String, price: Double, asOf: Date) {
        self.id = id
        self.symbol = symbol
        self.currency = currency
        self.price = price
        self.asOf = asOf
    }
}

