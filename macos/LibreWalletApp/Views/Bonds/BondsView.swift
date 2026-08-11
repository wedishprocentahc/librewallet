import SwiftUI
import SwiftData

struct BondsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \Transaction.date) private var transactions: [Transaction]

    @State private var selectedPortfolioId: UUID?
    @State private var presetId: String = BondPresets.all.first?.id ?? "OTS"
    @State private var nominalCount: String = "1"
    @State private var purchaseDate: Date = .now
    @State private var showSavedAlert = false
    @State private var savedSummary = ""
    @State private var errorMessage: String?

    // Overrides
    @State private var overrideSymbol: String = ""
    @State private var overrideRate: String = ""
    @State private var overrideMargin: String = ""
    @State private var overrideTermMonths: String = ""
    @State private var overrideMaturity: Date?
    @State private var useCustomMaturity = false

    // Redemption
    @State private var redeemKey: String = ""
    @State private var redeemQty: String = ""
    @State private var redeemPrice: String = ""
    @State private var redeemFee: String = "0"
    @State private var redeemDate: Date = .now

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Form {
                    Section(L10n.t("bonds.add")) {
                        Picker("Preset", selection: $presetId) {
                            ForEach(BondPresets.all) { preset in
                                Text(preset.code).tag(preset.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: presetId) { _, _ in
                            applyPresetDefaults()
                        }

                        Text(preset?.name ?? "")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        DatePicker("Data zakupu", selection: $purchaseDate, displayedComponents: [.date])
                        TextField("Ile nominałów (100 PLN)", text: $nominalCount)
                        if let estimate = estimatedValueText {
                            Text(estimate)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section(L10n.t("bonds.overrides")) {
                        TextField(L10n.t("bonds.series"), text: $overrideSymbol)
                        TextField(L10n.t("bonds.rate"), text: $overrideRate)
                        TextField(L10n.t("bonds.margin"), text: $overrideMargin)
                        TextField(L10n.t("bonds.term"), text: $overrideTermMonths)
                        Toggle(L10n.t("bonds.maturity"), isOn: $useCustomMaturity)
                        if useCustomMaturity {
                            DatePicker(L10n.t("bonds.maturity"), selection: Binding(
                                get: { overrideMaturity ?? defaultMaturity },
                                set: { overrideMaturity = $0 }
                            ), displayedComponents: [.date])
                        }
                    }

                    if let errorMessage {
                        Section {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }

                    Section {
                        Button(action: addBondTransaction) {
                            Label(L10n.t("common.add"), systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(targetPortfolioId == nil || Int(nominalCount) == nil || (Int(nominalCount) ?? 0) <= 0)
                    }

                    Divider()
                        .padding(.vertical, 12)

                    Section {
                        Picker("Seria", selection: $redeemKey) {
                            Text("—").tag("")
                            ForEach(heldBondKeys, id: \.self) { key in
                                if let entry = heldBonds.first(where: { $0.id == key }) {
                                    Text("\(entry.symbol) · \(LWFormatting.number(entry.quantity)) szt. · \(entry.portfolioName)")
                                        .tag(key)
                                }
                            }
                        }
                        TextField("Ilość", text: $redeemQty)
                        TextField("Cena / szt.", text: $redeemPrice)
                        TextField("Opłata", text: $redeemFee)
                        DatePicker("Data", selection: $redeemDate, displayedComponents: [.date])
                        Button("Wykup") { redeemBond() }
                            .disabled(redeemKey.isEmpty)
                    } header: {
                        Text(L10n.t("bonds.redeem"))
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.primary)
                            .textCase(nil)
                    }
                }

                maturityCalendar
            }
            .padding()
        }
        .navigationTitle(L10n.t("bonds.title"))
        .id(appState.localizationEpoch)
        .onAppear {
            syncPortfolioSelection()
            applyPresetDefaults()
        }
        .onChange(of: appState.selectedPortfolioId) { _, _ in
            syncPortfolioSelection()
        }
        .onChange(of: portfolios.count) { _, _ in
            syncPortfolioSelection()
        }
        .alert("Dodano obligacje", isPresented: $showSavedAlert) {
            Button("OK", role: .cancel) {}
            Button("Pokaż operacje") {
                appState.navigationSelection = .transactions
            }
        } message: {
            Text(savedSummary)
        }
    }

    private var maturityCalendar: some View {
        let entries = BondMaturity.openLots(transactions: transactions, portfolios: portfolios)
        let overdue = entries.filter(\.isPast)
        let groups = BondMaturity.groupedByYear(entries)

        return VStack(alignment: .leading, spacing: 12) {
            Text(L10n.t("bonds.calendar"))
                .font(.title2.weight(.semibold))

            if entries.isEmpty {
                Text(L10n.t("dashboard.noData"))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
            } else {
                HStack(spacing: 16) {
                    metric("Serie", "\(entries.count)")
                    metric("Szt.", LWFormatting.number(entries.reduce(0) { $0 + $1.quantity }))
                    metric("Wartość dziś", LWFormatting.money(entries.reduce(0) { $0 + $1.totalValue }, currency: "PLN"))
                }

                if !overdue.isEmpty {
                    Text("Po terminie: \(overdue.count)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                }

                maturityColumnHeader

                ForEach(groups, id: \.year) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: String(group.year))
                            .font(.headline)
                        ForEach(group.items) { entry in
                            maturityRow(entry)
                        }
                    }
                }
            }

            Text("Wycena: nominal + narosłe odsetki (dla CPI/NBP przybliżenie stawką 1. roku — jak w wersji web).")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }

    private var maturityColumnHeader: some View {
        HStack(spacing: 8) {
            Text("Data wykupu")
                .frame(width: 100, alignment: .leading)
            Text("Seria")
                .frame(width: 56, alignment: .leading)
            Text("Ilość")
                .frame(width: 72, alignment: .trailing)
            Spacer(minLength: 8)
            Text("Wartość dziś")
                .frame(minWidth: 110, alignment: .trailing)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.top, 4)
    }

    private func maturityRow(_ entry: BondMaturityEntry) -> some View {
        HStack(spacing: 8) {
            Text(shortDate(entry.maturityDate))
                .frame(width: 100, alignment: .leading)
            Text(entry.symbol)
                .fontWeight(.semibold)
                .frame(width: 56, alignment: .leading)
            Text(LWFormatting.number(entry.quantity) + " szt.")
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .trailing)
            Spacer(minLength: 8)
            Text(LWFormatting.money(entry.totalValue, currency: entry.currency))
                .frame(minWidth: 110, alignment: .trailing)
        }
        .font(.callout)
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold))
        }
    }

    private var targetPortfolioId: UUID? {
        selectedPortfolioId ?? appState.selectedPortfolioId ?? portfolios.first?.id
    }

    private func syncPortfolioSelection() {
        selectedPortfolioId = appState.selectedPortfolioId ?? portfolios.first?.id
    }

    private var preset: BondPreset? {
        BondPresets.all.first(where: { $0.id == presetId })
    }

    private var effectiveTerms: BondTerms? {
        guard let preset else { return nil }
        var terms = BondPricing.terms(from: preset)
        let rate = Double(overrideRate.replacingOccurrences(of: ",", with: ".")) ?? terms.firstYearRate
        let margin = Double(overrideMargin.replacingOccurrences(of: ",", with: ".")) ?? terms.margin
        let term = Int(overrideTermMonths) ?? terms.termMonths
        let code = overrideSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        terms = BondTerms(
            code: code.isEmpty ? terms.code : code,
            termMonths: term,
            firstYearRate: rate,
            margin: margin,
            indexation: terms.indexation,
            capitalization: terms.capitalization,
            earlyRedemptionFee: terms.earlyRedemptionFee
        )
        return terms
    }

    private var defaultMaturity: Date {
        guard let terms = effectiveTerms else { return purchaseDate }
        return terms.maturityDateFromPurchase(purchaseDate)
    }

    private var estimatedValueText: String? {
        guard let terms = effectiveTerms, let count = Int(nominalCount), count > 0 else { return nil }
        let unit = BondPricing.currentPrice(terms: terms, purchaseDate: purchaseDate)
        let value = unit * Double(count)
        let profit = value - Double(count) * BondPricing.nominal
        let indexHint: String = {
            switch terms.indexation {
            case "cpi": return "przybliżenie stawką 1. roku (CPI)"
            case "nbp": return "przybliżenie stawką 1. roku (NBP)"
            default: return "oprocentowanie stałe"
            }
        }()
        return "Szacowana wartość dziś: \(LWFormatting.money(value, currency: "PLN")) (zysk \(LWFormatting.money(profit, currency: "PLN")) — \(indexHint))"
    }

    private var heldBonds: [BondMaturityEntry] {
        BondMaturity.openLots(transactions: transactions, portfolios: portfolios)
    }

    private var heldBondKeys: [String] {
        heldBonds.map(\.id)
    }

    private func applyPresetDefaults() {
        guard let preset else { return }
        overrideSymbol = preset.code
        overrideRate = String(preset.firstYearRate)
        overrideMargin = String(preset.margin)
        overrideTermMonths = String(preset.termMonths)
        overrideMaturity = BondPricing.terms(from: preset).maturityDateFromPurchase(purchaseDate)
    }

    private func addBondTransaction() {
        errorMessage = nil
        guard let pid = targetPortfolioId,
              let portfolio = portfolios.first(where: { $0.id == pid }),
              let terms = effectiveTerms,
              let count = Int(nominalCount),
              count > 0 else {
            errorMessage = "Wybierz portfel w pasku bocznym i podaj poprawną liczbę nominałów."
            return
        }

        let gross = Double(count) * BondPricing.nominal
        var notes = "Bond \(terms.code) term=\(terms.termMonths)m rate=\(terms.firstYearRate)% margin=\(terms.margin) index=\(terms.indexation) cap=\(terms.capitalization) fee=\(terms.earlyRedemptionFee)"
        if useCustomMaturity, let m = overrideMaturity {
            let df = DateFormatter()
            df.locale = Locale(identifier: "en_US_POSIX")
            df.dateFormat = "yyyy-MM-dd"
            notes += " maturity=\(df.string(from: m))"
        }

        let tx = Transaction(
            date: purchaseDate,
            type: .buy,
            symbol: terms.code,
            name: preset?.name ?? terms.code,
            quantity: Double(count),
            price: BondPricing.nominal,
            gross: gross,
            fee: 0,
            currency: portfolio.baseCurrency,
            cashDelta: nil,
            externalId: nil,
            notes: notes,
            source: "Bond preset",
            assetType: "bond",
            portfolio: portfolio
        )
        context.insert(tx)
        do {
            try context.save()
        } catch {
            errorMessage = "Nie udało się zapisać: \(error.localizedDescription)"
            return
        }

        let unit = BondPricing.currentPrice(terms: terms, purchaseDate: purchaseDate)
        let value = unit * Double(count)
        let profit = value - gross
        savedSummary = "\(terms.code): \(count) szt. za \(LWFormatting.money(gross, currency: portfolio.baseCurrency)). Szac. dziś: \(LWFormatting.money(value, currency: portfolio.baseCurrency)) (zysk \(LWFormatting.money(profit, currency: portfolio.baseCurrency)))."
        showSavedAlert = true
    }

    private func redeemBond() {
        errorMessage = nil
        guard let entry = heldBonds.first(where: { $0.id == redeemKey }) else {
            errorMessage = "Wybierz serię do wykupu."
            return
        }
        guard let qty = Double(redeemQty.replacingOccurrences(of: ",", with: ".")), qty > 0 else {
            errorMessage = "Podaj ilość."
            return
        }
        if qty > entry.quantity + 0.0000001 {
            errorMessage = "Niewystarczająca ilość (max \(LWFormatting.number(entry.quantity)))."
            return
        }
        let price = Double(redeemPrice.replacingOccurrences(of: ",", with: "."))
            ?? BondPricing.currentPrice(terms: entry.terms, purchaseDate: entry.purchaseDate, asOf: redeemDate)
        let fee = abs(Double(redeemFee.replacingOccurrences(of: ",", with: ".")) ?? 0)
        guard let portfolio = portfolios.first(where: { $0.id == entry.portfolioId }) else { return }

        let tx = Transaction(
            date: redeemDate,
            type: .sell,
            symbol: entry.symbol,
            name: entry.name,
            quantity: qty,
            price: price,
            gross: qty * price,
            fee: fee,
            currency: entry.currency,
            notes: "Przedterminowy wykup",
            source: "bond-redemption",
            assetType: "bond",
            portfolio: portfolio
        )
        context.insert(tx)
        try? context.save()
        redeemQty = ""
        redeemPrice = ""
        redeemKey = ""
    }

    private func shortDate(_ date: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        return df.string(from: date)
    }
}
