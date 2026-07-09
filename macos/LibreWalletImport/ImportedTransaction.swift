import Foundation

struct ImportedTransaction: Identifiable, Hashable {
    let id: UUID
    let date: Date
    let type: TransactionType
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
    let account: String?

    init(
        id: UUID = UUID(),
        date: Date,
        type: TransactionType,
        symbol: String?,
        name: String?,
        quantity: Double?,
        price: Double?,
        gross: Double,
        fee: Double,
        currency: String,
        cashDelta: Double? = nil,
        externalId: String? = nil,
        notes: String? = nil,
        source: String? = nil,
        assetType: String? = nil,
        account: String? = nil
    ) {
        self.id = id
        self.date = date
        self.type = type
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
        self.account = account
    }

    var dateText: String {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .none
        return f.string(from: date)
    }
}

