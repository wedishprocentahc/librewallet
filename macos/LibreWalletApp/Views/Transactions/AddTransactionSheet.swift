import SwiftUI
import SwiftData

struct AddTransactionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context

    let portfolios: [Portfolio]

    @State private var portfolioId: UUID?
    @State private var date = Date()
    @State private var type: TransactionType = .buy
    @State private var symbol = ""
    @State private var name = ""
    @State private var quantity = ""
    @State private var price = ""
    @State private var gross = ""
    @State private var fee = ""
    @State private var currency = "PLN"
    @State private var notes = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Picker("Portfel", selection: $portfolioId) {
                    ForEach(portfolios) { p in
                        Text(p.name).tag(Optional.some(p.id))
                    }
                }
                DatePicker("Data", selection: $date, displayedComponents: [.date])
                Picker("Typ", selection: $type) {
                    ForEach(TransactionType.allCases, id: \.self) { t in
                        Text(label(for: t)).tag(t)
                    }
                }
                TextField("Symbol", text: $symbol)
                TextField("Nazwa", text: $name)
                TextField("Ilość", text: $quantity)
                TextField("Cena", text: $price)
                TextField("Wartość brutto", text: $gross)
                TextField("Prowizja", text: $fee)
                TextField("Waluta", text: $currency)
                TextField("Notatki", text: $notes)
            }

            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }
                Button("Zapisz") { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(portfolioId == nil)
            }
            .padding()
        }
        .frame(minWidth: 520, minHeight: 520)
        .onAppear {
            portfolioId = portfolios.first?.id
        }
    }

    private func save() {
        guard let pid = portfolioId, let portfolio = portfolios.first(where: { $0.id == pid }) else { return }
        let tx = Transaction(
            date: date,
            type: type,
            symbol: symbol.trimmedOrNilUppercased,
            name: name.trimmedOrNil,
            quantity: Double(quantity.replacingOccurrences(of: ",", with: ".")),
            price: Double(price.replacingOccurrences(of: ",", with: ".")),
            gross: Double(gross.replacingOccurrences(of: ",", with: ".")) ?? 0,
            fee: Double(fee.replacingOccurrences(of: ",", with: ".")) ?? 0,
            currency: currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
            notes: notes.trimmedOrNil,
            portfolio: portfolio
        )
        context.insert(tx)
        try? context.save()
        dismiss()
    }

    private func label(for type: TransactionType) -> String {
        switch type {
        case .buy: "Kupno"
        case .sell: "Sprzedaż"
        case .deposit: "Wpłata"
        case .withdrawal: "Wypłata"
        case .transfer: "Transfer"
        case .fee: "Prowizja"
        case .tax: "Podatek"
        case .dividend: "Dywidenda"
        case .interest: "Odsetki"
        case .other: "Inne"
        }
    }
}

private extension String {
    var trimmedOrNil: String? {
        let s = trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : s
    }

    var trimmedOrNilUppercased: String? {
        guard let s = trimmedOrNil else { return nil }
        return s.uppercased()
    }
}

