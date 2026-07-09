import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var appState: AppState

    @Query(sort: \PortfolioGroup.createdAt) private var groups: [PortfolioGroup]
    @State private var renamingPortfolio: Portfolio?
    @State private var renameText: String = ""
    @State private var editColor: Color = .green
    @State private var confirmDeletePortfolio: Portfolio?
    @State private var renamingGroup: PortfolioGroup?
    @State private var confirmDeleteGroup: PortfolioGroup?

    @State private var showCreateGroupSheet = false
    @State private var createGroupName: String = ""
    @State private var createPortfolios: [DraftPortfolio] = [DraftPortfolio()]

    var body: some View {
        NavigationSplitView {
            List(selection: $appState.navigationSelection) {
                Section("LibreWallet") {
                    NavigationLink(value: NavigationDestination.dashboard) {
                        Label("Dashboard", systemImage: "chart.line.uptrend.xyaxis")
                    }
                    NavigationLink(value: NavigationDestination.positions) {
                        Label("Pozycje", systemImage: "briefcase")
                    }
                    NavigationLink(value: NavigationDestination.transactions) {
                        Label("Operacje", systemImage: "list.bullet.rectangle")
                    }
                }

                Section("Narzędzia") {
                    NavigationLink(value: NavigationDestination.imports) {
                        Label("Import", systemImage: "arrow.down.doc")
                    }
                    NavigationLink(value: NavigationDestination.rebalance) {
                        Label("Rebalancing", systemImage: "arrow.left.arrow.right")
                    }
                    NavigationLink(value: NavigationDestination.bonds) {
                        Label("Obligacje", systemImage: "banknote")
                    }
                }

                Section("System") {
                    NavigationLink(value: NavigationDestination.settings) {
                        Label("Ustawienia", systemImage: "gearshape")
                    }
                }

                Section("Grupy") {
                    ForEach(groups) { group in
                        DisclosureGroup {
                            ForEach(group.portfolios.sorted(by: { $0.createdAt < $1.createdAt })) { portfolio in
                                Button {
                                    appState.selectPortfolio(portfolio)
                                    appState.navigationSelection = .portfolio(portfolio.id)
                                } label: {
                                    Label(portfolio.name, systemImage: "briefcase")
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button("Edytuj…") {
                                        renamingPortfolio = portfolio
                                        renameText = portfolio.name
                                        editColor = Color(hex: portfolio.colorHex) ?? .green
                                    }
                                    Button("Usuń…", role: .destructive) {
                                        confirmDeletePortfolio = portfolio
                                    }
                                }
                            }
                            Button {
                                createPortfolio(in: group)
                            } label: {
                                Label("Nowy portfel", systemImage: "plus")
                            }
                            .buttonStyle(.plain)
                        } label: {
                            Label(group.name, systemImage: "folder")
                                .contextMenu {
                                    Button("Edytuj…") {
                                        renamingGroup = group
                                        renameText = group.name
                                        editColor = .green
                                    }
                                    Button("Usuń…", role: .destructive) {
                                        confirmDeleteGroup = group
                                    }
                                }
                        }
                    }
                    Button {
                        createGroupName = ""
                        createPortfolios = [DraftPortfolio()]
                        showCreateGroupSheet = true
                    } label: {
                        Label("Nowa grupa", systemImage: "plus")
                    }
                }
            }
            .listStyle(.sidebar)
        } detail: {
            NavigationStack {
                destinationView(appState.navigationSelection)
            }
        }
        .sheet(isPresented: $showCreateGroupSheet) {
            CreateGroupSheet(
                groupName: $createGroupName,
                portfolios: $createPortfolios,
                onCancel: { showCreateGroupSheet = false },
                onCreate: {
                    createGroup(name: createGroupName, portfolios: createPortfolios)
                    showCreateGroupSheet = false
                }
            )
        }
        .alert("Edytuj portfel", isPresented: Binding(
            get: { renamingPortfolio != nil },
            set: { if !$0 { renamingPortfolio = nil } }
        )) {
            TextField("Nazwa", text: $renameText)
            ColorPicker("Kolor", selection: $editColor, supportsOpacity: false)
            Button("Anuluj", role: .cancel) {
                renamingPortfolio = nil
            }
            Button("Zapisz") {
                guard let p = renamingPortfolio else { return }
                let newName = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !newName.isEmpty {
                    p.name = newName
                    p.colorHex = editColor.toHex() ?? p.colorHex
                    try? context.save()
                }
                renamingPortfolio = nil
            }
        } message: {
            Text("Ustaw nazwę i kolor portfela.")
        }
        .alert("Edytuj grupę", isPresented: Binding(
            get: { renamingGroup != nil },
            set: { if !$0 { renamingGroup = nil } }
        )) {
            TextField("Nazwa", text: $renameText)
            Button("Anuluj", role: .cancel) {
                renamingGroup = nil
            }
            Button("Zapisz") {
                guard let g = renamingGroup else { return }
                let newName = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !newName.isEmpty {
                    g.name = newName
                    try? context.save()
                }
                renamingGroup = nil
            }
        } message: {
            Text("Ustaw nazwę grupy.")
        }
        .alert("Usunąć portfel?", isPresented: Binding(
            get: { confirmDeletePortfolio != nil },
            set: { if !$0 { confirmDeletePortfolio = nil } }
        )) {
            Button("Anuluj", role: .cancel) {
                confirmDeletePortfolio = nil
            }
            Button("Usuń", role: .destructive) {
                guard let p = confirmDeletePortfolio else { return }
                let deletingId = p.id
                context.delete(p)
                try? context.save()

                if appState.selectedPortfolioId == deletingId {
                    appState.selectedPortfolioId = nil
                    appState.selectedGroupId = nil
                    appState.navigationSelection = .transactions
                }
                confirmDeletePortfolio = nil
            }
        } message: {
            Text("Ta operacja usunie też wszystkie operacje w tym portfelu.")
        }
        .alert("Usunąć grupę?", isPresented: Binding(
            get: { confirmDeleteGroup != nil },
            set: { if !$0 { confirmDeleteGroup = nil } }
        )) {
            Button("Anuluj", role: .cancel) {
                confirmDeleteGroup = nil
            }
            Button("Usuń", role: .destructive) {
                guard let g = confirmDeleteGroup else { return }
                let deletingGroupId = g.id
                let deletingPortfolioIds = Set(g.portfolios.map(\.id))
                context.delete(g)
                try? context.save()

                if let selectedPid = appState.selectedPortfolioId, deletingPortfolioIds.contains(selectedPid) {
                    appState.selectedPortfolioId = nil
                    appState.selectedGroupId = nil
                    appState.navigationSelection = .dashboard
                } else if appState.selectedGroupId == deletingGroupId {
                    appState.selectedGroupId = nil
                    appState.navigationSelection = .dashboard
                }

                confirmDeleteGroup = nil
            }
        } message: {
            Text("Ta operacja usunie też wszystkie portfele i operacje w tej grupie.")
        }
        .task {
            await bootstrapIfNeeded()
        }
    }

    @ViewBuilder
    private func destinationView(_ destination: NavigationDestination?) -> some View {
        switch destination ?? .dashboard {
        case .dashboard:
            DashboardView()
        case .positions:
            PositionsView()
        case .transactions:
            TransactionsView()
        case .imports:
            ImportView()
        case .rebalance:
            RebalanceView()
        case .bonds:
            BondsView()
        case .settings:
            SettingsView()
        case .group(let groupId):
            GroupDetailView(groupId: groupId)
        case .portfolio(let portfolioId):
            PortfolioDetailView(portfolioId: portfolioId)
        }
    }

    private func bootstrapIfNeeded() async {
        // Do not auto-create demo groups/portfolios.
    }

    private func createGroup(name: String, portfolios: [DraftPortfolio]) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let groupName = trimmed.isEmpty ? "Nowa grupa" : trimmed
        let group = PortfolioGroup(name: groupName, createdAt: .now)
        context.insert(group)

        let cleaned = portfolios
            .map { $0.cleaned() }
            .filter { !$0.name.isEmpty }

        for p in cleaned {
            let portfolio = Portfolio(
                name: p.name,
                baseCurrency: p.currency,
                colorHex: p.colorHex,
                kind: p.kind,
                createdAt: .now,
                group: group
            )
            context.insert(portfolio)
        }

        try? context.save()
        appState.selectedGroupId = group.id
        appState.navigationSelection = .group(group.id)
    }

    private func createPortfolio(in group: PortfolioGroup) {
        let portfolio = Portfolio(
            name: "Nowy portfel",
            baseCurrency: "PLN",
            colorHex: "#176b4d",
            kind: .manual,
            createdAt: .now,
            group: group
        )
        context.insert(portfolio)
        try? context.save()
        appState.selectPortfolio(portfolio)
        appState.navigationSelection = .portfolio(portfolio.id)
    }
}

