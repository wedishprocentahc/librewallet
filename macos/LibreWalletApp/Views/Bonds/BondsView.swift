import SwiftUI
import SwiftData

struct BondsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @State private var selectedPortfolioId: UUID?

    @State private var presetId: String = BondPresets.all.first?.id ?? "OTS"
    @State private var nominalCount: String = "1"
    @State private var purchaseDate: Date = .now
    @State private var showSavedAlert = false
    @State private var savedSummary = ""
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Portfel") {
                Picker("Docelowy", selection: $selectedPortfolioId) {
                    ForEach(portfolios) { p in
                        Text(p.name).tag(Optional.some(p.id))
                    }
                }
            }

            Section("Dodaj obligacje (jako transakcję)") {
                Picker("Preset", selection: $presetId) {
                    ForEach(BondPresets.all) { preset in
                        Text(preset.code).tag(preset.id)
                    }
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

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    addBondTransaction()
                } label: {
                    Label("Dodaj", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(selectedPortfolioId == nil || Int(nominalCount) == nil || (Int(nominalCount) ?? 0) <= 0)
            }
        }
        .navigationTitle("Obligacje")
        .padding()
        .onAppear {
            selectedPortfolioId = appState.selectedPortfolioId ?? portfolios.first?.id
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

    private var preset: BondPreset? {
        BondPresets.all.first(where: { $0.id == presetId })
    }

    private var estimatedValueText: String? {
        guard let preset, let count = Int(nominalCount), count > 0 else { return nil }
        let terms = BondPricing.terms(from: preset)
        let unit = BondPricing.currentPrice(terms: terms, purchaseDate: purchaseDate)
        let value = unit * Double(count)
        let profit = value - Double(count) * BondPricing.nominal
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        let valueText = formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
        let profitText = formatter.string(from: NSNumber(value: profit)) ?? String(format: "%.2f", profit)
        return "Szacowana wartość dziś: \(valueText) PLN (zysk \(profitText) PLN — narosłe odsetki)"
    }

    private func addBondTransaction() {
        errorMessage = nil
        guard let pid = selectedPortfolioId,
              let portfolio = portfolios.first(where: { $0.id == pid }),
              let preset,
              let count = Int(nominalCount),
              count > 0 else {
            errorMessage = "Wybierz portfel i podaj poprawną liczbę nominałów."
            return
        }

        let gross = Double(count) * BondPricing.nominal
        let notes = "Bond \(preset.code) term=\(preset.termMonths)m rate=\(preset.firstYearRate)% margin=\(preset.margin) index=\(preset.indexation) cap=\(preset.capitalization) fee=\(preset.earlyRedemptionFee)"

        let tx = Transaction(
            date: purchaseDate,
            type: .buy,
            symbol: preset.code,
            name: preset.name,
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

        let terms = BondPricing.terms(from: preset)
        let unit = BondPricing.currentPrice(terms: terms, purchaseDate: purchaseDate)
        let value = unit * Double(count)
        let profit = value - gross
        let money = { (amount: Double) -> String in
            LWFormatting.money(amount, currency: portfolio.baseCurrency)
        }
        savedSummary = "\(preset.code): \(count) szt. za \(money(gross)) w portfelu „\(portfolio.name)”. Szacowana wartość dziś: \(money(value)) (zysk \(money(profit)))."
        showSavedAlert = true
    }
}
