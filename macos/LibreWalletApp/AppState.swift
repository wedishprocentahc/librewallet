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

    /// Short-lived success/error banner shown from RootView.
    @Published private(set) var feedback: AppFeedback?
    private var feedbackClearTask: Task<Void, Never>?

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

    func notifySuccess(_ message: String) {
        presentFeedback(AppFeedback(kind: .success, message: message))
    }

    func notifyError(_ message: String) {
        presentFeedback(AppFeedback(kind: .error, message: message))
    }

    func dismissFeedback() {
        feedbackClearTask?.cancel()
        feedbackClearTask = nil
        feedback = nil
    }

    private func presentFeedback(_ item: AppFeedback) {
        feedbackClearTask?.cancel()
        // Force a visible transition even when replacing an existing banner quickly.
        feedback = nil
        feedback = item
        feedbackClearTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            guard !Task.isCancelled, feedback?.id == item.id else { return }
            feedback = nil
            feedbackClearTask = nil
        }
    }
}
