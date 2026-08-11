import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var updateController: UpdateController

    @State private var exportDoc: LWBackupDocument?
    @State private var csvDoc: LWCSVDocument?
    @State private var importing = false
    @State private var showExport = false
    @State private var showCSVExport = false
    @State private var errorMessage: String?
    @State private var confirmClear = false
    @State private var fxCode: String = "USD"
    @State private var fxRate: String = ""
    @State private var mappings: [SymbolMapping] = AppPreferences.symbolMappings
    @State private var mappingSymbol: String = ""
    @State private var mappingSheetSymbol: String?
    @State private var mappingCurrency: String = "PLN"

    @Query(sort: \Transaction.date) private var transactions: [Transaction]

    var body: some View {
        Form {
            Section(L10n.t("settings.about")) {
                LabeledContent(L10n.t("settings.version"), value: AppVersion.shortVersion)
                LabeledContent(L10n.t("settings.build"), value: AppVersion.buildNumber)
                Button {
                    Task { await updateController.checkForUpdates(interactive: true) }
                } label: {
                    if updateController.isChecking {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(L10n.t("settings.checkUpdates"))
                    }
                }
                .disabled(updateController.isChecking)

                Link("Strona pobierania", destination: LibreWalletDistribution.downloadPageURL)
                Link("GitHub Releases", destination: LibreWalletDistribution.releasesPageURL)
            }

            Section(L10n.t("settings.language")) {
                Picker(L10n.t("settings.language"), selection: Binding(
                    get: { appState.language },
                    set: { appState.setLanguage($0) }
                )) {
                    ForEach(AppLanguage.allCases) { lang in
                        Text(lang.displayName).tag(lang)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section(L10n.t("settings.autoRefresh")) {
                Picker(L10n.t("settings.autoRefresh"), selection: $appState.autoRefreshMinutes) {
                    Text(L10n.t("settings.autoRefresh.off")).tag(0)
                    Text(L10n.t("settings.autoRefresh.15")).tag(15)
                    Text(L10n.t("settings.autoRefresh.30")).tag(30)
                    Text(L10n.t("settings.autoRefresh.60")).tag(60)
                }
            }

            Section(L10n.t("settings.fx")) {
                Text(L10n.t("settings.fx.hint"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    TextField("Waluta", text: $fxCode)
                        .frame(width: 80)
                    TextField("Kurs PLN", text: $fxRate)
                    Button(L10n.t("common.save")) {
                        let code = fxCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                        guard let rate = Double(fxRate.replacingOccurrences(of: ",", with: ".")), rate > 0, !code.isEmpty else { return }
                        var map = appState.fxOverrides
                        map[code] = rate
                        appState.fxOverrides = map
                        NBPExchangeRateService.invalidateCache()
                        fxRate = ""
                    }
                }
                ForEach(appState.fxOverrides.sorted(by: { $0.key < $1.key }), id: \.key) { code, rate in
                    HStack {
                        Text("\(code): \(rate)")
                        Spacer()
                        Button(role: .destructive) {
                            var map = appState.fxOverrides
                            map.removeValue(forKey: code)
                            appState.fxOverrides = map
                            NBPExchangeRateService.invalidateCache()
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }

            Section(L10n.t("settings.mappings")) {
                Text(L10n.t("settings.mappings.hint"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(mappings) { m in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(m.id) → \(m.providerSymbol)")
                            if let note = m.note, !note.isEmpty {
                                Text(note).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button {
                            mappingSheetSymbol = m.id
                            mappingCurrency = "PLN"
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)
                        Button(role: .destructive) {
                            AppPreferences.removeSymbolMapping(id: m.id)
                            reloadMappings()
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                }
                HStack {
                    TextField("XTB np. DIA.PL", text: $mappingSymbol)
                    Button(L10n.t("settings.mappings.add")) {
                        let s = mappingSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                        guard !s.isEmpty else { return }
                        mappingSheetSymbol = s
                        mappingCurrency = "PLN"
                        mappingSymbol = ""
                    }
                }
            }

            Section(L10n.t("settings.backup")) {
                Button(L10n.t("settings.exportBackup")) {
                    do {
                        exportDoc = LWBackupDocument(data: try BackupService.export(context: context))
                        showExport = true
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }

                Button(L10n.t("settings.importBackup")) {
                    importing = true
                }

                Button(L10n.t("settings.exportCSV")) {
                    csvDoc = LWCSVDocument(data: CSVExport.exportTransactions(transactions))
                    showCSVExport = true
                }

                Button(L10n.t("settings.clearData"), role: .destructive) {
                    confirmClear = true
                }
            }

            if let errorMessage {
                Section("Błąd") {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .padding()
        .navigationTitle(L10n.t("nav.settings"))
        .id(appState.localizationEpoch)
        .onAppear { reloadMappings() }
        .sheet(item: Binding(
            get: { mappingSheetSymbol.map { MappingSheetItem(id: $0) } },
            set: { mappingSheetSymbol = $0?.id }
        )) { item in
            SymbolMappingSheet(xtbSymbol: item.id, positionCurrency: mappingCurrency)
                .onDisappear { reloadMappings() }
        }
        .confirmationDialog(L10n.t("settings.clearConfirm"), isPresented: $confirmClear, titleVisibility: .visible) {
            Button(L10n.t("common.delete"), role: .destructive) {
                do {
                    try BackupService.wipe(context: context)
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
            Button(L10n.t("common.cancel"), role: .cancel) {}
        }
        .fileExporter(
            isPresented: $showExport,
            document: exportDoc,
            contentType: .json,
            defaultFilename: "librewallet-backup.json"
        ) { result in
            if case .failure(let err) = result {
                errorMessage = err.localizedDescription
            }
        }
        .fileExporter(
            isPresented: $showCSVExport,
            document: csvDoc,
            contentType: .commaSeparatedText,
            defaultFilename: "librewallet-transactions.csv"
        ) { _ in }
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            do {
                guard let url = try result.get().first else { return }
                let data = try Data(contentsOf: url)
                try BackupService.import(data: data, context: context, wipeExisting: true)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func reloadMappings() {
        mappings = AppPreferences.symbolMappings
    }
}

private struct MappingSheetItem: Identifiable {
    let id: String
}
