import Foundation

enum AppLanguage: String, CaseIterable, Identifiable {
    case pl
    case en

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pl: "Polski"
        case .en: "English"
        }
    }

    var locale: Locale {
        Locale(identifier: rawValue == "en" ? "en_US" : "pl_PL")
    }
}

struct PriceAlert: Codable, Identifiable, Hashable {
    var id: UUID
    var symbol: String
    var currency: String
    /// Absolute price threshold in quote currency.
    var targetPrice: Double
    /// true = alert when price >= target; false = when price <= target
    var above: Bool
    var enabled: Bool
    var lastTriggeredAt: Date?

    init(
        id: UUID = UUID(),
        symbol: String,
        currency: String = "PLN",
        targetPrice: Double,
        above: Bool = true,
        enabled: Bool = true,
        lastTriggeredAt: Date? = nil
    ) {
        self.id = id
        self.symbol = symbol.uppercased()
        self.currency = currency.uppercased()
        self.targetPrice = targetPrice
        self.above = above
        self.enabled = enabled
        self.lastTriggeredAt = lastTriggeredAt
    }
}

/// Scope used for live allocation-drift monitoring (and Alerts UI).
enum SavedAlertScope: Codable, Hashable {
    case all
    case group(UUID)
    case portfolio(UUID)

    private enum CodingKeys: String, CodingKey {
        case kind, id
    }

    private enum Kind: String, Codable {
        case all, group, portfolio
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(Kind.self, forKey: .kind)
        switch kind {
        case .all:
            self = .all
        case .group:
            self = .group(try c.decode(UUID.self, forKey: .id))
        case .portfolio:
            self = .portfolio(try c.decode(UUID.self, forKey: .id))
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .all:
            try c.encode(Kind.all, forKey: .kind)
        case .group(let id):
            try c.encode(Kind.group, forKey: .kind)
            try c.encode(id, forKey: .id)
        case .portfolio(let id):
            try c.encode(Kind.portfolio, forKey: .kind)
            try c.encode(id, forKey: .id)
        }
    }
}

enum QuoteProvider: String, Codable, Hashable {
    case yahoo
}

/// User override: XTB symbol → exact Yahoo (or other) provider symbol.
struct SymbolMapping: Codable, Identifiable, Hashable {
    /// XTB / LibreWallet symbol (e.g. `DIA.PL`).
    var id: String
    var providerSymbol: String
    var provider: QuoteProvider
    var note: String?

    init(
        id: String,
        providerSymbol: String,
        provider: QuoteProvider = .yahoo,
        note: String? = nil
    ) {
        self.id = id.uppercased()
        self.providerSymbol = providerSymbol.uppercased()
        self.provider = provider
        self.note = note
    }
}

/// Provenance for the last successful quote fetch (keyed by XTB symbol).
struct QuoteResolutionMeta: Codable, Hashable {
    var provider: QuoteProvider
    var providerSymbol: String
    var currency: String
    var asOf: Date
}

enum AppPreferences {
    private static let autoRefreshKey = "lw.autoRefreshMinutes"
    private static let languageKey = "lw.language"
    private static let fxOverridesKey = "lw.fxOverrides"
    private static let alertsKey = "lw.priceAlerts"
    private static let allocationDriftKey = "lw.allocationDriftPct"
    private static let alertDriftScopeKey = "lw.alertDriftScope"
    private static let symbolMappingsKey = "lw.symbolMappings"
    private static let quoteMetaKey = "lw.quoteResolutionMeta"

    /// 0 = off. Common values: 15, 30, 60.
    static var autoRefreshMinutes: Int {
        get {
            if UserDefaults.standard.object(forKey: autoRefreshKey) == nil { return 30 }
            return UserDefaults.standard.integer(forKey: autoRefreshKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: autoRefreshKey) }
    }

    static var language: AppLanguage {
        get {
            let raw = UserDefaults.standard.string(forKey: languageKey) ?? "pl"
            return AppLanguage(rawValue: raw) ?? .pl
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: languageKey) }
    }

    static var fxOverrides: [String: Double] {
        get {
            guard let data = UserDefaults.standard.data(forKey: fxOverridesKey),
                  let decoded = try? JSONDecoder().decode([String: Double].self, from: data) else {
                return [:]
            }
            return decoded
        }
        set {
            let normalized = Dictionary(uniqueKeysWithValues: newValue.map { ($0.key.uppercased(), $0.value) })
            if let data = try? JSONEncoder().encode(normalized) {
                UserDefaults.standard.set(data, forKey: fxOverridesKey)
            }
        }
    }

    static var priceAlerts: [PriceAlert] {
        get {
            guard let data = UserDefaults.standard.data(forKey: alertsKey),
                  let decoded = try? JSONDecoder().decode([PriceAlert].self, from: data) else {
                return []
            }
            return decoded
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: alertsKey)
            }
        }
    }

    /// Alert when allocation drift from target exceeds this percent (0 = off).
    static var allocationDriftPct: Double {
        get {
            if UserDefaults.standard.object(forKey: allocationDriftKey) == nil { return 5 }
            return UserDefaults.standard.double(forKey: allocationDriftKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: allocationDriftKey) }
    }

    static var alertDriftScope: SavedAlertScope {
        get {
            guard let data = UserDefaults.standard.data(forKey: alertDriftScopeKey),
                  let decoded = try? JSONDecoder().decode(SavedAlertScope.self, from: data) else {
                return .all
            }
            return decoded
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: alertDriftScopeKey)
            }
        }
    }

    /// Manual XTB → provider symbol overrides (win over market rules).
    static var symbolMappings: [SymbolMapping] {
        get {
            guard let data = UserDefaults.standard.data(forKey: symbolMappingsKey),
                  let decoded = try? JSONDecoder().decode([SymbolMapping].self, from: data) else {
                return []
            }
            return decoded
        }
        set {
            let normalized = Dictionary(uniqueKeysWithValues: newValue.map { ($0.id, $0) }).values.sorted { $0.id < $1.id }
            if let data = try? JSONEncoder().encode(Array(normalized)) {
                UserDefaults.standard.set(data, forKey: symbolMappingsKey)
            }
        }
    }

    static func upsertSymbolMapping(_ mapping: SymbolMapping) {
        var all = symbolMappings.filter { $0.id != mapping.id }
        all.append(mapping)
        symbolMappings = all
    }

    static func removeSymbolMapping(id: String) {
        let key = id.uppercased()
        symbolMappings = symbolMappings.filter { $0.id != key }
    }

    /// Last successful resolve meta keyed by XTB symbol.
    static var quoteResolutionMeta: [String: QuoteResolutionMeta] {
        get {
            guard let data = UserDefaults.standard.data(forKey: quoteMetaKey),
                  let decoded = try? JSONDecoder().decode([String: QuoteResolutionMeta].self, from: data) else {
                return [:]
            }
            return decoded
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: quoteMetaKey)
            }
        }
    }

    static func setQuoteMeta(_ meta: QuoteResolutionMeta, forXTB symbol: String) {
        var map = quoteResolutionMeta
        map[symbol.uppercased()] = meta
        quoteResolutionMeta = map
    }

    static func mergedRatesToPLN(_ nbp: [String: Double]) -> [String: Double] {
        var rates = nbp
        rates["PLN"] = 1.0
        for (code, rate) in fxOverrides where rate > 0 {
            rates[code.uppercased()] = rate
        }
        return rates
    }
}
