import SwiftUI
import SwiftData

struct RebalanceView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]
    @Query(sort: \AllocationTarget.createdAt) private var targets: [AllocationTarget]
    @Query(sort: \Quote.asOf, order: .reverse) private var quotes: [Quote]

    @State private var selectedPortfolioId: UUID?

    var body: some View {
        let portfolio = selectedPortfolio
        let scope = PortfolioCalculator.calculate(portfolio: portfolio, allTransactions: transactions, quotes: quotes)
        let targetMap = targetPercentages(for: portfolio)
        let suggestions = rebalanceSuggestions(scope: scope, targets: targetMap)

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GroupBox("Cele (w %)") {
                    VStack(spacing: 8) {
                        ForEach(AssetTypeDefaults.supported, id: \.self) { key in
                            TargetRow(
                                assetType: key,
                                targetPct: Binding(
                                    get: { targetMap[key] ?? 0 },
                                    set: { setTargetPct($0, assetType: key, portfolio: portfolio) }
                                )
                            )
                        }
                    }
                    .padding(.top, 6)
                }

                GroupBox("Sugestie (wartościowe, wg typu)") {
                    if suggestions.isEmpty {
                        ContentUnavailableView("Brak sugestii", systemImage: "arrow.left.arrow.right", description: Text("Dodaj cele albo operacje."))
                            .frame(maxWidth: .infinity, minHeight: 180)
                    } else {
                        VStack(spacing: 10) {
                            ForEach(suggestions) { s in
                                HStack {
                                    Text(label(for: s.assetType))
                                    Spacer()
                                    Text(LWFormatting.money(s.deltaValue, currency: scope.baseCurrency))
                                        .foregroundStyle(s.deltaValue >= 0 ? .green : .red)
                                }
                                Divider()
                            }
                        }
                        .padding(.top, 6)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Rebalancing")
        .onAppear {
            selectedPortfolioId = appState.selectedPortfolioId ?? portfolios.first?.id
        }
    }

    private var selectedPortfolio: Portfolio? {
        let pid = selectedPortfolioId ?? appState.selectedPortfolioId
        guard let pid else { return portfolios.first }
        return portfolios.first(where: { $0.id == pid }) ?? portfolios.first
    }

    private func targetPercentages(for portfolio: Portfolio?) -> [String: Double] {
        guard let portfolio else { return [:] }
        let list = targets.filter { $0.portfolio?.id == portfolio.id }
        return Dictionary(uniqueKeysWithValues: list.map { ($0.assetType, $0.targetPct) })
    }

    private func setTargetPct(_ pct: Double, assetType: String, portfolio: Portfolio?) {
        guard let portfolio else { return }
        if let existing = targets.first(where: { $0.portfolio?.id == portfolio.id && $0.assetType == assetType }) {
            existing.targetPct = pct
        } else {
            let t = AllocationTarget(assetType: assetType, targetPct: pct, createdAt: .now, portfolio: portfolio)
            context.insert(t)
        }
        try? context.save()
    }

    private func rebalanceSuggestions(scope: ScopeResult, targets: [String: Double]) -> [RebalanceSuggestion] {
        guard scope.totalValueBase > 0 else { return [] }
        let total = scope.totalValueBase
        let current = scope.allocationByType

        var out: [RebalanceSuggestion] = []
        for key in AssetTypeDefaults.supported {
            let targetPct = targets[key] ?? 0
            if targetPct <= 0 { continue }
            let targetValue = (targetPct / 100.0) * total
            let currentValue = current[key] ?? 0
            let delta = targetValue - currentValue
            if abs(delta) < max(1.0, total * 0.002) { continue }
            out.append(RebalanceSuggestion(assetType: key, deltaValue: delta))
        }
        return out.sorted { abs($0.deltaValue) > abs($1.deltaValue) }
    }

    private func label(for assetType: String) -> String {
        switch assetType {
        case "etf": "ETF"
        case "stock": "Akcje"
        case "bond": "Obligacje"
        case "cash": "Gotówka"
        case "other": "Inne"
        default: assetType
        }
    }
}

private struct TargetRow: View {
    let assetType: String
    @Binding var targetPct: Double

    var body: some View {
        HStack {
            Text(label)
                .frame(width: 120, alignment: .leading)
            Slider(value: $targetPct, in: 0...100, step: 1)
            Text("\(Int(targetPct))%")
                .frame(width: 44, alignment: .trailing)
                .monospacedDigit()
        }
    }

    private var label: String {
        switch assetType {
        case "etf": "ETF"
        case "stock": "Akcje"
        case "bond": "Obligacje"
        case "cash": "Gotówka"
        case "other": "Inne"
        default: assetType
        }
    }
}

private struct RebalanceSuggestion: Identifiable {
    let id = UUID()
    let assetType: String
    let deltaValue: Double
}

