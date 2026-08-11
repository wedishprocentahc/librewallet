import SwiftUI
import SwiftData
import UniformTypeIdentifiers

private enum TaxScopeFilter: Hashable {
    case allTaxable
    case portfolio(UUID)
}

struct TaxReportView: View {
    @EnvironmentObject private var appState: AppState
    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]

    @State private var year: Int = Calendar.current.component(.year, from: Date())
    @State private var scopeFilter: TaxScopeFilter = .allTaxable
    @State private var includeIKE = false
    @State private var report: TaxYearReport?
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var exportDoc: LWCSVDocument?
    @State private var showExport = false

    private var years: [Int] {
        let ys = Set(transactions.map { Calendar.current.component(.year, from: $0.date) })
        let current = Calendar.current.component(.year, from: Date())
        return ys.union([current]).sorted(by: >)
    }

    private var taxablePortfolios: [Portfolio] {
        portfolios.filter { !TaxReport.isTaxExemptAccount($0) }
    }

    var body: some View {
        Form {
            Section {
                Text(L10n.t("tax.hint"))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section {
                Picker(L10n.t("tax.year"), selection: $year) {
                    ForEach(years, id: \.self) { y in
                        Text(String(y)).tag(y)
                    }
                }
                Picker(L10n.t("tax.scope"), selection: $scopeFilter) {
                    Text(L10n.t("tax.scope.taxable")).tag(TaxScopeFilter.allTaxable)
                    if !taxablePortfolios.isEmpty {
                        Divider()
                        ForEach(taxablePortfolios) { p in
                            Text(p.name).tag(TaxScopeFilter.portfolio(p.id))
                        }
                    }
                }
                Toggle(L10n.t("tax.includeIKE"), isOn: $includeIKE)
            } header: {
                Text(L10n.t("tax.filters"))
            } footer: {
                if let s = report?.summary, s.excludedTaxExemptCount > 0, !includeIKE {
                    Text(L10n.t("tax.ikeExcluded", ["count": "\(s.excludedTaxExemptCount)"]))
                }
            }

            if isLoading {
                Section {
                    ProgressView(L10n.t("tax.loading"))
                }
            }

            if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                }
            }

            if let summary = report?.summary {
                Section {
                    LabeledContent(L10n.t("tax.proceeds"), value: LWFormatting.money(summary.capitalProceeds, currency: summary.currency))
                    LabeledContent(L10n.t("tax.costs"), value: LWFormatting.money(summary.capitalCosts, currency: summary.currency))
                    LabeledContent(L10n.t("tax.pit38.income")) {
                        Text(LWFormatting.money(summary.pit38CapitalIncome, currency: summary.currency))
                            .fontWeight(.semibold)
                            .foregroundStyle(summary.pit38CapitalIncome >= 0 ? Color.green : Color.red)
                    }
                    LabeledContent(L10n.t("tax.belka")) {
                        Text(LWFormatting.money(summary.estimatedBelkaTax, currency: summary.currency))
                            .fontWeight(.semibold)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text(L10n.t("tax.pit38"))
                } footer: {
                    Text(L10n.t("tax.pit38.hint"))
                }

                Section {
                    LabeledContent(L10n.t("tax.gains")) {
                        Text(LWFormatting.money(summary.realizedGains, currency: summary.currency))
                            .foregroundStyle(.green)
                    }
                    LabeledContent(L10n.t("tax.losses")) {
                        Text(LWFormatting.money(summary.realizedLosses, currency: summary.currency))
                            .foregroundStyle(summary.realizedLosses < 0 ? Color.red : Color.primary)
                    }
                    LabeledContent(L10n.t("tax.net")) {
                        Text(LWFormatting.money(summary.netCapital, currency: summary.currency))
                            .fontWeight(.semibold)
                            .foregroundStyle(summary.netCapital >= 0 ? Color.primary : Color.red)
                    }
                } header: {
                    Text(L10n.t("tax.capital"))
                }

                Section {
                    LabeledContent(L10n.t("tax.dividends"), value: LWFormatting.money(summary.dividends, currency: summary.currency))
                    LabeledContent(L10n.t("tax.interest"), value: LWFormatting.money(summary.interest, currency: summary.currency))
                    LabeledContent(L10n.t("tax.fees"), value: LWFormatting.money(summary.fees, currency: summary.currency))
                } header: {
                    Text(L10n.t("tax.income"))
                }

                if let sells = report?.sells, !sells.isEmpty {
                    Section {
                        ForEach(sells) { row in
                            taxSellRow(row)
                        }
                    } header: {
                        Text(L10n.t("tax.sells"))
                    }
                }

                if let income = report?.incomeLines, !income.isEmpty {
                    Section {
                        ForEach(income) { row in
                            taxIncomeRow(row)
                        }
                    } header: {
                        Text(L10n.t("tax.incomeLines"))
                    }
                }

                Section {
                    Button {
                        if let report {
                            exportDoc = LWCSVDocument(data: TaxReport.csv(report: report))
                            showExport = true
                        }
                    } label: {
                        Label(L10n.t("common.export") + " CSV…", systemImage: "square.and.arrow.up")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(L10n.t("tax.title"))
        .id(appState.localizationEpoch)
        .task(id: reloadToken) {
            await reload()
        }
        .fileExporter(
            isPresented: $showExport,
            document: exportDoc,
            contentType: .commaSeparatedText,
            defaultFilename: "librewallet-tax-\(year).csv"
        ) { _ in }
    }

    @ViewBuilder
    private func taxSellRow(_ row: TaxSellLine) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.symbol).font(.body.weight(.medium))
                Text("\(row.portfolioName) · \(row.date.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("\(LWFormatting.number(row.quantity)) szt.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 2) {
                Text(LWFormatting.money(row.pnl, currency: row.currency))
                    .fontWeight(.semibold)
                    .foregroundStyle(row.pnl >= 0 ? Color.green : Color.red)
                Text("\(L10n.t("tax.proceeds")) \(LWFormatting.money(row.proceeds, currency: row.currency))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("\(L10n.t("tax.costs")) \(LWFormatting.money(row.cost, currency: row.currency))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func taxIncomeRow(_ row: TaxIncomeLine) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(row.kind == "dividend" ? L10n.t("tax.dividends") : L10n.t("tax.interest")) · \(row.symbol)")
                    .font(.body.weight(.medium))
                Text("\(row.portfolioName) · \(row.date.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(LWFormatting.money(row.amount, currency: row.currency))
                .fontWeight(.medium)
        }
        .padding(.vertical, 2)
    }

    private var reloadToken: String {
        "\(year)|\(includeIKE)|\(String(describing: scopeFilter))|\(transactions.count)"
    }

    private func reload() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        let portfolioIds: Set<UUID>? = {
            switch scopeFilter {
            case .allTaxable: return nil
            case .portfolio(let id): return [id]
            }
        }()

        let from = transactions.map(\.date).min() ?? Date()
        let to = transactions.map(\.date).max() ?? Date()
        let currencies = Array(Set(transactions.map { CurrencyCode.normalize($0.currency) }))
        await NBPExchangeRateService.prefetchHistoricalRates(currencies: currencies, from: from, to: to)
        _ = try? await NBPExchangeRateService.ratesToPLN()

        let built = TaxReport.report(
            year: year,
            transactions: Array(transactions),
            portfolios: Array(portfolios),
            reportCurrency: "PLN",
            includeTaxExemptAccounts: includeIKE,
            portfolioIds: portfolioIds,
            rateOnDate: NBPExchangeRateService.rateOnDateProvider()
        )
        report = built
    }
}
