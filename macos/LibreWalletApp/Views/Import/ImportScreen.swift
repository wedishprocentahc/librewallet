import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import AppKit

struct ImportScreen: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \Portfolio.createdAt) private var portfolios: [Portfolio]
    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]

    @State private var preview: [ImportedTransaction] = []
    @State private var previewSource: String?
    @State private var selectedPortfolioId: UUID?
    @State private var errorMessage: String?
    @State private var isDropTargeted = false

    private var autoCreatesPortfolios: Bool {
        if previewSource?.localizedCaseInsensitiveContains("XTB") == true { return true }
        if preview.contains(where: { ($0.source ?? "").localizedCaseInsensitiveContains("XTB") }) { return true }
        return preview.contains { !($0.account ?? "").isEmpty }
    }

    private var canCommit: Bool {
        !preview.isEmpty && (autoCreatesPortfolios || selectedPortfolioId != nil)
    }

    private var commitTitle: String { "Zapisz (\(preview.count))" }
    private var previewTitle: String { previewSource ?? "Import" }
    private var xtbAccountsSummary: String? {
        let accounts = Set(preview.compactMap(\.account)).sorted()
        guard !accounts.isEmpty else { return nil }
        return accounts.count == 1 ? "Konto: \(accounts[0])" : "Konta: \(accounts.joined(separator: ", "))"
    }
    private var currenciesSummary: String? {
        let ccys = Set(preview.map(\.currency)).sorted()
        guard ccys.count > 1 else { return nil }
        return "Waluty: \(ccys.joined(separator: ", "))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            toolbar
            errorBanner
            previewBox
            Spacer()
        }
        .padding()
        .navigationTitle(L10n.t("nav.import"))
        .id(appState.localizationEpoch)
        .onAppear(perform: onAppear)
    }

    private var errorBanner: some View {
        Group {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
    }

    private var previewBox: some View {
        GroupBox("Podgląd importu") {
            if preview.isEmpty {
                ContentUnavailableView("Brak podglądu", systemImage: "eye", description: Text("Załaduj plik importu, żeby zobaczyć podgląd."))
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(previewTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let xtbAccountsSummary {
                        Text(xtbAccountsSummary).font(.caption).foregroundStyle(.secondary)
                    }
                    if let currenciesSummary {
                        Text(currenciesSummary).font(.caption).foregroundStyle(.secondary)
                    }

                    List(preview.prefix(200)) { row in
                        ImportRow(row: row)
                    }
                    .frame(minHeight: 340)

                    HStack {
                        Spacer()
                        Button("Wyczyść", action: clearPreview)
                        Button(commitTitle, action: commitPreview)
                            .buttonStyle(.borderedProminent)
                            .disabled(!canCommit)
                    }
                }
                .padding(.top, 6)
            }
        }
        .overlay(dropOverlay)
        .dropDestination(for: URL.self, action: handleDrop(_:_:), isTargeted: { isDropTargeted = $0 })
    }

    private var dropOverlay: some View {
        Group {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6]))
                    .padding(4)
            }
        }
    }

    private var toolbar: some View {
        HStack {
            if autoCreatesPortfolios {
                Label("Portfele utworzą się automatycznie z importu", systemImage: "briefcase.fill")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            } else {
                Picker("Portfel docelowy", selection: $selectedPortfolioId) {
                    ForEach(portfolios) { p in
                        Text(p.name).tag(Optional.some(p.id))
                    }
                }
                .frame(maxWidth: 320)
            }

            Spacer()

            Button {
                openZipPanel()
            } label: {
                Label("Import XTB ZIP", systemImage: "archivebox")
            }

            Button {
                openIBKRPanel()
            } label: {
                Label("Import IBKR CSV", systemImage: "building.columns")
            }

            Button {
                openUniversalPanel()
            } label: {
                Label("Import CSV/XLSX", systemImage: "doc")
            }

            Button {
                exportTemplate()
            } label: {
                Label(L10n.t("import.template"), systemImage: "arrow.down.doc")
            }
        }
    }

    private func exportTemplate() {
        let data = CSVExport.templateCSV()
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.allowedContentTypes = [.commaSeparatedText]
        panel.nameFieldStringValue = "librewallet-import-template.csv"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url, options: .atomic)
                Task { @MainActor in
                    appState.notifySuccess(L10n.t("feedback.exportTemplate"))
                }
            } catch {
                Task { @MainActor in
                    errorMessage = error.localizedDescription
                    appState.notifyError(error.localizedDescription)
                }
            }
        }
    }

    private func openIBKRPanel() {
        errorMessage = nil
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedFileTypes = ["csv"]
        panel.title = "Wybierz eksport IBKR (CSV)"
        panel.prompt = "Wybierz"
        if panel.runModal() == .OK, let url = panel.url {
            do {
                preview = try IBKRImporter.importPreview(from: url)
                previewSource = "IBKR CSV: \(url.lastPathComponent)"
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func onAppear() {
        selectedPortfolioId = appState.selectedPortfolioId ?? portfolios.first?.id
    }

    private func clearPreview() {
        preview = []
        previewSource = nil
        errorMessage = nil
    }

    private func handleDrop(_ items: [URL], _: CGPoint) -> Bool {
        guard let url = items.first else { return false }
        loadByExtension(url)
        return true
    }

    private func openZipPanel() {
        errorMessage = nil
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedFileTypes = ["zip"]
        panel.title = "Wybierz plik ZIP z eksportu XTB"
        panel.prompt = "Wybierz"
        if panel.runModal() == .OK, let url = panel.url {
            loadZip(.success([url]))
        }
    }

    private func openUniversalPanel() {
        errorMessage = nil
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedFileTypes = ["csv", "xlsx", "xls"]
        panel.title = "Wybierz plik importu (CSV/XLSX/XLS)"
        panel.prompt = "Wybierz"
        if panel.runModal() == .OK, let url = panel.url {
            loadUniversal(.success([url]))
        }
    }

    private func loadZip(_ result: Result<[URL], Error>) {
        errorMessage = nil
        do {
            guard let url = try result.get().first else { return }
            preview = try XTBZipImporter.importPreview(from: url)
            previewSource = "XTB ZIP: \(url.lastPathComponent)"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadUniversal(_ result: Result<[URL], Error>) {
        errorMessage = nil
        do {
            guard let url = try result.get().first else { return }
            preview = try UniversalImporter.importPreview(from: url)
            previewSource = "Plik: \(url.lastPathComponent)"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadByExtension(_ url: URL) {
        let ext = url.pathExtension.lowercased()
        if ext == "zip" {
            loadZip(.success([url]))
            return
        }
        loadUniversal(.success([url]))
    }

    private func commitPreview() {
        errorMessage = nil

        if autoCreatesPortfolios {
            commitXTBGrouped()
            return
        }

        guard let pid = selectedPortfolioId,
              let portfolio = portfolios.first(where: { $0.id == pid }) else {
            errorMessage = "Wybierz portfel docelowy."
            return
        }

        let count = preview.count
        for item in preview {
            insert(item, into: portfolio)
        }
        try? context.save()
        clearPreview()
        appState.notifySuccess(L10n.t("feedback.importSaved", ["count": "\(count)"]))
        appState.navigationSelection = .transactions
    }

    private func commitXTBGrouped() {
        // Group by (account, currency) and create/find portfolios automatically.
        struct XTBKey: Hashable {
            let account: String
            let currency: String
        }
        let grouped = Dictionary(grouping: preview) { item in
            XTBKey(account: item.account ?? "XTB", currency: item.currency)
        }

        let group = ensureXTBGroup()
        var portfolioCache: [String: Portfolio] = [:]
        var lastPortfolio: Portfolio?
        var savedCount = 0

        for (key, items) in grouped {
            let portfolio = ensureXTBPortfolio(
                group: group,
                account: key.account,
                currency: key.currency,
                cache: &portfolioCache
            )
            lastPortfolio = portfolio
            for item in items {
                insert(item, into: portfolio)
            }
            savedCount += items.count
        }

        try? context.save()
        if let lastPortfolio {
            appState.selectPortfolio(lastPortfolio)
        }
        clearPreview()
        appState.notifySuccess(L10n.t("feedback.importSaved", ["count": "\(savedCount)"]))
        appState.navigationSelection = .transactions
    }

    private func ensureXTBGroup() -> PortfolioGroup {
        if let existing = groups.first(where: { $0.name.lowercased() == "xtb" }) {
            return existing
        }
        let g = PortfolioGroup(name: "XTB", createdAt: .now)
        context.insert(g)
        return g
    }

    private func ensureXTBPortfolio(
        group: PortfolioGroup,
        account: String,
        currency: String,
        cache: inout [String: Portfolio]
    ) -> Portfolio {
        let label = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let baseCurrency = CurrencyCode.normalize(label)
        // Keep IKE/IKZE in the display name; settle currency is always PLN.
        let nameToken = CurrencyCode.isAccountProductLabel(label) ? label : baseCurrency
        let name = "XTB \(nameToken) (\(account))"
        let cacheKey = "\(group.id.uuidString)|\(name)"
        if let cached = cache[cacheKey] {
            if cached.baseCurrency != baseCurrency {
                cached.baseCurrency = baseCurrency
            }
            return cached
        }
        if let existing = portfolios.first(where: { $0.group?.id == group.id && $0.name == name }) {
            if existing.baseCurrency != baseCurrency {
                existing.baseCurrency = baseCurrency
            }
            cache[cacheKey] = existing
            return existing
        }
        let p = Portfolio(
            name: name,
            baseCurrency: baseCurrency,
            colorHex: "#176b4d",
            kind: .account,
            createdAt: .now,
            group: group
        )
        context.insert(p)
        cache[cacheKey] = p
        return p
    }

    private func insert(_ item: ImportedTransaction, into portfolio: Portfolio) {
        let tx = Transaction(
            date: item.date,
            type: item.type,
            symbol: item.symbol,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            gross: item.gross,
            fee: item.fee,
            currency: CurrencyCode.normalize(item.currency),
            cashDelta: item.cashDelta,
            externalId: item.externalId,
            notes: item.notes,
            source: item.source,
            assetType: item.assetType,
            portfolio: portfolio
        )
        context.insert(tx)
    }
}

private struct ImportRow: View {
    let row: ImportedTransaction

    var body: some View {
        HStack(spacing: 12) {
            Text(row.dateText)
                .frame(width: 90, alignment: .leading)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(row.type.rawValue)
                .frame(width: 90, alignment: .leading)
            Text(row.symbol ?? row.name ?? "—")
                .lineLimit(1)
            Spacer()
            Text(LWFormatting.money(row.gross, currency: row.currency))
                .frame(width: 140, alignment: .trailing)
        }
    }
}

