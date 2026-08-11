import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var selectedPortfolioId: UUID?
    @Published var selectedGroupId: UUID?
    @Published var navigationSelection: NavigationDestination? = .dashboard

    @Published var language: AppLanguage = AppPreferences.language {
        didSet { AppPreferences.language = language }
    }

    @Published var autoRefreshMinutes: Int = AppPreferences.autoRefreshMinutes {
        didSet { AppPreferences.autoRefreshMinutes = autoRefreshMinutes }
    }

    @Published var fxOverrides: [String: Double] = AppPreferences.fxOverrides {
        didSet { AppPreferences.fxOverrides = fxOverrides }
    }

    @Published var priceAlerts: [PriceAlert] = AppPreferences.priceAlerts {
        didSet { AppPreferences.priceAlerts = priceAlerts }
    }

    @Published var allocationDriftPct: Double = AppPreferences.allocationDriftPct {
        didSet { AppPreferences.allocationDriftPct = allocationDriftPct }
    }

    @Published var alertDriftScope: SavedAlertScope = AppPreferences.alertDriftScope {
        didSet { AppPreferences.alertDriftScope = alertDriftScope }
    }

    /// Bumped to force UI refresh after language change.
    @Published var localizationEpoch: Int = 0

    func selectPortfolio(_ portfolio: Portfolio) {
        selectedPortfolioId = portfolio.id
        selectedGroupId = portfolio.group?.id
    }

    func setLanguage(_ lang: AppLanguage) {
        language = lang
        localizationEpoch += 1
    }

    func ratesToPLN(from nbp: [String: Double]) -> [String: Double] {
        AppPreferences.mergedRatesToPLN(nbp)
    }
}
