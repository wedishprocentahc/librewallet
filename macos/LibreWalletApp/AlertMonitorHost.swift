import SwiftUI
import SwiftData
import UserNotifications

/// Background host: while the app is open, periodically refreshes quotes (when needed)
/// and fires system notifications for price + allocation-drift alerts.
struct AlertMonitorHost: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \AllocationTarget.createdAt) private var targets: [AllocationTarget]
    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]

    @State private var lastQuoteRefreshAt: Date?

    /// How often to re-check local quotes / drift (seconds).
    private let evaluateInterval: TimeInterval = 45
    /// Fallback quote refresh when auto-refresh is off but alerts are active (seconds).
    private let alertQuoteRefreshFallback: TimeInterval = 5 * 60

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .task {
                PriceAlertService.configure()
                _ = await PriceAlertService.requestAuthorization()
                await runLoop()
            }
    }

    private func runLoop() async {
        await checkOnce(forceRefreshQuotes: true)
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(evaluateInterval * 1_000_000_000))
            guard !Task.isCancelled else { break }
            await checkOnce(forceRefreshQuotes: false)
        }
    }

    @MainActor
    private func checkOnce(forceRefreshQuotes: Bool) async {
        let hasPrice = appState.priceAlerts.contains(where: \.enabled)
        let hasDrift = appState.allocationDriftPct > 0
        guard hasPrice || hasDrift else { return }

        if forceRefreshQuotes || shouldRefreshQuotes(hasPriceAlerts: hasPrice) {
            do {
                try await PricingService.refreshQuotes(for: Array(transactions), context: context)
                lastQuoteRefreshAt = Date()
            } catch {
                // Keep evaluating against last known quotes.
            }
        }

        await evaluateAndNotify()
    }

    private func shouldRefreshQuotes(hasPriceAlerts: Bool) -> Bool {
        guard hasPriceAlerts else { return false }
        let now = Date()
        let elapsed = lastQuoteRefreshAt.map { now.timeIntervalSince($0) } ?? .infinity
        let minutes = appState.autoRefreshMinutes
        if minutes > 0 {
            return elapsed >= Double(minutes) * 60
        }
        return elapsed >= alertQuoteRefreshFallback
    }

    @MainActor
    private func evaluateAndNotify(force: Bool = false) async {
        // Price alerts
        var alerts = appState.priceAlerts
        let hit = PriceAlertService.evaluate(quotes: Array(quotes), alerts: alerts, force: force)
        await PriceAlertService.notifyPrice(hit, updating: &alerts)
        if alerts != appState.priceAlerts {
            appState.priceAlerts = alerts
        }

        // Drift (scope from preferences / Alerts screen)
        let scope = appState.alertDriftScope
        let scoped = scopedPortfolios(for: scope)
        guard !scoped.isEmpty else { return }

        let rates = appState.ratesToPLN(from: NBPExchangeRateService.cachedRatesToPLN())
        let scopeResult: ScopeResult
        if scoped.count == 1, let portfolio = scoped.first {
            scopeResult = PortfolioCalculator.calculate(
                portfolio: portfolio,
                allTransactions: Array(transactions),
                quotes: Array(quotes),
                ratesToPLN: rates
            )
        } else {
            scopeResult = PortfolioCalculator.aggregateToPLN(
                portfolios: scoped,
                allTransactions: Array(transactions),
                quotes: Array(quotes),
                ratesToPLN: rates
            )
        }

        let targetMap = targetPercentages(for: scope)
        let items = PriceAlertService.allocationDriftItems(
            scope: scopeResult,
            targets: targetMap,
            thresholdPct: appState.allocationDriftPct
        )
        await PriceAlertService.notifyDrift(items, force: force)
    }

    private func scopedPortfolios(for scope: SavedAlertScope) -> [Portfolio] {
        switch scope {
        case .all:
            return Array(portfolios)
        case .group(let gid):
            return portfolios.filter { $0.group?.id == gid }
        case .portfolio(let pid):
            return portfolios.filter { $0.id == pid }
        }
    }

    private func targetPercentages(for scope: SavedAlertScope) -> [String: Double] {
        switch scope {
        case .all:
            let list = targets.filter { $0.portfolio == nil }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        case .group(let gid):
            guard let first = portfolios.first(where: { $0.group?.id == gid }) else { return [:] }
            let list = targets.filter { $0.portfolio?.id == first.id }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        case .portfolio(let pid):
            let list = targets.filter { $0.portfolio?.id == pid }
            return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
        }
    }
}
