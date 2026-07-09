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
            }

            Section {
                Button {
                    addBondTransaction()
                } label: {
                    Label("Dodaj", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(selectedPortfolioId == nil || Int(nominalCount) == nil)
            }
        }
        .navigationTitle("Obligacje")
        .padding()
        .onAppear {
            selectedPortfolioId = appState.selectedPortfolioId ?? portfolios.first?.id
        }
    }

    private var preset: BondPreset? {
        BondPresets.all.first(where: { $0.id == presetId })
    }

    private func addBondTransaction() {
        guard let pid = selectedPortfolioId,
              let portfolio = portfolios.first(where: { $0.id == pid }),
              let preset,
              let count = Int(nominalCount) else { return }

        let gross = Double(count) * 100.0
        let notes = "Bond \(preset.code) term=\(preset.termMonths)m rate=\(preset.firstYearRate)% margin=\(preset.margin) index=\(preset.indexation) cap=\(preset.capitalization) fee=\(preset.earlyRedemptionFee)"

        let tx = Transaction(
            date: purchaseDate,
            type: .buy,
            symbol: preset.code,
            name: preset.name,
            quantity: Double(count),
            price: 100,
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
        try? context.save()
    }
}

