import SwiftUI
import SwiftData

struct SymbolMappingSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context

    let xtbSymbol: String
    let positionCurrency: String

    @State private var providerSymbol: String = ""
    @State private var note: String = ""
    @State private var status: String?
    @State private var isTesting = false
    @State private var testPrice: String?

    private var resolvedHint: String {
        switch SymbolResolver.resolve(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency) {
        case .success(let r):
            return "\(r.providerSymbol) · \(r.expectedCurrency)" + (r.fromOverride ? " (override)" : "")
        case .failure(.ignored):
            return L10n.t("mapping.ignored")
        case .failure(.unresolved):
            return L10n.t("mapping.unresolved")
        case .failure(.emptySymbol):
            return "—"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(L10n.t("mapping.xtb")) {
                    LabeledContent(L10n.t("mapping.symbol"), value: xtbSymbol.uppercased())
                    LabeledContent(L10n.t("mapping.currency"), value: CurrencyCode.normalize(positionCurrency))
                    LabeledContent(L10n.t("mapping.auto"), value: resolvedHint)
                    if let meta = AppPreferences.quoteResolutionMeta[xtbSymbol.uppercased()] {
                        Text("\(L10n.t("mapping.last")): \(meta.providerSymbol) · \(meta.currency) · \(meta.asOf.formatted())")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section(L10n.t("mapping.override")) {
                    TextField(L10n.t("mapping.yahoo"), text: $providerSymbol)
                    TextField(L10n.t("mapping.note"), text: $note)
                    if let testPrice {
                        Text(testPrice).foregroundStyle(.secondary)
                    }
                    if let status {
                        Text(status).foregroundStyle(.orange)
                    }
                    Button(L10n.t("mapping.test")) {
                        Task { await testFetch() }
                    }
                    .disabled(providerSymbol.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isTesting)

                    Button(L10n.t("mapping.save")) {
                        saveOverride()
                    }
                    .disabled(providerSymbol.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    if AppPreferences.symbolMappings.contains(where: { $0.id == xtbSymbol.uppercased() }) {
                        Button(L10n.t("mapping.clear"), role: .destructive) {
                            AppPreferences.removeSymbolMapping(id: xtbSymbol)
                            status = L10n.t("mapping.cleared")
                        }
                    }
                }
            }
            .navigationTitle(L10n.t("mapping.title"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("common.cancel")) { dismiss() }
                }
            }
            .onAppear {
                if let existing = AppPreferences.symbolMappings.first(where: { $0.id == xtbSymbol.uppercased() }) {
                    providerSymbol = existing.providerSymbol
                    note = existing.note ?? ""
                } else if case .success(let r) = SymbolResolver.resolve(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency) {
                    providerSymbol = r.providerSymbol
                }
            }
        }
        .frame(minWidth: 420, minHeight: 360)
    }

    private func saveOverride() {
        let yahoo = providerSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !yahoo.isEmpty else { return }
        AppPreferences.upsertSymbolMapping(SymbolMapping(
            id: xtbSymbol,
            providerSymbol: yahoo,
            provider: .yahoo,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        ))
        Task {
            do {
                try await PricingService.refreshQuote(
                    xtbSymbol: xtbSymbol,
                    positionCurrency: positionCurrency,
                    context: context
                )
                status = L10n.t("mapping.saved")
            } catch {
                status = error.localizedDescription
            }
        }
    }

    private func testFetch() async {
        isTesting = true
        defer { isTesting = false }
        testPrice = nil
        status = nil
        let yahoo = providerSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        // Temporarily apply override for test resolve path.
        let previous = AppPreferences.symbolMappings
        AppPreferences.upsertSymbolMapping(SymbolMapping(id: xtbSymbol, providerSymbol: yahoo))
        defer { AppPreferences.symbolMappings = previous }
        do {
            let q = try await PricingService.fetchQuote(xtbSymbol: xtbSymbol, positionCurrency: positionCurrency)
            testPrice = "\(LWFormatting.number(q.price)) \(q.currency) ← \(q.resolved.providerSymbol)"
        } catch {
            status = error.localizedDescription
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