private struct DraftPortfolio: Identifiable, Hashable {
    var id = UUID()
    var name: String = ""
    var currency: String = "PLN"
    var kind: PortfolioKind = .account
    var colorHex: String = "#176b4d"
    var color: Color = .green

    func cleaned() -> DraftPortfolio {
        var copy = self
        copy.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if copy.currency.isEmpty { copy.currency = "PLN" }
        copy.colorHex = color.toHex() ?? colorHex
        return copy
    }
}

private struct CreateGroupSheet: View {
    @Binding var groupName: String
    @Binding var portfolios: [DraftPortfolio]
    let onCancel: () -> Void
    let onCreate: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Grupa") {
                    TextField("Nazwa grupy", text: $groupName)
                }

                Section("Portfele (opcjonalnie)") {
                    ForEach($portfolios) { $p in
                        VStack(alignment: .leading, spacing: 8) {
                            TextField("Nazwa portfela", text: $p.name)
                            HStack {
                                Picker("Waluta", selection: $p.currency) {
                                    Text("PLN").tag("PLN")
                                    Text("EUR").tag("EUR")
                                    Text("USD").tag("USD")
                                }
                                .frame(maxWidth: 160)
                                Picker("Typ", selection: $p.kind) {
                                    Text("Konto").tag(PortfolioKind.account)
                                    Text("Manualny").tag(PortfolioKind.manual)
                                }
                                .frame(maxWidth: 220)
                            }
                            ColorPicker("Kolor", selection: $p.color, supportsOpacity: false)
                        }
                    }
                    .onDelete { offsets in
                        portfolios.remove(atOffsets: offsets)
                        if portfolios.isEmpty {
                            portfolios = [DraftPortfolio()]
                        }
                    }

                    Button {
                        portfolios.append(DraftPortfolio())
                    } label: {
                        Label("Dodaj portfel", systemImage: "plus")
                    }
                }
            }
            .navigationTitle("Nowa grupa")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Anuluj") { onCancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Utwórz") { onCreate() }
                }
            }
        }
        .frame(minWidth: 520, minHeight: 420)
    }
}

