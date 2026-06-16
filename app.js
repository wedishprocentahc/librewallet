"use strict";

const t = (key, params) => window.LW_I18N.t(key, params);

const STORAGE_KEY = "librewallet-investment-tracker-v1";
const BACKUP_FORMAT = "librewallet-backup";
const BACKUP_FORMAT_VERSION = 1;
function assetTypeLabel(type) {
  return t(`assetType.${type || "other"}`);
}

function getAssetTypeKeys() {
  return ["etf", "stock", "bond", "cash", "other"];
}

function getAssetTypeEntries() {
  return getAssetTypeKeys().map((key) => [key, assetTypeLabel(key)]);
}
const TYPE_COLORS = {
  etf: "#176b4d",
  stock: "#22577a",
  bond: "#a56b13",
  cash: "#5c4f82",
  other: "#686b6f",
};
const DEFAULT_TARGETS = { etf: 55, stock: 20, bond: 20, cash: 5, other: 0 };
const DEFAULT_FX = { PLN: 1, EUR: 4.28, USD: 3.92, GBP: 5.02, CHF: 4.58 };
const QUOTE_API_URL = "/api/quotes";
const HISTORY_API_URL = "/api/history";
const BOND_NOMINAL = 100;
// Presety polskich obligacji skarbowych detalicznych. Oprocentowanie I roku i marża są
// przybliżone (zmieniają się co miesiąc) i można je nadpisać w formularzu. "indexation":
// fixed = stałe, nbp = zmienne wg stopy referencyjnej NBP, cpi = indeksowane inflacją.
// "capitalization": true = odsetki kapitalizowane rocznie (płatne przy wykupie),
// false = odsetki wypłacane okresowo.
const BOND_PRESETS = {
  OTS: { name: "OTS – 3-miesięczne stałoprocentowe", termMonths: 3, firstYearRate: 3.0, margin: 0, indexation: "fixed", capitalization: true, earlyRedemptionFee: 0 },
  ROR: { name: "ROR – roczne zmienne (stopa ref. NBP)", termMonths: 12, firstYearRate: 5.75, margin: 0, indexation: "nbp", capitalization: false, earlyRedemptionFee: 0.5 },
  DOR: { name: "DOR – 2-letnie zmienne (ref. NBP + marża)", termMonths: 24, firstYearRate: 5.9, margin: 0.5, indexation: "nbp", capitalization: false, earlyRedemptionFee: 0.7 },
  TOS: { name: "TOS – 3-letnie stałoprocentowe", termMonths: 36, firstYearRate: 5.95, margin: 0, indexation: "fixed", capitalization: true, earlyRedemptionFee: 1.0 },
  COI: { name: "COI – 4-letnie indeksowane inflacją", termMonths: 48, firstYearRate: 6.05, margin: 1.5, indexation: "cpi", capitalization: false, earlyRedemptionFee: 0.7 },
  EDO: { name: "EDO – 10-letnie indeksowane inflacją", termMonths: 120, firstYearRate: 6.3, margin: 2.0, indexation: "cpi", capitalization: true, earlyRedemptionFee: 2.0 },
  ROS: { name: "ROS – 6-letnie rodzinne (inflacja)", termMonths: 72, firstYearRate: 6.2, margin: 2.0, indexation: "cpi", capitalization: true, earlyRedemptionFee: 0.7 },
  ROD: { name: "ROD – 12-letnie rodzinne (inflacja)", termMonths: 144, firstYearRate: 6.5, margin: 2.5, indexation: "cpi", capitalization: true, earlyRedemptionFee: 2.0 },
};
function getBenchmarkOptions() {
  return [
    { id: "", label: t("benchmark.none"), symbol: "", currency: "PLN", color: "" },
    { id: "wig", label: t("benchmark.wig"), composite: ["ETFBW20TR.WA", "ETFBM40TR.WA"], currency: "PLN", color: "#22577a" },
    { id: "wig20", label: t("benchmark.wig20"), symbol: "ETFBW20TR.WA", currency: "PLN", color: "#3d6f9b" },
    { id: "mwig40", label: t("benchmark.mwig40"), symbol: "ETFBM40TR.WA", currency: "PLN", color: "#5c4f82" },
    { id: "sp500", label: t("benchmark.sp500"), symbol: "^GSPC", currency: "USD", color: "#686b6f" },
    { id: "vwce", label: t("benchmark.vwce"), symbol: "VWCE.DE", currency: "EUR", color: "#4a6741" },
  ];
}
const RETURN_PERIODS = [
  { id: "1m", label: "1M", months: 1 },
  { id: "3m", label: "3M", months: 3 },
  { id: "6m", label: "6M", months: 6 },
  { id: "1y", labelKey: "period.1y", months: 12 },
  { id: "ytd", label: "YTD", ytd: true },
];
const OPERATION_MARKER_COLORS = {
  deposit: "#176b4d",
  withdrawal: "#af3636",
  buy: "#22577a",
  sell: "#a56b13",
  dividend: "#4a6741",
  interest: "#4a6741",
  transfer: "#5c4f82",
  fee: "#686b6f",
  tax: "#686b6f",
  other: "#686b6f",
};
const MARKER_TYPE_PRIORITY = [
  "deposit",
  "withdrawal",
  "buy",
  "sell",
  "transfer",
  "dividend",
  "interest",
  "fee",
  "tax",
  "other",
];
const SIGNIFICANT_MARKER_TYPES = new Set(["deposit", "withdrawal", "buy", "sell", "transfer"]);
const UNIVERSAL_IMPORT_HEADERS = [
  "date",
  "type",
  "symbol",
  "name",
  "quantity",
  "price",
  "gross",
  "fee",
  "currency",
  "cash_delta",
  "external_id",
  "notes",
];
const UNIVERSAL_IMPORT_TYPES = new Set([
  "buy",
  "sell",
  "deposit",
  "withdrawal",
  "transfer",
  "fee",
  "tax",
  "interest",
  "dividend",
  "other",
]);
const UNIVERSAL_TYPE_ALIASES = {
  buy: "buy",
  kupno: "buy",
  zakup: "buy",
  sell: "sell",
  sprzedaz: "sell",
  deposit: "deposit",
  wplata: "deposit",
  withdrawal: "withdrawal",
  wyplata: "withdrawal",
  transfer: "transfer",
  przelew: "transfer",
  konwersja: "transfer",
  fee: "fee",
  prowizja: "fee",
  tax: "tax",
  podatek: "tax",
  interest: "interest",
  odsetki: "interest",
  dividend: "dividend",
  dywidenda: "dividend",
  other: "other",
  inne: "other",
};
const UNIVERSAL_CASH_TYPES = new Set(["deposit", "withdrawal", "transfer", "fee", "tax", "interest", "dividend", "other"]);
const MARKER_STRIP_HEIGHT = 32;
const MARKER_LANE_HEIGHT = 11;
const MARKER_MAX_LANES = 3;
function getAssetScopes() {
  return [
    { id: "asset:etf", assetType: "etf", name: `${t("app.portfolio")} ETF`, label: t("holdings.group.assetType"), color: TYPE_COLORS.etf },
    { id: "asset:stock", assetType: "stock", name: `${t("app.portfolio")} ${t("assetType.stock")}`, label: t("holdings.group.assetType"), color: TYPE_COLORS.stock },
    { id: "asset:bond", assetType: "bond", name: `${t("app.portfolio")} ${t("assetType.bond")}`, label: t("holdings.group.assetType"), color: TYPE_COLORS.bond },
    { id: "asset:other", assetType: "other", name: `${t("app.portfolio")} ${t("assetType.other")}`, label: t("holdings.group.assetType"), color: TYPE_COLORS.other },
  ];
}

const dom = {};
let state = loadState();
let importPreview = [];
let historyZoom = null;
let historyDrag = null;
const chartRuntime = { history: null, type: null, currency: null, profit: null };
let chartTooltipEl = null;
let benchmarkFetchToken = 0;
let benchmarkFetchInFlight = false;
const benchmarkFetchState = { key: "", failed: false };

document.addEventListener("DOMContentLoaded", async () => {
  cacheDom();
  bindEvents();
  if (state.locale) {
    window.LW_I18N.setLocale(state.locale);
    finishBoot();
    return;
  }
  const installerLocale = await window.LW_I18N.detectDefaultLocale();
  showLanguageModal(installerLocale);
});

function finishBoot() {
  ensurePortfolio();
  migratePortfolioGroups();
  setupDesktopHint();
  render();
  holdingsSync();
}

function setupDesktopHint() {
  if (!dom.desktopHint) return;
  const local = /^(127\.0\.0\.1|localhost)$/.test(window.location.hostname);
  dom.desktopHint.classList.toggle("hidden", !local);
}

function showLanguageModal(presetLocale) {
  const modal = document.getElementById("languageModal");
  if (!modal) {
    finishBoot();
    return;
  }
  let selected = presetLocale || window.LW_I18N.getLocale();
  modal.classList.remove("hidden");
  const options = modal.querySelectorAll(".language-card");
  const sync = () => {
    options.forEach((button) => {
      const isActive = button.dataset.locale === selected;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    window.LW_I18N.setLocale(selected);
    window.LW_I18N.applyI18n(modal);
  };
  options.forEach((button) => {
    button.addEventListener("click", () => {
      selected = button.dataset.locale;
      sync();
    });
  });
  sync();
  document.getElementById("languageConfirmButton").addEventListener("click", () => {
    state.locale = selected;
    window.LW_I18N.setLocale(selected);
    saveState();
    modal.classList.add("hidden");
    finishBoot();
  });
}

function cacheDom() {
  [
    "portfolioList",
    "portfolioForm",
    "portfolioName",
    "scopeLabel",
    "scopeTitle",
    "refreshPricesButton",
    "exportButton",
    "fileInput",
    "quoteStatus",
    "desktopHint",
    "clearDataButton",
    "metricValue",
    "metricCashMode",
    "metricProfit",
    "metricProfitPct",
    "metricInvested",
    "metricTxCount",
    "metricAssets",
    "metricCurrencies",
    "historyMode",
    "historyBenchmark",
    "historyMarkers",
    "historyRangeLabel",
    "historyZoomOut",
    "historyZoomIn",
    "historyZoomReset",
    "historyWarning",
    "historyChart",
    "historyLegend",
    "typeChart",
    "typeTotal",
    "typeLegend",
    "profitChart",
    "currencyChart",
    "currencyTotal",
    "currencyLegend",
    "portfolioComparison",
    "holdingSearch",
    "holdingGroup",
    "holdingsTable",
    "holdingsReturnsHint",
    "transactionSearch",
    "manualToggle",
    "manualForm",
    "bondToggle",
    "bondForm",
    "bondHint",
    "redemptionToggle",
    "redemptionForm",
    "redemptionHint",
    "transactionsTable",
    "targetsForm",
    "rebalanceTable",
    "importModal",
    "openImportModalButton",
    "openImportModalButtonSettings",
    "closeImportModalButton",
    "importPortfolio",
    "importNewPortfolioButton",
    "importNewGroupButton",
    "universalFileInput",
    "downloadUniversalTemplateButton",
    "universalImportSchema",
    "importStatus",
    "importPreview",
    "commitImportButton",
    "fxForm",
    "backupButton",
    "backupInput",
    "backupStatus",
    "bondMaturitySummary",
    "bondMaturityCalendar",
    "portfolioGroupName",
    "portfolioGroupForm",
    "portfolioGroupsPanel",
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  document.querySelector("[data-portfolio-id='all']").addEventListener("click", () => {
    state.selectedPortfolioId = "all";
    saveState();
    render();
  });

  bindPortfolioDragDrop();

  dom.portfolioForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = dom.portfolioName.value.trim();
    if (!name) return;
    const portfolio = {
      id: createId("portfolio"),
      name,
      baseCurrency: "PLN",
      color: nextPortfolioColor(),
      createdAt: new Date().toISOString(),
    };
    state.portfolios.push(portfolio);
    state.selectedPortfolioId = portfolio.id;
    dom.portfolioName.value = "";
    saveState();
    render();
  });

  dom.portfolioGroupForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = dom.portfolioGroupName?.value.trim();
    if (!name) return;
    const group = createPortfolioGroup(name);
    state.selectedPortfolioId = groupScopeId(group.id);
    dom.portfolioGroupName.value = "";
    saveState();
    render();
  });

  dom.openImportModalButton?.addEventListener("click", openImportModal);
  dom.openImportModalButtonSettings?.addEventListener("click", openImportModal);
  dom.closeImportModalButton?.addEventListener("click", closeImportModal);
  dom.importModal?.addEventListener("click", (event) => {
    if (event.target === dom.importModal) closeImportModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.importModal && !dom.importModal.classList.contains("hidden")) {
      closeImportModal();
    }
  });

  dom.fileInput?.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    closeImportModal();
    await handleFiles(files, { requireZip: true });
    event.target.value = "";
  });

  dom.universalFileInput?.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    closeImportModal();
    await handleFiles(files, { requireUniversal: true });
    event.target.value = "";
  });

  dom.downloadUniversalTemplateButton?.addEventListener("click", downloadUniversalImportTemplate);
  dom.importNewPortfolioButton?.addEventListener("click", () => addPortfolioFromImportModal());
  dom.importNewGroupButton?.addEventListener("click", () => addGroupFromImportModal());

  dom.commitImportButton.addEventListener("click", commitImport);
  dom.refreshPricesButton.addEventListener("click", refreshLivePrices);
  dom.exportButton.addEventListener("click", exportTransactions);
  dom.clearDataButton.addEventListener("click", clearData);
  window.addEventListener("librewallet:locale", () => render());
  dom.backupButton.addEventListener("click", exportBackup);
  dom.backupInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await restoreBackup(file);
  });
  dom.historyMode.addEventListener("change", () => {
    historyZoom = null;
    render();
  });
  dom.historyMarkers?.addEventListener("change", () => {
    state.showHistoryMarkers = dom.historyMarkers.checked;
    saveState();
    if (chartRuntime.history) {
      chartRuntime.history.hoverIndex = null;
      chartRuntime.history.hoverMarkerIndex = null;
    }
    hideChartTooltip();
    renderSummary();
  });
  dom.historyBenchmark.addEventListener("change", () => {
    state.selectedBenchmark = dom.historyBenchmark.value || "";
    saveState();
    benchmarkFetchToken += 1;
    benchmarkFetchInFlight = false;
    benchmarkFetchState.failed = false;
    benchmarkFetchState.key = "";
    if (chartRuntime.history) {
      chartRuntime.history.hoverIndex = null;
      chartRuntime.history.hoverMarkerIndex = null;
    }
    hideChartTooltip();
    if (state.selectedBenchmark) {
      scheduleBenchmarkFetch(true);
    } else {
      renderSummary();
    }
  });
  dom.historyZoomIn.addEventListener("click", () => zoomHistory(0.72));
  dom.historyZoomOut.addEventListener("click", () => zoomHistory(1.38));
  dom.historyZoomReset.addEventListener("click", () => {
    historyZoom = null;
    render();
  });
  dom.historyChart.addEventListener("wheel", handleHistoryWheel, { passive: false });
  dom.historyChart.addEventListener("pointerdown", handleHistoryPointerDown);
  dom.historyChart.addEventListener("pointermove", handleHistoryPointerMove);
  dom.historyChart.addEventListener("pointerup", handleHistoryPointerEnd);
  dom.historyChart.addEventListener("pointercancel", handleHistoryPointerEnd);
  dom.historyChart.addEventListener("mousemove", handleHistoryMouseMove);
  dom.historyChart.addEventListener("mouseleave", () => clearChartHover("history"));
  dom.typeChart.addEventListener("mousemove", (event) => handleDoughnutMouseMove("type", dom.typeChart, event));
  dom.typeChart.addEventListener("mouseleave", () => clearChartHover("type"));
  dom.currencyChart.addEventListener("mousemove", (event) => handleDoughnutMouseMove("currency", dom.currencyChart, event));
  dom.currencyChart.addEventListener("mouseleave", () => clearChartHover("currency"));
  dom.profitChart.addEventListener("mousemove", handleProfitMouseMove);
  dom.profitChart.addEventListener("mouseleave", () => clearChartHover("profit"));
  dom.holdingSearch.addEventListener("input", renderHoldings);
  dom.holdingGroup.addEventListener("change", renderHoldings);
  dom.transactionSearch.addEventListener("input", renderTransactions);
  dom.manualToggle.addEventListener("click", () => {
    dom.manualForm.classList.toggle("hidden");
  });
  dom.manualForm.addEventListener("submit", addManualTransaction);
  dom.bondToggle.addEventListener("click", () => {
    dom.bondForm.classList.toggle("hidden");
    if (!dom.bondForm.classList.contains("hidden")) applyBondPreset();
  });
  dom.bondForm.addEventListener("submit", addBondTransaction);
  dom.bondForm.elements.bondType.addEventListener("change", applyBondPreset);
  dom.bondForm.elements.date.addEventListener("change", () => applyBondPreset({ keepRates: true }));
  dom.bondForm.elements.portfolioId.addEventListener("change", handleBondPortfolioSelect);
  dom.redemptionToggle.addEventListener("click", () => {
    dom.redemptionForm.classList.toggle("hidden");
    if (!dom.redemptionForm.classList.contains("hidden")) renderRedemptionForm();
  });
  dom.redemptionForm.addEventListener("submit", addRedemption);
  dom.redemptionForm.elements.bondKey.addEventListener("change", applyRedemptionDefaults);
  dom.redemptionForm.elements.quantity.addEventListener("input", updateRedemptionFee);
}

function defaultState() {
  return {
    version: 1,
    selectedPortfolioId: "all",
    portfolios: [],
    transactions: [],
    priceOverrides: {},
    priceMeta: {},
    quoteHistory: {},
    fxHistory: {},
    lastQuoteUpdate: "",
    lastHistoryUpdate: "",
    assetTypes: {},
    targets: { ...DEFAULT_TARGETS },
    targetTolerance: 8,
    fxRates: { ...DEFAULT_FX },
    selectedBenchmark: "",
    benchmarkHistory: {},
    showHistoryMarkers: true,
    portfolioGroups: [],
    locale: "",
  };
}

function normalizeStoredState(stored) {
  const fallback = defaultState();
  if (!stored || stored.version !== 1) return { ...fallback };
  return {
    ...fallback,
    ...stored,
    portfolios: Array.isArray(stored.portfolios)
      ? stored.portfolios.map((portfolio) => {
          if (!portfolio.kind && String(portfolio.id).startsWith("account-")) {
            return { ...portfolio, kind: "account" };
          }
          return portfolio;
        })
      : [],
    transactions: Array.isArray(stored.transactions) ? stored.transactions : [],
    priceOverrides: stored.priceOverrides || {},
    priceMeta: stored.priceMeta || {},
    quoteHistory: stored.quoteHistory || {},
    fxHistory: stored.fxHistory || {},
    benchmarkHistory: stored.benchmarkHistory || {},
    selectedBenchmark: stored.selectedBenchmark || "",
    showHistoryMarkers: stored.showHistoryMarkers !== false,
    portfolioGroups: Array.isArray(stored.portfolioGroups) ? stored.portfolioGroups : [],
    locale: stored.locale || "",
    assetTypes: stored.assetTypes || {},
    targets: { ...DEFAULT_TARGETS, ...(stored.targets || {}) },
    fxRates: { ...DEFAULT_FX, ...(stored.fxRates || {}) },
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeStoredState(stored);
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  holdingsSync();
}

let holdingsSyncPending = false;
function holdingsSync() {
  if (holdingsSyncPending) return;
  holdingsSyncPending = true;
  setTimeout(() => {
    holdingsSyncPending = false;
    try {
      fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolios: state.portfolios,
          transactions: state.transactions,
        }),
      }).catch(() => {});
    } catch {}
  }, 300);
}

function ensurePortfolio() {
  if (state.portfolios.length) return;
  const portfolio = {
    id: createId("portfolio"),
    name: t("defaults.xtbMain"),
    baseCurrency: "PLN",
    color: "#176b4d",
    createdAt: new Date().toISOString(),
  };
  state.portfolios.push(portfolio);
  state.selectedPortfolioId = portfolio.id;
  saveState();
}

function languageCardMarkup(locale, isActive) {
  const label = locale === "pl" ? t("language.polish") : t("language.english");
  const code = locale.toUpperCase();
  const flag = locale === "pl" ? "🇵🇱" : "🇬🇧";
  return `
    <button class="language-card ${isActive ? "active" : ""}" type="button" data-locale="${locale}" aria-pressed="${isActive}">
      <span class="language-card-flag" aria-hidden="true">${flag}</span>
      <span class="language-card-text">
        <strong class="language-card-label">${escapeHtml(label)}</strong>
        <span class="language-card-code">${code}</span>
      </span>
      <span class="language-card-check" aria-hidden="true">✓</span>
    </button>
  `;
}

function renderLanguageSettings() {
  const panel = document.getElementById("languageSettings");
  if (!panel) return;
  panel.innerHTML = window.LW_I18N.SUPPORTED.map((locale) =>
    languageCardMarkup(locale, state.locale === locale),
  ).join("");
  panel.querySelectorAll("[data-locale]").forEach((button) => {
    button.addEventListener("click", () => {
      state.locale = button.dataset.locale;
      window.LW_I18N.setLocale(state.locale);
      saveState();
      render();
    });
  });
}

function render() {
  if (state.locale) window.LW_I18N.applyI18n();
  ensurePortfolio();
  updateTabAvailability();
  renderLanguageSettings();
  renderPortfolioNav();
  renderImportPortfolioSelect();
  renderUniversalImportSchema();
  renderManualPortfolioSelect();
  renderBondPortfolioSelect();
  renderRedemptionForm();
  renderQuoteStatus();
  renderSummary();
  renderHoldings();
  renderTransactions();
  renderTargets();
  renderBondMaturityCalendar();
  renderFx();
  renderImportPreview();
  renderPortfolioGroupsPanel();
  renderHistoryBenchmarkSelect();
  renderHistoryMarkerToggle();
}

function setTab(tabName) {
  activateTab(tabName);
  requestAnimationFrame(render);
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabName);
  });
}

function updateTabAvailability() {
  const allocationButton = document.querySelector("[data-tab='allocation']");
  const allocationPanel = document.getElementById("allocation");
  const showAllocation = isAggregateScopeId(state.selectedPortfolioId);
  if (allocationButton) allocationButton.hidden = !showAllocation;
  if (allocationPanel) allocationPanel.hidden = !showAllocation;
  if (!showAllocation && allocationButton?.classList.contains("active")) {
    activateTab("dashboard");
  }
}

function renderPortfolioNav() {
  document.querySelector("[data-portfolio-id='all']").classList.toggle(
    "active",
    state.selectedPortfolioId === "all",
  );
  dom.portfolioList.innerHTML = "";
  if (state.portfolios.length) {
    dom.portfolioList.appendChild(portfolioGroupTitle(t("nav.accountsAndPortfolios")));
  }
  const groupedIds = new Set();
  (state.portfolioGroups || []).forEach((group) => {
    const members = portfoliosInGroup(group.id);
    if (!members.length) return;
    members.forEach((portfolio) => groupedIds.add(portfolio.id));
    dom.portfolioList.appendChild(createPortfolioGroupBlock(group, members));
  });
  const ungrouped = state.portfolios.filter((portfolio) => !groupedIds.has(portfolio.id));
  const hasGroups = (state.portfolioGroups || []).some((group) => portfoliosInGroup(group.id).length);
  if (ungrouped.length || hasGroups) {
    dom.portfolioList.appendChild(createPortfolioUngroupedBlock(ungrouped, !ungrouped.length));
  }
  dom.portfolioList.appendChild(portfolioGroupTitle(t("nav.instrumentTypes")));
  getAssetScopes().forEach((scope) => {
    dom.portfolioList.appendChild(portfolioButton(scope.id, scope.name, scope.color));
  });
}

function createPortfolioGroupBlock(group, members) {
  const block = document.createElement("div");
  block.className = "portfolio-drop-zone";
  block.dataset.dropZone = `group:${group.id}`;
  const scopeId = groupScopeId(group.id);
  const childActive = members.some((portfolio) => portfolio.id === state.selectedPortfolioId);
  block.appendChild(
    portfolioGroupButton(group, scopeId, state.selectedPortfolioId === scopeId, childActive, members.length),
  );
  const membersWrap = document.createElement("div");
  membersWrap.className = "portfolio-group-members";
  members.forEach((portfolio) => {
    membersWrap.appendChild(portfolioSubButton(portfolio.id, portfolio.name, portfolio.color));
  });
  block.appendChild(membersWrap);
  return block;
}

function createPortfolioUngroupedBlock(portfolios, showDropHint) {
  const block = document.createElement("div");
  block.className = "portfolio-drop-zone portfolio-ungrouped-zone";
  block.dataset.dropZone = "ungrouped";
  portfolios.forEach((portfolio) => {
    block.appendChild(portfolioButton(portfolio.id, portfolio.name, portfolio.color));
  });
  if (showDropHint) {
    const hint = document.createElement("div");
    hint.className = "portfolio-drop-hint";
    hint.textContent = t("nav.dropUngrouped");
    block.appendChild(hint);
  }
  return block;
}

function isDraggablePortfolioId(id) {
  return state.portfolios.some((portfolio) => portfolio.id === id);
}

function assignPortfolioToGroup(portfolioId, groupId = "") {
  const portfolio = state.portfolios.find((item) => item.id === portfolioId);
  if (!portfolio || !isDraggablePortfolioId(portfolioId)) return;
  const nextGroupId = groupId || "";
  if ((portfolio.groupId || "") === nextGroupId) return;
  portfolio.groupId = nextGroupId;
  cleanupEmptyPortfolioGroups();
  saveState();
  render();
}

function bindPortfolioDragDrop() {
  if (!dom.portfolioList || dom.portfolioList.dataset.dragBound) return;
  dom.portfolioList.dataset.dragBound = "true";
  let activeDropZone = null;

  dom.portfolioList.addEventListener("dragstart", (event) => {
    const button = event.target.closest("[data-drag-portfolio-id]");
    if (!button) return;
    event.dataTransfer.setData("text/portfolio-id", button.dataset.dragPortfolioId);
    event.dataTransfer.effectAllowed = "move";
    button.classList.add("is-dragging");
  });

  dom.portfolioList.addEventListener("dragend", (event) => {
    event.target.closest("[data-drag-portfolio-id]")?.classList.remove("is-dragging");
    activeDropZone?.classList.remove("drop-target-active");
    activeDropZone = null;
  });

  dom.portfolioList.addEventListener("dragover", (event) => {
    const zone = event.target.closest("[data-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (activeDropZone && activeDropZone !== zone) {
      activeDropZone.classList.remove("drop-target-active");
    }
    activeDropZone = zone;
    zone.classList.add("drop-target-active");
  });

  dom.portfolioList.addEventListener("drop", (event) => {
    const zone = event.target.closest("[data-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("drop-target-active");
    activeDropZone = null;
    const portfolioId = event.dataTransfer.getData("text/portfolio-id");
    if (!portfolioId) return;
    const dropValue = zone.dataset.dropZone || "";
    const groupId = dropValue === "ungrouped" ? "" : dropValue.startsWith("group:") ? dropValue.slice(6) : "";
    assignPortfolioToGroup(portfolioId, groupId);
  });
}

function portfolioGroupTitle(text) {
  const title = document.createElement("div");
  title.className = "portfolio-group-title";
  title.textContent = text;
  return title;
}

function portfolioButton(id, name, color) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `portfolio-button ${state.selectedPortfolioId === id ? "active" : ""}`;
  button.dataset.portfolioId = id;
  if (isDraggablePortfolioId(id)) {
    button.draggable = true;
    button.dataset.dragPortfolioId = id;
    button.title = t("nav.dragPortfolio");
  }
  button.innerHTML = `
    <span class="scope-dot" style="background:${escapeAttr(color)}"></span>
    <span>${escapeHtml(name)}</span>
  `;
  button.addEventListener("click", () => {
    state.selectedPortfolioId = id;
    saveState();
    render();
  });
  return button;
}

function portfolioGroupButton(group, scopeId, isActive, childActive, memberCount) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `portfolio-button portfolio-group-button ${isActive ? "active" : childActive ? "active-child" : ""}`;
  button.dataset.portfolioId = scopeId;
  button.innerHTML = `
    <span class="scope-dot group-dot" style="background:${escapeAttr(group.color)}"></span>
    <span class="portfolio-group-label">
      <span>${escapeHtml(group.name)}</span>
      <small>${memberCount} ${window.LW_I18N.pluralAccounts(memberCount)}</small>
    </span>
  `;
  button.addEventListener("click", () => {
    state.selectedPortfolioId = scopeId;
    saveState();
    render();
  });
  return button;
}

function portfolioSubButton(id, name, color) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `portfolio-button portfolio-sub-button ${state.selectedPortfolioId === id ? "active" : ""}`;
  button.dataset.portfolioId = id;
  button.draggable = true;
  button.dataset.dragPortfolioId = id;
  button.title = t("nav.dragPortfolio");
  button.innerHTML = `
    <span class="scope-dot" style="background:${escapeAttr(color)}"></span>
    <span>${escapeHtml(name)}</span>
  `;
  button.addEventListener("click", () => {
    state.selectedPortfolioId = id;
    saveState();
    render();
  });
  return button;
}

function renderImportPortfolioSelect(selectedId = "") {
  if (!dom.importPortfolio) return;
  const current = selectedId || dom.importPortfolio.value || resolveFormPortfolioId();
  dom.importPortfolio.innerHTML = buildPortfolioSelectOptions(current);
  dom.importPortfolio.value = current;
}

function addPortfolioFromImportModal(groupId = "") {
  const name = (window.prompt(t("form.newPortfolio"), t("form.newPortfolioPlaceholder")) || "").trim();
  if (!name) return;
  const portfolio = {
    id: createId("portfolio"),
    name,
    baseCurrency: "PLN",
    color: nextPortfolioColor(),
    groupId: groupId || "",
    createdAt: new Date().toISOString(),
  };
  state.portfolios.push(portfolio);
  saveState();
  render();
  renderImportPortfolioSelect(portfolio.id);
  dom.importPortfolio?.focus();
}

function addGroupFromImportModal() {
  const groupName = (window.prompt(t("form.newGroup"), t("form.newGroupPlaceholder")) || "").trim();
  if (!groupName) return;
  const group = createPortfolioGroup(groupName);
  const portfolioName =
    (window.prompt(t("import.newGroupPortfolioPrompt", { group: groupName }), groupName) || "").trim() || groupName;
  const portfolio = {
    id: createId("portfolio"),
    name: portfolioName,
    baseCurrency: "PLN",
    color: nextPortfolioColor(),
    groupId: group.id,
    createdAt: new Date().toISOString(),
  };
  state.portfolios.push(portfolio);
  saveState();
  render();
  renderImportPortfolioSelect(portfolio.id);
  dom.importPortfolio?.focus();
}

function openImportModal() {
  if (!dom.importModal) return;
  renderImportPortfolioSelect();
  dom.importModal.classList.remove("hidden");
  if (state.locale) window.LW_I18N.applyI18n(dom.importModal);
  dom.closeImportModalButton?.focus();
}

function closeImportModal() {
  dom.importModal?.classList.add("hidden");
}

function renderUniversalImportSchema() {
  if (!dom.universalImportSchema) return;
  const columnHints = {
    date: t("import.universal.col.date"),
    type: t("import.universal.col.type"),
    symbol: t("import.universal.col.symbol"),
    name: t("import.universal.col.name"),
    quantity: t("import.universal.col.quantity"),
    price: t("import.universal.col.price"),
    gross: t("import.universal.col.gross"),
    fee: t("import.universal.col.fee"),
    currency: t("import.universal.col.currency"),
    cash_delta: t("import.universal.col.cashDelta"),
    external_id: t("import.universal.col.externalId"),
    notes: t("import.universal.col.notes"),
  };
  const typeRows = [...UNIVERSAL_IMPORT_TYPES]
    .map((type) => `<tr><td><code>${escapeHtml(type)}</code></td><td>${escapeHtml(t(`tx.${type}`))}</td></tr>`)
    .join("");
  dom.universalImportSchema.innerHTML = `
    <p class="muted">${escapeHtml(t("import.universal.schemaIntro"))}</p>
    <div class="table-wrap">
      <table class="import-schema-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("import.universal.schemaColumn"))}</th>
            <th>${escapeHtml(t("import.universal.schemaDescription"))}</th>
          </tr>
        </thead>
        <tbody>
          ${UNIVERSAL_IMPORT_HEADERS.map((column) => `<tr><td><code>${escapeHtml(column)}</code></td><td>${escapeHtml(columnHints[column] || "")}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="muted">${escapeHtml(t("import.universal.schemaTypesIntro"))}</p>
    <div class="table-wrap">
      <table class="import-schema-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("table.type"))}</th>
            <th>${escapeHtml(t("import.universal.schemaTypeLabel"))}</th>
          </tr>
        </thead>
        <tbody>${typeRows}</tbody>
      </table>
    </div>
  `;
}

function renderManualPortfolioSelect() {
  const select = dom.manualForm.elements.portfolioId;
  select.innerHTML = buildPortfolioSelectOptions(resolveFormPortfolioId());
  dom.manualForm.elements.date.value ||= toDateInput(new Date());
}

function renderBondPortfolioSelect() {
  if (!dom.bondForm) return;
  const select = dom.bondForm.elements.portfolioId;
  const options = buildPortfolioSelectOptions(resolveFormPortfolioId());
  // Obligacje często leżą na osobnym koncie (np. Pekao SA), które nie pochodzi z importu XTB.
  // Pozwalamy utworzyć takie konto wprost z formularza.
  select.innerHTML = `${options}<option value="__new__">${escapeHtml(t("bond.newAccount"))}</option>`;
  dom.bondForm.elements.date.value ||= toDateInput(new Date());
  applyBondPreset({ keepRates: true });
}

// Tworzy nowy portfel/konto z poziomu listy w formularzu obligacji (np. konto Pekao SA).
function handleBondPortfolioSelect(event) {
  const select = event.target;
  if (select.value !== "__new__") return;
  const name = (window.prompt(t("prompt.newAccount"), t("prompt.newAccountDefault")) || "").trim();
  if (!name) {
    renderBondPortfolioSelect();
    return;
  }
  const portfolio = {
    id: createId("portfolio"),
    name,
    baseCurrency: "PLN",
    color: nextPortfolioColor(),
    createdAt: new Date().toISOString(),
  };
  state.portfolios.push(portfolio);
  saveState();
  render();
  dom.bondForm.elements.portfolioId.value = portfolio.id;
}

// Zwraca aktualnie posiadane obligacje (per portfel + seria) z dodatnią liczbą sztuk,
// licząc kupna minus wcześniejsze wykupy. Używane przez formularz wykupu.
function bondMaturityDate(bond) {
  if (bond?.maturityDate) return bond.maturityDate;
  if (bond?.purchaseDate && bond?.termMonths) return addMonthsToDate(bond.purchaseDate, bond.termMonths);
  return "";
}

function daysUntilDate(dateText) {
  if (!dateText) return null;
  const today = toDateInput(new Date());
  return Math.round((dateMs(dateText) - dateMs(today)) / (24 * 60 * 60 * 1000));
}

function formatDaysUntil(days) {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days === 0) return t("date.today");
  if (days > 0) return `za ${days} dni`;
  return `${Math.abs(days)} dni temu`;
}

function getScopedBondMaturities(scopeId = state.selectedPortfolioId) {
  const portfolioName = (id) => state.portfolios.find((portfolio) => portfolio.id === id)?.name || "Portfel";
  let held = getHeldBondPositions();
  if (scopeId !== "all" && !getAssetScope(scopeId)) {
    const portfolioIds = new Set(getScopePortfolioIds(scopeId));
    held = held.filter((entry) => portfolioIds.has(entry.portfolioId));
  }
  const today = toDateInput(new Date());
  return held
    .map((entry) => {
      const maturityDate = bondMaturityDate(entry.bond);
      const maturityValuePerUnit = maturityDate
        ? bondCurrentPrice(entry.bond, new Date(`${maturityDate}T12:00:00`))
        : bondCurrentPrice(entry.bond);
      const totalValue = maturityValuePerUnit * entry.qty;
      const daysUntil = daysUntilDate(maturityDate);
      return {
        ...entry,
        maturityDate,
        maturityValuePerUnit,
        totalValue,
        daysUntil,
        isPast: Boolean(maturityDate && maturityDate < today),
        isSoon: daysUntil != null && daysUntil >= 0 && daysUntil <= 90,
        portfolioName: portfolioName(entry.portfolioId),
        bondLabel: entry.bond?.code || entry.symbol,
        bondName: entry.bond?.presetName || BOND_PRESETS[entry.bond?.code]?.name || entry.name,
      };
    })
    .sort((a, b) => {
      const byDate = (a.maturityDate || "9999").localeCompare(b.maturityDate || "9999");
      if (byDate !== 0) return byDate;
      return a.symbol.localeCompare(b.symbol, "pl");
    });
}

function groupBondMaturitiesByYear(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const year = entry.maturityDate ? entry.maturityDate.slice(0, 4) : "Brak daty";
    if (!groups.has(year)) {
      groups.set(year, { year, totalQty: 0, totalValue: 0, items: [] });
    }
    const group = groups.get(year);
    group.totalQty += entry.qty;
    group.totalValue += entry.totalValue;
    group.items.push(entry);
  });
  return Array.from(groups.values()).sort((a, b) => a.year.localeCompare(b.year));
}

function renderBondMaturityCalendar() {
  if (!dom.bondMaturityCalendar || !dom.bondMaturitySummary) return;
  const scope = getScopeMeta();
  const entries = getScopedBondMaturities(state.selectedPortfolioId);
  if (!entries.length) {
    dom.bondMaturitySummary.innerHTML = "";
    dom.bondMaturityCalendar.innerHTML = `<p class="muted bond-calendar-empty">${escapeHtml(t("bond.noOpenInView"))}</p>`;
    return;
  }

  const today = toDateInput(new Date());
  const thisYear = today.slice(0, 4);
  const horizon = addMonthsToDate(today, 12);
  const upcoming = entries.filter((entry) => !entry.isPast);
  const overdue = entries.filter((entry) => entry.isPast);
  const thisYearEntries = upcoming.filter((entry) => entry.maturityDate.startsWith(thisYear));
  const next12Entries = upcoming.filter((entry) => entry.maturityDate && entry.maturityDate <= horizon);
  const totalUpcomingValue = upcoming.reduce((sum, entry) => sum + entry.totalValue, 0);

  dom.bondMaturitySummary.innerHTML = `
    <article class="bond-metric">
      <span>Otwarte serie</span>
      <strong>${entries.length}</strong>
      <small>${formatNumber(entries.reduce((sum, entry) => sum + entry.qty, 0))} szt.</small>
    </article>
    <article class="bond-metric">
      <span>Do wykupu łącznie</span>
      <strong>${formatMoney(totalUpcomingValue, scope.baseCurrency)}</strong>
      <small>szacowana kwota</small>
    </article>
    <article class="bond-metric">
      <span>W tym roku</span>
      <strong>${formatMoney(thisYearEntries.reduce((sum, entry) => sum + entry.totalValue, 0), scope.baseCurrency)}</strong>
      <small>${thisYearEntries.length} serii</small>
    </article>
    <article class="bond-metric">
      <span>12 miesięcy</span>
      <strong>${formatMoney(next12Entries.reduce((sum, entry) => sum + entry.totalValue, 0), scope.baseCurrency)}</strong>
      <small>${next12Entries.length} serii</small>
    </article>
  `;

  const yearGroups = groupBondMaturitiesByYear(entries);
  const overdueBlock = overdue.length
    ? `
      <section class="bond-year-group bond-year-overdue">
        <header class="bond-year-heading">
          <strong>Po terminie wykupu</strong>
          <span>${overdue.length} serii · ${formatMoney(overdue.reduce((sum, entry) => sum + entry.totalValue, 0), scope.baseCurrency)}</span>
        </header>
        <div class="table-wrap">
          <table class="bond-maturity-table">
            <thead>
              <tr>
                <th>Data wykupu</th>
                <th>Termin</th>
                <th>Walor</th>
                <th>Ilość</th>
                <th>Kwota wykupu</th>
                <th>Portfel</th>
              </tr>
            </thead>
            <tbody>${overdue.map((entry) => bondMaturityRow(entry)).join("")}</tbody>
          </table>
        </div>
        <p class="muted bond-overdue-hint">Zarejestruj wykup w Operacjach, jeśli obligacje zostały już wykupione.</p>
      </section>
    `
    : "";

  dom.bondMaturityCalendar.innerHTML = `
    ${overdueBlock}
    ${yearGroups
      .map((group) => {
        return `
          <section class="bond-year-group">
            <header class="bond-year-heading">
              <strong>${escapeHtml(group.year)}</strong>
              <span>${group.items.length} serii · ${formatNumber(group.totalQty)} szt. · ${formatMoney(group.totalValue, scope.baseCurrency)}</span>
            </header>
            <div class="table-wrap">
              <table class="bond-maturity-table">
                <thead>
                  <tr>
                    <th>Data wykupu</th>
                    <th>Termin</th>
                    <th>Walor</th>
                    <th>Ilość</th>
                    <th>Kwota wykupu</th>
                    <th>Portfel</th>
                  </tr>
                </thead>
                <tbody>${group.items.map((entry) => bondMaturityRow(entry)).join("")}</tbody>
              </table>
            </div>
          </section>
        `;
      })
      .join("")}
  `;
}

function bondMaturityRow(entry) {
  const rowClass = entry.isPast ? "bond-row-overdue" : entry.isSoon ? "bond-row-soon" : "";
  const termClass = entry.isPast ? "negative" : entry.isSoon ? "bond-term-soon" : "";
  return `
    <tr class="${rowClass}">
      <td>${escapeHtml(entry.maturityDate || "—")}</td>
      <td class="${termClass}">${escapeHtml(formatDaysUntil(entry.daysUntil))}</td>
      <td>
        <div class="asset-cell">
          <strong>${escapeHtml(entry.symbol)}</strong>
          <small>${escapeHtml(entry.bondLabel)} · ${escapeHtml(entry.bondName)}</small>
        </div>
      </td>
      <td>${formatNumber(entry.qty)}</td>
      <td>
        <strong>${formatMoney(entry.totalValue, entry.currency)}</strong>
        <small class="muted">${formatMoney(entry.maturityValuePerUnit, entry.currency)}/szt.</small>
      </td>
      <td>${escapeHtml(entry.portfolioName)}</td>
    </tr>
  `;
}

function getHeldBondPositions() {
  const map = new Map();
  state.transactions.forEach((transaction) => {
    if (!transaction.bond || (transaction.type !== "buy")) return;
    const symbol = transaction.symbol || transaction.name || "";
    const currency = transaction.currency || "PLN";
    const key = `${transaction.portfolioId}|${symbol.toUpperCase()}|${currency}`;
    if (!map.has(key)) {
      map.set(key, { key, portfolioId: transaction.portfolioId, symbol, currency, name: transaction.name || symbol, bond: transaction.bond, qty: 0 });
    }
  });
  state.transactions.forEach((transaction) => {
    const symbol = transaction.symbol || transaction.name || "";
    const currency = transaction.currency || "PLN";
    const key = `${transaction.portfolioId}|${symbol.toUpperCase()}|${currency}`;
    const entry = map.get(key);
    if (!entry) return;
    if (transaction.type === "buy") entry.qty += Math.abs(transaction.quantity || 0);
    if (transaction.type === "sell") entry.qty -= Math.abs(transaction.quantity || 0);
  });
  return Array.from(map.values()).filter((entry) => entry.qty > 0.0000001);
}

function renderRedemptionForm() {
  if (!dom.redemptionForm) return;
  const select = dom.redemptionForm.elements.bondKey;
  const held = getHeldBondPositions();
  if (!held.length) {
    select.innerHTML = `<option value="">Brak obligacji do wykupu</option>`;
    if (dom.redemptionHint) dom.redemptionHint.textContent = "Najpierw dodaj obligacje przyciskiem „+ Obligacja”.";
    return;
  }
  const portfolioName = (id) => state.portfolios.find((portfolio) => portfolio.id === id)?.name || "Portfel";
  const previous = select.value;
  select.innerHTML = held
    .map((entry) => `<option value="${escapeAttr(entry.key)}">${escapeHtml(entry.symbol)} — ${formatNumber(entry.qty)} szt. (${escapeHtml(portfolioName(entry.portfolioId))})</option>`)
    .join("");
  if (held.some((entry) => entry.key === previous)) select.value = previous;
  dom.redemptionForm.elements.date.value ||= toDateInput(new Date());
  applyRedemptionDefaults();
}

// Podpowiada ilość (cały stan), szacowaną kwotę wykupu (nominał + odsetki) i opłatę wg typu.
function applyRedemptionDefaults() {
  if (!dom.redemptionForm) return;
  const els = dom.redemptionForm.elements;
  const held = getHeldBondPositions();
  const entry = held.find((item) => item.key === els.bondKey.value) || held[0];
  if (!entry) return;
  const estimatedPrice = bondCurrentPrice(entry.bond);
  els.quantity.value = roundInput(entry.qty);
  els.quantity.max = entry.qty;
  els.price.value = (Math.round(estimatedPrice * 100) / 100).toFixed(2);
  updateRedemptionFee();
  const preset = BOND_PRESETS[entry.bond.code];
  if (dom.redemptionHint) {
    const feeLabel = preset ? formatMoney(preset.earlyRedemptionFee, "PLN") : "—";
    dom.redemptionHint.textContent = `Szacowana kwota wykupu ${formatMoney(estimatedPrice, entry.currency)}/szt. (nominał + narosłe odsetki) • opłata za przedterminowy wykup ${feeLabel}/szt. Wpisz realne wartości z banku, jeśli się różnią. Środki wracają na konto bankowe (nie zostają jako gotówka).`;
  }
}

function updateRedemptionFee() {
  if (!dom.redemptionForm) return;
  const els = dom.redemptionForm.elements;
  const entry = getHeldBondPositions().find((item) => item.key === els.bondKey.value);
  if (!entry) return;
  const preset = BOND_PRESETS[entry.bond.code];
  const quantity = Math.abs(parseNumber(els.quantity.value)) || 0;
  els.fee.value = roundInput((preset?.earlyRedemptionFee || 0) * quantity);
}

function addRedemption(event) {
  event.preventDefault();
  const els = dom.redemptionForm.elements;
  const entry = getHeldBondPositions().find((item) => item.key === els.bondKey.value);
  if (!entry) {
    window.alert(t("bond.noBondsRedeem"));
    return;
  }
  const quantity = Math.abs(parseNumber(els.quantity.value));
  if (!quantity) {
    window.alert(t("bond.enterRedemptionQty"));
    return;
  }
  if (quantity > entry.qty + 0.0000001) {
    window.alert(t("bond.insufficientQty", { qty: formatNumber(entry.qty) }));
    return;
  }
  const price = parseNumber(els.price.value) || bondCurrentPrice(entry.bond);
  const fee = Math.abs(parseNumber(els.fee.value));
  const transaction = {
    id: createId("redeem"),
    portfolioId: entry.portfolioId,
    date: els.date.value || toDateInput(new Date()),
    type: "sell",
    symbol: entry.symbol,
    name: entry.name,
    assetType: "bond",
    quantity,
    price,
    gross: quantity * price,
    fee,
    currency: entry.currency,
    bond: entry.bond,
    source: "bond-redemption",
    notes: "Przedterminowy wykup",
  };
  state.transactions.push(transaction);
  saveState();
  dom.redemptionForm.reset();
  render();
}

// Wypełnia formularz obligacji właściwościami wybranego typu. keepRates=true zachowuje
// ręcznie wpisane oprocentowanie/marżę (np. przy zmianie samej daty zakupu).
function applyBondPreset({ keepRates = false } = {}) {
  if (!dom.bondForm) return;
  const els = dom.bondForm.elements;
  const code = String(els.bondType.value || "").toUpperCase();
  const preset = BOND_PRESETS[code];
  if (!preset) return;
  if (!keepRates || !els.firstYearRate.value) els.firstYearRate.value = preset.firstYearRate;
  if (!keepRates || !els.margin.value) els.margin.value = preset.margin;
  const purchase = els.date.value || toDateInput(new Date());
  els.maturity.value = addMonthsToDate(purchase, preset.termMonths);
  if (dom.bondHint) dom.bondHint.textContent = bondHintText(preset);
}

function bondHintText(preset) {
  const indexationLabel = { fixed: "stałe", nbp: "zmienne wg stopy NBP", cpi: "indeksowane inflacją (CPI)" }[preset.indexation] || preset.indexation;
  const capitalizationLabel = preset.capitalization ? "kapitalizacja roczna" : "odsetki wypłacane okresowo";
  const marginLabel = preset.margin ? ` + marża ${formatNumber(preset.margin)}%` : "";
  return `Nominał ${BOND_NOMINAL} zł/szt. • okres ${preset.termMonths} mies. • ${indexationLabel}${marginLabel} • ${capitalizationLabel}. Oprocentowanie I roku i marżę możesz nadpisać; data wykupu liczy się automatycznie z okresu (też edytowalna).`;
}

function renderSummary() {
  const scope = calculateScope();
  const scopeMeta = getScopeMeta();
  const title = scopeMeta.name;
  const baseCurrency = scopeMeta.baseCurrency;
  const total = scope.totalValueBase;
  const profitClass = scope.totalProfitBase >= 0 ? "positive" : "negative";

  dom.scopeLabel.textContent = scopeMeta.label;
  dom.scopeTitle.textContent = title;
  dom.metricValue.textContent = formatMoney(total, baseCurrency);
  dom.metricCashMode.textContent = formatCashBreakdown(scope, baseCurrency);
  dom.metricProfit.textContent = formatMoney(scope.totalProfitBase, baseCurrency);
  dom.metricProfit.className = profitClass;
  dom.metricProfitPct.textContent = t("metric.returnPct", { pct: formatPercent(scope.returnPct) });
  dom.metricProfitPct.className = profitClass;
  dom.metricInvested.textContent = formatMoney(scope.netInvestedBase, baseCurrency);
  dom.metricTxCount.textContent = t("metric.txCount", { count: scope.transactions.length });
  dom.metricAssets.textContent = String(scope.openPositions.length);
  dom.metricCurrencies.textContent = scope.currencies.join(", ") || baseCurrency;

  renderCharts(scope, baseCurrency);
  renderPortfolioComparison(baseCurrency);
}

function renderQuoteStatus(message = "", tone = "") {
  if (!dom.quoteStatus) return;
  dom.quoteStatus.className = `quote-status ${tone}`.trim();
  if (message) {
    dom.quoteStatus.textContent = message;
    return;
  }
  if (state.lastQuoteUpdate || state.lastHistoryUpdate) {
    const parts = [];
    if (state.lastQuoteUpdate) parts.push(`ceny: ${formatDateTime(state.lastQuoteUpdate)}`);
    if (state.lastHistoryUpdate) parts.push(`historia dzienna: ${formatDateTime(state.lastHistoryUpdate)}`);
    dom.quoteStatus.textContent = `Ostatnia aktualizacja: ${parts.join(" • ")}`;
  } else {
    dom.quoteStatus.textContent = t("quotes.manual");
  }
}

function renderHistoryBenchmarkSelect() {
  if (!dom.historyBenchmark) return;
  dom.historyBenchmark.innerHTML = getBenchmarkOptions()
    .map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}</option>`)
    .join("");
  dom.historyBenchmark.value = state.selectedBenchmark || "";
}

function renderHistoryMarkerToggle() {
  if (!dom.historyMarkers) return;
  dom.historyMarkers.checked = state.showHistoryMarkers !== false;
}

function getBenchmarkConfig(benchmarkId) {
  return getBenchmarkOptions().find((option) => option.id === benchmarkId && option.id) || null;
}

function blendCompositePrices(priceMaps) {
  const allDates = new Set();
  priceMaps.forEach((map) => Object.keys(map || {}).forEach((date) => allDates.add(date)));
  const dates = Array.from(allDates).sort();
  if (!dates.length || !priceMaps.length) return {};

  const normalizedSeries = priceMaps.map((map) => {
    let startPrice = 0;
    const normalized = {};
    dates.forEach((date) => {
      const price = valueAtOrBefore(map, date);
      if (!startPrice && price > 0) startPrice = price;
      if (startPrice > 0 && price > 0) normalized[date] = price / startPrice;
    });
    return normalized;
  });

  const blended = {};
  dates.forEach((date) => {
    const values = normalizedSeries.map((series) => series[date]).filter((value) => Number.isFinite(value) && value > 0);
    if (values.length === priceMaps.length) {
      blended[date] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  });
  return blended;
}

function pruneBrokenBenchmarkHistory() {
  Object.keys(state.benchmarkHistory || {}).forEach((key) => {
    const entry = state.benchmarkHistory[key];
    const hasPrices = Object.values(entry?.prices || {}).some((value) => Number(value) > 0);
    if (!hasPrices) delete state.benchmarkHistory[key];
  });
}

function benchmarkComponentKey(benchmarkId, symbol) {
  return `${benchmarkId}:${symbol}`;
}

function benchmarkPriceInBase(benchmarkId, date, baseCurrency) {
  const entry = state.benchmarkHistory?.[benchmarkId];
  if (!entry || !date) return 0;
  const raw = valueAtOrBefore(entry.prices, date);
  if (!raw) return 0;
  if (entry.composite) return raw;
  return convertAt(raw * (Number(entry.priceFactor) || 1), entry.currency || "PLN", baseCurrency, date);
}

function benchmarkCoversRange(benchmarkId, from, to, baseCurrency = "PLN") {
  if (!from || !to) return false;
  return benchmarkPriceInBase(benchmarkId, from, baseCurrency) > 0 && benchmarkPriceInBase(benchmarkId, to, baseCurrency) > 0;
}

// Symuluje portfel benchmarku: każda zmiana wkładu (wpłata/wypłata) kupuje lub sprzedaje
// udział indeksu po cenie z tego dnia, tak jak kapitał napływa do realnego portfela.
function attachBenchmarkSeries(historyRows, benchmark, baseCurrency) {
  if (!historyRows.length || !benchmark) return historyRows.map((row) => ({ ...row, benchmark: null }));

  let benchmarkUnits = 0;
  let previousInvested = 0;

  return historyRows.map((row) => {
    const price = benchmarkPriceInBase(benchmark.id, row.date, baseCurrency);
    const invested = Number(row.invested) || 0;
    const investedDelta = invested - previousInvested;

    if (Math.abs(investedDelta) > 0.005) {
      if (price > 0) {
        benchmarkUnits += investedDelta / price;
        if (benchmarkUnits < 0) benchmarkUnits = 0;
      }
      previousInvested = invested;
    }

    return {
      ...row,
      benchmark: price > 0 && benchmarkUnits > 0 ? benchmarkUnits * price : null,
    };
  });
}

async function fetchBenchmarkComponentHistory(componentKey, config, symbol, from, to) {
  const response = await fetch(HISTORY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruments: [{ symbol, name: config.label, positionCurrency: config.currency }],
      from,
      to,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Nie udało się pobrać benchmarku.");
  const history = (data.histories || []).find((item) => item.symbol === symbol || item.requestedSymbol === symbol) || data.histories?.[0];
  const prices = rowsToValueMap(history?.prices || [], "close");
  if (!Object.keys(prices).length) return false;
  const normalized = normalizeQuotedPrice(1, history?.currency || config.currency);
  const existing = state.benchmarkHistory[componentKey]?.prices || {};
  state.benchmarkHistory[componentKey] = {
    id: componentKey,
    symbol: history?.symbol || symbol,
    label: config.label,
    currency: normalized.currency,
    priceFactor: normalized.price,
    from: data.from,
    to: data.to,
    fetchedAt: data.fetchedAt || new Date().toISOString(),
    prices: { ...existing, ...prices },
  };
  return true;
}

async function ensureBenchmarkHistory(benchmarkId, historyRows) {
  const config = getBenchmarkConfig(benchmarkId);
  if (!config || !historyRows.length) return false;
  if (window.location.protocol === "file:") return false;
  pruneBrokenBenchmarkHistory();
  const from = earliestTransactionDate(calculateScope().transactions) || historyRows[0].date;
  const to = toDateInput(new Date());
  const baseCurrency = getScopeMeta().baseCurrency;
  if (benchmarkCoversRange(benchmarkId, historyRows[0].date, historyRows[historyRows.length - 1].date, baseCurrency)) {
    return true;
  }
  try {
    if (config.composite?.length) {
      const componentMaps = [];
      for (const symbol of config.composite) {
        const componentKey = benchmarkComponentKey(benchmarkId, symbol);
        const existing = state.benchmarkHistory[componentKey];
        const needsFetch =
          !existing?.prices ||
          !valueAtOrBefore(existing.prices, from) ||
          !valueAtOrBefore(existing.prices, to);
        if (needsFetch) {
          const ok = await fetchBenchmarkComponentHistory(componentKey, config, symbol, from, to);
          if (!ok) return false;
        }
        componentMaps.push(state.benchmarkHistory[componentKey]?.prices || {});
      }
      const blended = blendCompositePrices(componentMaps);
      if (!Object.keys(blended).length) return false;
      state.benchmarkHistory[benchmarkId] = {
        id: benchmarkId,
        label: config.label,
        currency: config.currency,
        composite: true,
        from,
        to,
        fetchedAt: new Date().toISOString(),
        prices: blended,
      };
      saveState();
      return true;
    }

    const ok = await fetchBenchmarkComponentHistory(benchmarkId, config, config.symbol, from, to);
    if (!ok) return false;
    saveState();
    return true;
  } catch {
    return false;
  }
}

function scheduleBenchmarkFetch(force = false) {
  const scope = calculateScope();
  const baseCurrency = getScopeMeta().baseCurrency;
  const baseHistory = filterHistory(scope.timeline, dom.historyMode.value);
  if (!state.selectedBenchmark || !baseHistory.length || window.location.protocol === "file:") return;
  const rangeKey = `${state.selectedBenchmark}|${baseHistory[0].date}|${baseHistory[baseHistory.length - 1].date}`;
  if (benchmarkCoversRange(state.selectedBenchmark, baseHistory[0].date, baseHistory[baseHistory.length - 1].date, baseCurrency)) {
    renderSummary();
    return;
  }
  if (!force && benchmarkFetchState.key === rangeKey && (benchmarkFetchState.failed || benchmarkFetchInFlight)) {
    return;
  }
  benchmarkFetchState.key = rangeKey;
  benchmarkFetchInFlight = true;
  const token = ++benchmarkFetchToken;
  const requestedBenchmark = state.selectedBenchmark;
  ensureBenchmarkHistory(requestedBenchmark, baseHistory)
    .then((updated) => {
      benchmarkFetchState.failed = !updated;
      if (token !== benchmarkFetchToken || state.selectedBenchmark !== requestedBenchmark) return;
      renderSummary();
    })
    .finally(() => {
      benchmarkFetchInFlight = false;
    });
}

function renderCharts(scope, baseCurrency) {
  hideChartTooltip();
  pruneBrokenBenchmarkHistory();
  const history = scope.timeline;
  const mode = dom.historyMode.value;
  const baseHistory = filterHistory(history, mode);
  const filteredHistory = filterHistoryByZoom(baseHistory);
  const benchmark = getBenchmarkConfig(state.selectedBenchmark);
  const chartRows = benchmark ? attachBenchmarkSeries(filteredHistory, benchmark, baseCurrency) : filteredHistory;
  const hasBenchmarkSeries = chartRows.some((row) => Number.isFinite(row.benchmark) && row.benchmark > 0);
  const historyMarkers = buildHistoryMarkers(scope.transactions, filteredHistory, state.showHistoryMarkers !== false);
  if (benchmark && !hasBenchmarkSeries && filteredHistory.length && window.location.protocol !== "file:") {
    scheduleBenchmarkFetch();
  }
  renderHistoryWarning(scope, baseCurrency);
  const typeItems = Object.entries(scope.allocationByType).map(([key, value]) => ({
    label: assetTypeLabel(key),
    value,
    color: TYPE_COLORS[key] || TYPE_COLORS.other,
  }));
  const currencyItems = Object.entries(scope.allocationByCurrency).map(([currency, value]) => ({
    label: currency,
    value,
    color: currencyColor(currency),
  }));
  const profitItems = scope.profitPositions
    .slice()
    .sort((a, b) => Math.abs(b.totalProfitBase) - Math.abs(a.totalProfitBase))
    .slice(0, 8)
    .map((position) => ({
      label: position.symbol,
      value: position.totalProfitBase,
    }));

  chartRuntime.history = {
    baseRows: baseHistory,
    visibleRows: chartRows,
    markers: historyMarkers,
    plot: null,
    currency: baseCurrency,
    hoverIndex: null,
    hoverMarkerIndex: null,
    options: {
      primaryKey: "value",
      secondaryKey: "invested",
      primaryLabel: t("chart.portfolioValue"),
      secondaryLabel: t("chart.ownContribution"),
      tertiaryKey: hasBenchmarkSeries ? "benchmark" : "",
      tertiaryLabel: hasBenchmarkSeries ? `${benchmark.label} (wg wpłat)` : "",
      tertiaryColor: benchmark?.color || "#22577a",
    },
  };
  chartRuntime.type = { items: typeItems, currency: baseCurrency, hoverIndex: null, plot: null };
  chartRuntime.currency = { items: currencyItems, currency: baseCurrency, hoverIndex: null, plot: null };
  chartRuntime.profit = { items: profitItems, currency: baseCurrency, hoverIndex: null, plot: null };

  if (isCanvasDrawable(dom.historyChart)) {
    chartRuntime.history.plot = drawLineChart(dom.historyChart, chartRows, {
      ...chartRuntime.history.options,
      currency: baseCurrency,
      hoverIndex: chartRuntime.history.hoverIndex,
      hoverMarkerIndex: chartRuntime.history.hoverMarkerIndex,
      showMarkers: state.showHistoryMarkers !== false,
      markers: historyMarkers,
    });
    renderHistoryRangeLabel(filteredHistory);
    const legendItems = [
      { label: t("chart.portfolioValue"), color: "#176b4d" },
      { label: t("chart.ownContribution"), color: "#a56b13" },
    ];
    if (hasBenchmarkSeries) {
      legendItems.push({ label: `${benchmark.label} (wg wpłat)`, color: benchmark.color, dashed: true });
    }
    renderSeriesLegend(
      dom.historyLegend,
      legendItems,
      state.showHistoryMarkers !== false ? historyMarkers.length : 0,
      chartRuntime.history.plot?.markerFiltered,
    );
  }

  if (isCanvasDrawable(dom.typeChart)) {
    chartRuntime.type.plot = drawDoughnutChart(dom.typeChart, typeItems, baseCurrency, {
      hoverIndex: chartRuntime.type.hoverIndex,
    });
    renderDoughnutTotal(dom.typeTotal, typeItems, baseCurrency);
    renderChartLegend(dom.typeLegend, typeItems, baseCurrency);
  }

  if (isCanvasDrawable(dom.profitChart)) {
    chartRuntime.profit.plot = drawBarChart(dom.profitChart, profitItems, baseCurrency, {
      hoverIndex: chartRuntime.profit.hoverIndex,
    });
  }

  if (isCanvasDrawable(dom.currencyChart)) {
    chartRuntime.currency.plot = drawDoughnutChart(dom.currencyChart, currencyItems, baseCurrency, {
      hoverIndex: chartRuntime.currency.hoverIndex,
    });
    renderDoughnutTotal(dom.currencyTotal, currencyItems, baseCurrency);
    renderChartLegend(dom.currencyLegend, currencyItems, baseCurrency);
  }
}

function renderSeriesLegend(container, items, markerCount = 0, markerFiltered = false) {
  if (!container) return;
  const seriesHtml = items
    .map((item) => `
      <span class="chart-series-item">
        <span class="chart-series-swatch ${item.dashed ? "dashed" : ""}" style="--series-color:${escapeAttr(item.color)}"></span>
        ${escapeHtml(item.label)}
      </span>
    `)
    .join("");
  const filterHint = markerFiltered
    ? `<span class="chart-marker-filter-hint">Przy dużej liczbie: wpłaty, wypłaty, kupna i sprzedaże</span>`
    : "";
  const markerHtml =
    markerCount > 0
      ? `<span class="chart-marker-legend">
          <span class="chart-marker-legend-label">Operacje (${markerCount})</span>
          ${renderOperationMarkerLegendItems()}
          ${filterHint}
        </span>`
      : "";
  container.innerHTML = `${seriesHtml}${markerHtml}`;
}

function renderOperationMarkerLegendItems() {
  const items = [
    { type: "deposit", label: t("tx.deposit") },
    { type: "withdrawal", label: t("tx.withdrawal") },
    { type: "buy", label: t("tx.buy") },
    { type: "sell", label: t("tx.sell") },
  ];
  return items
    .map(
      (item) => `
        <span class="chart-marker-legend-item">
          <span class="chart-marker-shape chart-marker-shape-${escapeAttr(item.type)}" style="--marker-color:${escapeAttr(OPERATION_MARKER_COLORS[item.type])}"></span>
          ${escapeHtml(item.label)}
        </span>
      `,
    )
    .join("");
}

function renderDoughnutTotal(container, items, currency) {
  if (!container) return;
  const total = items.filter((item) => item.value > 0).reduce((sum, item) => sum + item.value, 0);
  container.textContent = total > 0 ? compactMoney(total, currency) : "";
}

function renderHistoryRangeLabel(rows) {
  if (!dom.historyRangeLabel) return;
  if (!rows.length) {
    dom.historyRangeLabel.textContent = "";
    return;
  }
  dom.historyRangeLabel.textContent = `${rows[0].date} – ${rows[rows.length - 1].date}`;
}

function filterHistoryByZoom(rows) {
  if (!historyZoom || rows.length < 2) return rows;
  const filtered = rows.filter((row) => {
    const time = dateMs(row.date);
    return time >= historyZoom.startMs && time <= historyZoom.endMs;
  });
  return filtered.length >= 2 ? filtered : rows;
}

function zoomHistory(factor, anchorRatio = 0.5) {
  const runtime = chartRuntime.history;
  const baseRange = historyRowsRange(runtime?.baseRows || []);
  if (!baseRange) return;
  const currentRange = currentHistoryRange(baseRange);
  const currentSpan = currentRange.endMs - currentRange.startMs;
  const nextSpan = currentSpan * factor;
  const anchor = currentRange.startMs + currentSpan * anchorRatio;
  const nextStart = anchor - nextSpan * anchorRatio;
  const nextEnd = nextStart + nextSpan;
  setHistoryZoomRange(nextStart, nextEnd, baseRange);
}

function setHistoryZoomRange(startMs, endMs, baseRange = historyRowsRange(chartRuntime.history?.baseRows || [])) {
  if (!baseRange) return;
  const baseSpan = baseRange.endMs - baseRange.startMs;
  const minSpan = Math.min(baseSpan, 7 * 24 * 60 * 60 * 1000);
  let nextStart = startMs;
  let nextEnd = endMs;
  if (nextEnd - nextStart < minSpan) {
    const center = (nextStart + nextEnd) / 2;
    nextStart = center - minSpan / 2;
    nextEnd = center + minSpan / 2;
  }
  if (nextEnd - nextStart >= baseSpan * 0.995) {
    historyZoom = null;
    render();
    return;
  }
  if (nextStart < baseRange.startMs) {
    nextEnd += baseRange.startMs - nextStart;
    nextStart = baseRange.startMs;
  }
  if (nextEnd > baseRange.endMs) {
    nextStart -= nextEnd - baseRange.endMs;
    nextEnd = baseRange.endMs;
  }
  nextStart = Math.max(baseRange.startMs, nextStart);
  nextEnd = Math.min(baseRange.endMs, nextEnd);
  historyZoom = { startMs: nextStart, endMs: nextEnd };
  render();
}

function currentHistoryRange(baseRange) {
  if (!historyZoom) return baseRange;
  return {
    startMs: Math.max(baseRange.startMs, historyZoom.startMs),
    endMs: Math.min(baseRange.endMs, historyZoom.endMs),
  };
}

function historyRowsRange(rows) {
  const times = rows.map((row) => dateMs(row.date)).filter((time) => Number.isFinite(time));
  if (times.length < 2) return null;
  return { startMs: Math.min(...times), endMs: Math.max(...times) };
}

function handleHistoryWheel(event) {
  const runtime = chartRuntime.history;
  const plot = runtime?.plot;
  if (!plot || !(runtime.baseRows || []).length) return;
  const baseRange = historyRowsRange(runtime.baseRows || []);
  if (!baseRange) return;
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  const isZoomGesture = event.ctrlKey || event.metaKey || event.altKey;
  if (isZoomGesture) {
    event.preventDefault();
    const rect = dom.historyChart.getBoundingClientRect();
    const rawRatio = (event.clientX - rect.left - plot.padding.left) / plot.plotWidth;
    const anchorRatio = clamp(rawRatio, 0, 1);
    const strength = clamp(absY / 320, 0.08, 0.45);
    zoomHistory(event.deltaY > 0 ? 1 + strength : 1 - strength, anchorRatio);
    return;
  }
  const panDelta = absX > absY ? event.deltaX : event.shiftKey ? event.deltaY : 0;
  if (!panDelta) return;
  event.preventDefault();
  const range = currentHistoryRange(baseRange);
  const span = range.endMs - range.startMs;
  const shift = (panDelta / plot.plotWidth) * span;
  setHistoryZoomRange(range.startMs + shift, range.endMs + shift, baseRange);
}

function handleHistoryPointerDown(event) {
  if (event.pointerType === "touch" || event.button > 0) return;
  const baseRange = historyRowsRange(chartRuntime.history?.baseRows || []);
  const plot = chartRuntime.history?.plot;
  if (!baseRange || !plot) return;
  clearChartHover("history");
  historyDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    range: currentHistoryRange(baseRange),
  };
  dom.historyChart.classList.add("is-panning");
  dom.historyChart.setPointerCapture?.(event.pointerId);
}

function handleHistoryPointerMove(event) {
  if (!historyDrag || historyDrag.pointerId !== event.pointerId) return;
  const baseRange = historyRowsRange(chartRuntime.history?.baseRows || []);
  const plot = chartRuntime.history?.plot;
  if (!baseRange || !plot) return;
  const span = historyDrag.range.endMs - historyDrag.range.startMs;
  const shift = -((event.clientX - historyDrag.startX) / plot.plotWidth) * span;
  setHistoryZoomRange(historyDrag.range.startMs + shift, historyDrag.range.endMs + shift, baseRange);
}

function handleHistoryPointerEnd(event) {
  if (historyDrag?.pointerId === event.pointerId) {
    historyDrag = null;
    dom.historyChart.classList.remove("is-panning");
  }
}

function ensureChartTooltip() {
  if (chartTooltipEl) return chartTooltipEl;
  chartTooltipEl = document.createElement("div");
  chartTooltipEl.id = "chartTooltip";
  chartTooltipEl.className = "chart-tooltip hidden";
  chartTooltipEl.setAttribute("role", "tooltip");
  document.body.appendChild(chartTooltipEl);
  return chartTooltipEl;
}

function showChartTooltip(clientX, clientY, html) {
  const tooltip = ensureChartTooltip();
  tooltip.innerHTML = html;
  tooltip.classList.remove("hidden");
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  const rect = tooltip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY + 14;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - 14;
  if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - 14;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideChartTooltip() {
  if (!chartTooltipEl) return;
  chartTooltipEl.classList.add("hidden");
}

function chartTooltipRow(label, value, color = "") {
  const swatch = color ? `<span class="chart-tooltip-swatch" style="background:${escapeAttr(color)}"></span>` : "";
  return `<div class="chart-tooltip-row">${swatch}<span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function clearChartHover(chartKey) {
  const runtime = chartRuntime[chartKey];
  if (!runtime) {
    hideChartTooltip();
    return;
  }
  if (chartKey === "history") {
    if (runtime.hoverIndex == null && runtime.hoverMarkerIndex == null) {
      hideChartTooltip();
      return;
    }
    runtime.hoverIndex = null;
    runtime.hoverMarkerIndex = null;
    refreshChartHover(chartKey);
    hideChartTooltip();
    return;
  }
  if (runtime.hoverIndex == null) {
    hideChartTooltip();
    return;
  }
  runtime.hoverIndex = null;
  refreshChartHover(chartKey);
  hideChartTooltip();
}

function refreshChartHover(chartKey) {
  const runtime = chartRuntime[chartKey];
  if (!runtime) return;
  if (chartKey === "history" && isCanvasDrawable(dom.historyChart)) {
    runtime.plot = drawLineChart(dom.historyChart, runtime.visibleRows || [], {
      ...runtime.options,
      currency: runtime.currency,
      hoverIndex: runtime.hoverIndex,
      hoverMarkerIndex: runtime.hoverMarkerIndex,
      showMarkers: state.showHistoryMarkers !== false,
      markers: runtime.markers || [],
    });
    return;
  }
  if (chartKey === "type" && isCanvasDrawable(dom.typeChart)) {
    runtime.plot = drawDoughnutChart(dom.typeChart, runtime.items || [], runtime.currency, {
      hoverIndex: runtime.hoverIndex,
    });
    return;
  }
  if (chartKey === "currency" && isCanvasDrawable(dom.currencyChart)) {
    runtime.plot = drawDoughnutChart(dom.currencyChart, runtime.items || [], runtime.currency, {
      hoverIndex: runtime.hoverIndex,
    });
    return;
  }
  if (chartKey === "profit" && isCanvasDrawable(dom.profitChart)) {
    runtime.plot = drawBarChart(dom.profitChart, runtime.items || [], runtime.currency, {
      hoverIndex: runtime.hoverIndex,
    });
  }
}

function historyIndexAtX(plot, localX) {
  const { padding, plotWidth, tMin, tMax, times } = plot;
  if (!times?.length || plotWidth <= 0) return -1;
  const ratio = clamp((localX - padding.left) / plotWidth, 0, 1);
  const targetTime = tMin + ratio * (tMax - tMin);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    if (time === null) return;
    const distance = Math.abs(time - targetTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function handleHistoryMouseMove(event) {
  if (historyDrag) return;
  const runtime = chartRuntime.history;
  const plot = runtime?.plot;
  const rows = runtime?.visibleRows;
  const markers = runtime?.markers;
  if (!plot || !rows?.length) {
    clearChartHover("history");
    return;
  }
  const rect = dom.historyChart.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const plotBottom = plot.padding.top + plot.plotHeight;
  const markerStripBottom = plotBottom + (plot.markerStripHeight || 0);
  const insideChart =
    localX >= plot.padding.left &&
    localX <= plot.padding.left + plot.plotWidth &&
    localY >= plot.padding.top &&
    localY <= markerStripBottom;
  if (!insideChart) {
    clearChartHover("history");
    return;
  }
  if (state.showHistoryMarkers !== false && markers?.length) {
    const markerIndex = historyMarkerAtPosition(plot, localX, localY);
    if (markerIndex >= 0) {
      const drawItem = plot.markerDrawItems?.[markerIndex];
      if (runtime.hoverMarkerIndex !== markerIndex || runtime.hoverIndex != null) {
        runtime.hoverMarkerIndex = markerIndex;
        runtime.hoverIndex = null;
        refreshChartHover("history");
      }
      if (drawItem) {
        showChartTooltip(event.clientX, event.clientY, formatHistoryMarkerTooltip(drawItem));
      }
      return;
    }
    if (runtime.hoverMarkerIndex != null) {
      runtime.hoverMarkerIndex = null;
      refreshChartHover("history");
    }
  }
  if (localY > plotBottom) {
    hideChartTooltip();
    return;
  }
  const index = historyIndexAtX(plot, localX);
  const row = rows[index];
  if (!row) {
    clearChartHover("history");
    return;
  }
  if (runtime.hoverIndex !== index) {
    runtime.hoverIndex = index;
    refreshChartHover("history");
  }
  const profit = row.value - row.invested;
  showChartTooltip(
    event.clientX,
    event.clientY,
    `
      <strong>${escapeHtml(formatAxisDate(dateMs(row.date)))}</strong>
      ${chartTooltipRow(runtime.options.primaryLabel, formatMoney(row.value, runtime.currency), "#176b4d")}
      ${chartTooltipRow(runtime.options.secondaryLabel, formatMoney(row.invested, runtime.currency), "#a56b13")}
      ${chartTooltipRow("Zysk", formatMoney(profit, runtime.currency), profit >= 0 ? "#176b4d" : "#af3636")}
      ${chartTooltipRow("Pozycje", formatMoney(row.positions, runtime.currency))}
      ${chartTooltipRow(t("chart.cash"), formatMoney(row.cash, runtime.currency))}
      ${
        runtime.options.tertiaryKey && Number.isFinite(row.benchmark) && row.benchmark > 0
          ? chartTooltipRow(runtime.options.tertiaryLabel, formatMoney(row.benchmark, runtime.currency), runtime.options.tertiaryColor)
          : ""
      }
    `,
  );
}

function doughnutSegmentAt(plot, localX, localY) {
  if (!plot?.segments?.length) return -1;
  const dx = localX - plot.centerX;
  const dy = localY - plot.centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < plot.innerRadius || distance > plot.radius + 8) return -1;
  let fraction = (Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2);
  if (fraction < 0) fraction += 1;
  if (fraction >= 1) fraction -= 1;
  const segment = plot.segments.find((item, segmentIndex) => {
    const isLast = segmentIndex === plot.segments.length - 1;
    return fraction >= item.startFraction && (isLast ? fraction <= item.endFraction : fraction < item.endFraction);
  });
  return segment ? segment.index : -1;
}

function handleDoughnutMouseMove(chartKey, canvas, event) {
  const runtime = chartRuntime[chartKey];
  const plot = runtime?.plot;
  const items = (runtime?.items || []).filter((item) => item.value > 0);
  if (!plot || !items.length) {
    clearChartHover(chartKey);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const index = doughnutSegmentAt(plot, event.clientX - rect.left, event.clientY - rect.top);
  if (index < 0) {
    clearChartHover(chartKey);
    return;
  }
  const item = items[index];
  if (!item) {
    clearChartHover(chartKey);
    return;
  }
  if (runtime.hoverIndex !== index) {
    runtime.hoverIndex = index;
    refreshChartHover(chartKey);
  }
  const total = items.reduce((sum, entry) => sum + entry.value, 0);
  const share = total > 0 ? (item.value / total) * 100 : 0;
  showChartTooltip(
    event.clientX,
    event.clientY,
    `
      <strong>${escapeHtml(item.label)}</strong>
      ${chartTooltipRow(t("chart.value"), formatMoney(item.value, runtime.currency), item.color)}
      ${chartTooltipRow(t("chart.share"), formatPercent(share))}
    `,
  );
}

function handleProfitMouseMove(event) {
  const runtime = chartRuntime.profit;
  const plot = runtime?.plot;
  const items = (runtime?.items || []).filter((item) => Math.abs(item.value) > 0.001);
  if (!plot || !items.length) {
    clearChartHover("profit");
    return;
  }
  const rect = dom.profitChart.getBoundingClientRect();
  const localY = event.clientY - rect.top;
  const rowHeight = plot.rowHeight;
  const index = Math.floor((localY - plot.padding.top) / rowHeight);
  if (index < 0 || index >= items.length) {
    clearChartHover("profit");
    return;
  }
  const item = items[index];
  if (!item) {
    clearChartHover("profit");
    return;
  }
  if (runtime.hoverIndex !== index) {
    runtime.hoverIndex = index;
    refreshChartHover("profit");
  }
  showChartTooltip(
    event.clientX,
    event.clientY,
    `
      <strong>${escapeHtml(item.label)}</strong>
      ${chartTooltipRow("Zysk", formatMoney(item.value, runtime.currency), item.value >= 0 ? "#176b4d" : "#af3636")}
    `,
  );
}

function renderChartLegend(container, items, currency) {
  if (!container) return;
  const filtered = items.filter((item) => item.value > 0);
  if (!filtered.length) {
    container.innerHTML = `<p class="muted">${escapeHtml(t("chart.noData"))}</p>`;
    return;
  }
  const total = filtered.reduce((sum, item) => sum + item.value, 0);
  container.innerHTML = filtered
    .sort((a, b) => b.value - a.value)
    .map((item) => {
      const share = total > 0 ? (item.value / total) * 100 : 0;
      return `
        <div class="chart-legend-item">
          <span class="chart-legend-swatch" style="background:${escapeAttr(item.color)}"></span>
          <span>
            <strong>${escapeHtml(item.label)}</strong>
            <small>${formatPercent(share)} · ${compactMoney(item.value, currency)}</small>
          </span>
        </div>
      `;
    })
    .join("");
}

function renderHistoryWarning(scope, baseCurrency) {
  if (!dom.historyWarning) return;
  const transferCount = scope.transactions.filter((transaction) => transaction.type === "transfer").length;
  const looksIncomplete = transferCount > 0 && scope.netInvestedBase > 0 && scope.totalValueBase < scope.netInvestedBase * 0.45;
  dom.historyWarning.classList.toggle("hidden", !looksIncomplete);
  if (looksIncomplete) {
    dom.historyWarning.textContent = `Wykres wygląda jak niepełny import rachunków walutowych: są transfery XTB, a wartość portfela jest dużo niższa od kapitału netto. Zaimportuj cały ZIP XTB ze wszystkimi rachunkami PLN/EUR/USD i wyczyść wcześniejsze dane przed powtórnym testem.`;
  }
}

function portfoliosForComparison() {
  const scopeId = state.selectedPortfolioId;
  if (scopeId === "all") {
    const items = [];
    const groupedIds = new Set();
    (state.portfolioGroups || []).forEach((group) => {
      const members = portfoliosInGroup(group.id);
      if (!members.length) return;
      members.forEach((portfolio) => groupedIds.add(portfolio.id));
      items.push({ type: "group", group, members });
    });
    state.portfolios
      .filter((portfolio) => !groupedIds.has(portfolio.id))
      .forEach((portfolio) => items.push({ type: "portfolio", portfolio }));
    return items;
  }
  if (isGroupScopeId(scopeId)) {
    const group = getPortfolioGroup(getGroupIdFromScope(scopeId));
    const members = portfoliosInGroup(group?.id);
    return group ? [{ type: "group", group, members }] : [];
  }
  const portfolio = state.portfolios.find((item) => item.id === scopeId);
  return portfolio ? [{ type: "portfolio", portfolio }] : [];
}

function renderPortfolioComparison(baseCurrency) {
  if (!state.portfolios.length) {
    dom.portfolioComparison.innerHTML = `<p class="muted">${escapeHtml(t("portfolio.none"))}</p>`;
    return;
  }
  const items = portfoliosForComparison();
  const rows = [];
  items.forEach((item) => {
    if (item.type === "group") {
      const groupScope = calculateScope(groupScopeId(item.group.id));
      rows.push({
        portfolio: { name: item.group.name, color: item.group.color },
        value: convert(groupScope.totalValueBase, groupScope.baseCurrency, baseCurrency),
        profit: convert(groupScope.totalProfitBase, groupScope.baseCurrency, baseCurrency),
        isGroup: true,
      });
      item.members.forEach((portfolio) => {
        const scope = calculateScope(portfolio.id);
        rows.push({
          portfolio,
          value: convert(scope.totalValueBase, scope.baseCurrency, baseCurrency),
          profit: convert(scope.totalProfitBase, scope.baseCurrency, baseCurrency),
          nested: true,
        });
      });
      return;
    }
    const scope = calculateScope(item.portfolio.id);
    rows.push({
      portfolio: item.portfolio,
      value: convert(scope.totalValueBase, scope.baseCurrency, baseCurrency),
      profit: convert(scope.totalProfitBase, scope.baseCurrency, baseCurrency),
    });
  });
  const max = Math.max(1, ...rows.map((row) => row.value));
  dom.portfolioComparison.innerHTML = rows
    .map((row) => {
      const width = Math.max(4, (row.value / max) * 100);
      const profitClass = row.profit >= 0 ? "positive" : "negative";
      const nestedClass = row.nested ? "comparison-row-nested" : row.isGroup ? "comparison-row-group" : "";
      return `
        <div class="comparison-row ${nestedClass}">
          <div>
            <strong>${escapeHtml(row.portfolio.name)}</strong>
            <div class="progress"><span style="width:${width}%;background:${escapeAttr(row.portfolio.color)}"></span></div>
          </div>
          <div>
            <strong>${formatMoney(row.value, baseCurrency)}</strong>
            <small class="${profitClass}">${formatMoney(row.profit, baseCurrency)}</small>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderHoldings() {
  const scope = calculateScope();
  const search = normalize(dom.holdingSearch.value || "");
  const groupBy = dom.holdingGroup.value;
  const totalValue = Math.max(scope.totalValueBase, 0.01);
  let positions = scope.openPositions;
  if (search) {
    positions = positions.filter((position) => {
      return normalize(`${position.symbol} ${position.name} ${position.portfoliosLabel}`).includes(search);
    });
  }
  positions = positions.slice().sort((a, b) => {
    const groupA = groupValue(a, groupBy);
    const groupB = groupValue(b, groupBy);
    if (groupA !== groupB) return groupA.localeCompare(groupB, "pl");
    return b.currentValueBase - a.currentValueBase;
  });

  const holdingsColumnCount = 9 + RETURN_PERIODS.length;
  if (dom.holdingsReturnsHint) {
    dom.holdingsReturnsHint.textContent = holdingsReturnsHint(scope.openPositions);
  }

  if (!positions.length) {
    dom.holdingsTable.innerHTML = emptyRow(holdingsColumnCount);
    return;
  }

  dom.holdingsTable.innerHTML = positions
    .map((position) => {
      const profitClass = position.totalProfitBase >= 0 ? "positive" : "negative";
      const share = (position.currentValueBase / totalValue) * 100;
      const key = priceKey(position);
      const periodCells = RETURN_PERIODS.map((period) => {
        return `<td class="period-return">${formatPeriodReturn(positionPeriodReturn(position, period))}</td>`;
      }).join("");
      return `
        <tr>
          <td>
            <div class="asset-cell">
              <strong>${escapeHtml(position.symbol)}</strong>
              <small>${escapeHtml(position.name)}</small>
            </div>
          </td>
          <td>
            <select class="type-select" data-asset-key="${escapeAttr(position.assetKey)}">
              ${assetTypeOptions(position.assetType)}
            </select>
          </td>
          <td>${formatNumber(position.quantity)}</td>
          <td>${formatMoney(position.averagePrice, position.currency)}</td>
          <td>
            <div class="price-cell">
              <input class="price-input" data-price-key="${escapeAttr(key)}" type="number" step="0.0001" value="${roundInput(position.currentPrice)}" />
              <small>${escapeHtml(priceMetaLabel(key))}</small>
            </div>
          </td>
          <td>${formatMoney(position.currentValueBase, scope.baseCurrency)}</td>
          <td>${formatPercent(share)}</td>
          <td class="${profitClass}">${formatMoney(position.totalProfitBase, scope.baseCurrency)}<br><small>${formatPercent(position.returnPct)}</small></td>
          ${periodCells}
          <td>${escapeHtml(position.portfoliosLabel)}</td>
        </tr>
      `;
    })
    .join("");

  dom.holdingsTable.querySelectorAll("[data-price-key]").forEach((input) => {
    input.addEventListener("change", () => {
      const value = parseNumber(input.value);
      if (value > 0) {
        state.priceOverrides[input.dataset.priceKey] = value;
        state.priceMeta[input.dataset.priceKey] = {
          provider: "manual",
          fetchedAt: new Date().toISOString(),
          label: t("priceSource.manual"),
        };
      } else {
        delete state.priceOverrides[input.dataset.priceKey];
        delete state.priceMeta[input.dataset.priceKey];
      }
      saveState();
      render();
    });
  });

  dom.holdingsTable.querySelectorAll("[data-asset-key]").forEach((select) => {
    select.addEventListener("change", () => {
      state.assetTypes[select.dataset.assetKey] = select.value;
      saveState();
      render();
    });
  });
}

async function refreshLivePrices() {
  const scope = calculateScope();
  const instruments = scope.openPositions
    .filter((position) => position.symbol && position.quantity > 0 && !position.bond)
    .map((position) => ({
      symbol: position.symbol,
      name: position.name,
      positionCurrency: position.currency,
    }));
  const unique = Array.from(new Map(instruments.map((item) => [`${item.symbol}|${item.positionCurrency}`, item])).values());
  if (!unique.length) {
    renderQuoteStatus("Brak otwartych pozycji do aktualizacji.", "negative");
    return;
  }
  if (window.location.protocol === "file:") {
    renderQuoteStatus("Live ceny wymagają uruchomienia przez lokalny serwer: node server.js", "negative");
    return;
  }

  dom.refreshPricesButton.disabled = true;
  renderQuoteStatus(`Pobieram ceny dla ${unique.length} instrumentów...`);
  try {
    const response = await fetch(QUOTE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruments: unique }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nie udało się pobrać cen.");

    if (data.fx && typeof data.fx === "object") {
      Object.entries(data.fx).forEach(([currency, rate]) => {
        if (currency !== "PLN" && Number(rate) > 0) state.fxRates[currency] = Number(rate);
      });
      state.fxRates.PLN = 1;
    }

    let updated = 0;
    (data.quotes || []).forEach((quote) => {
      if (!quote || !Number.isFinite(Number(quote.price))) return;
      const positionCurrency = quote.positionCurrency || "PLN";
      const key = assetKeyFor(quote.requestedSymbol, positionCurrency);
      const normalizedQuote = normalizeQuotedPrice(Number(quote.price), quote.currency || positionCurrency);
      const convertedPrice = convert(normalizedQuote.price, normalizedQuote.currency, positionCurrency);
      if (!Number.isFinite(convertedPrice) || convertedPrice <= 0) return;
      state.priceOverrides[key] = convertedPrice;
      state.priceMeta[key] = {
        provider: quote.provider,
        quoteSymbol: quote.symbol,
        quoteCurrency: normalizedQuote.currency,
        quotePrice: normalizedQuote.price,
        positionCurrency,
        marketTime: quote.marketTime,
        fetchedAt: data.fetchedAt || new Date().toISOString(),
      };
      updated += 1;
    });

    state.lastQuoteUpdate = data.fetchedAt || new Date().toISOString();
    const historyResult = await refreshDailyHistory(unique, scope.transactions);
    if (state.selectedBenchmark) {
      benchmarkFetchState.failed = false;
      await ensureBenchmarkHistory(state.selectedBenchmark, filterHistory(scope.timeline, dom.historyMode.value));
    }
    saveState();
    render();
    const missing = Math.max(0, unique.length - updated);
    const suffix = missing ? `, ${missing} bez ceny` : "";
    const stale = staleQuoteCount(data.quotes || [], state.lastQuoteUpdate);
    const staleSuffix = stale ? `, ${stale} z poprzedniej sesji` : "";
    const historySuffix = historyResult.updated
      ? ` Historia dzienna: ${historyResult.updated} walorów, FX: ${historyResult.fxUpdated}.`
      : historyResult.message
        ? ` ${historyResult.message}`
        : "";
    renderQuoteStatus(`Zaktualizowano ${updated} cen${suffix}${staleSuffix}. Źródło: ${providerSummary(data.quotes || [])}.${historySuffix}`, updated || historyResult.updated ? "positive" : "negative");
  } catch (error) {
    renderQuoteStatus(error instanceof Error ? error.message : "Nie udało się pobrać cen.", "negative");
  } finally {
    dom.refreshPricesButton.disabled = false;
  }
}

async function refreshDailyHistory(instruments, transactions) {
  const from = earliestTransactionDate(transactions);
  const to = toDateInput(new Date());
  if (!from || from > to) return { updated: 0, fxUpdated: 0, message: "Brak zakresu historii." };
  renderQuoteStatus(`Pobieram dzienne notowania od ${from}...`);
  try {
    const response = await fetch(HISTORY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruments, from, to }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nie udało się pobrać historii.");
    return applyDailyHistory(data);
  } catch (error) {
    return {
      updated: 0,
      fxUpdated: 0,
      message: error instanceof Error ? `Historia dzienna: ${error.message}` : "Historia dzienna: błąd pobierania.",
    };
  }
}

function applyDailyHistory(data) {
  let updated = 0;
  (data.histories || []).forEach((history) => {
    const key = assetKeyFor(history.requestedSymbol, history.positionCurrency || history.currency || "PLN");
    const prices = rowsToValueMap(history.prices || [], "close");
    if (!Object.keys(prices).length) return;
    const normalizedQuote = normalizeQuotedPrice(1, history.currency || history.positionCurrency || "PLN");
    const existing = state.quoteHistory[key]?.prices || {};
    state.quoteHistory[key] = {
      provider: history.provider || "yahoo",
      symbol: history.symbol || history.requestedSymbol,
      currency: normalizedQuote.currency,
      priceFactor: normalizedQuote.price,
      positionCurrency: history.positionCurrency || "PLN",
      from: data.from,
      to: data.to,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      prices: { ...existing, ...prices },
    };
    updated += 1;
  });

  let fxUpdated = 0;
  Object.entries(data.fxHistory || {}).forEach(([currency, rows]) => {
    const normalizedCurrency = String(currency || "").toUpperCase();
    if (!normalizedCurrency) return;
    const rates = normalizedCurrency === "PLN" ? { [data.from || toDateInput(new Date())]: 1 } : rowsToValueMap(rows || [], "close");
    if (!Object.keys(rates).length) return;
    const existing = state.fxHistory[normalizedCurrency]?.rates || {};
    state.fxHistory[normalizedCurrency] = {
      provider: "yahoo",
      from: data.from,
      to: data.to,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      rates: { ...existing, ...rates },
    };
    fxUpdated += 1;
  });

  state.lastHistoryUpdate = data.fetchedAt || new Date().toISOString();
  return { updated, fxUpdated, message: "" };
}

function priceMetaLabel(key) {
  const meta = state.priceMeta?.[key];
  if (!meta) return "z importu";
  if (meta.provider === "manual") return t("priceSource.manual");
  const provider = providerLabel(meta.provider);
  const symbol = meta.quoteSymbol ? ` ${meta.quoteSymbol}` : "";
  const currency = meta.quoteCurrency && meta.quoteCurrency !== meta.positionCurrency ? ` ${meta.quoteCurrency}→${meta.positionCurrency}` : "";
  const time = shortMarketTime(meta.marketTime);
  return `${provider}${symbol}${currency}${time ? ` · ${time}` : ""}`.trim();
}

function providerSummary(quotes) {
  const providers = Array.from(new Set(quotes.map((quote) => providerLabel(quote.provider)).filter(Boolean)));
  return providers.join(", ") || "brak";
}

function providerLabel(provider) {
  return {
    yahoo: "Yahoo",
    stooq: "Stooq",
    manual: t("priceSource.manual"),
  }[provider] || provider || "";
}

function staleQuoteCount(quotes, fetchedAt) {
  const fetchedDate = String(fetchedAt || new Date().toISOString()).slice(0, 10);
  return quotes.filter((quote) => {
    const marketDate = marketDateFromValue(quote.marketTime);
    return marketDate && marketDate < fetchedDate;
  }).length;
}

function shortMarketTime(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const date = `${day}.${month}`;
  return hour && minute ? `${date} ${hour}:${minute}` : date;
}

function marketDateFromValue(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function renderTransactions() {
  const portfolioNames = new Map(state.portfolios.map((portfolio) => [portfolio.id, portfolio.name]));
  const search = normalize(dom.transactionSearch.value || "");
  let transactions = getScopedTransactions();
  if (search) {
    transactions = transactions.filter((transaction) => {
      return normalize(
        `${transaction.date} ${transaction.type} ${transaction.symbol} ${transaction.name} ${transaction.currency} ${portfolioNames.get(transaction.portfolioId) || ""}`,
      ).includes(search);
    });
  }
  transactions = transactions.slice().sort((a, b) => compareTransactions(b, a));

  if (!transactions.length) {
    dom.transactionsTable.innerHTML = emptyRow(9);
    return;
  }

  dom.transactionsTable.innerHTML = transactions
    .map((transaction) => {
      return `
        <tr>
          <td>${escapeHtml(transaction.date)}</td>
          <td>${escapeHtml(portfolioNames.get(transaction.portfolioId) || "Portfel")}</td>
          <td>${operationLabel(transaction.type)}</td>
          <td>${escapeHtml(transaction.symbol || transaction.name || "-")}</td>
          <td>${transaction.quantity ? formatNumber(transaction.quantity) : "-"}</td>
          <td>${transaction.price ? formatMoney(transaction.price, transaction.currency) : "-"}</td>
          <td>${formatMoney(transaction.gross, transaction.currency)}</td>
          <td>${transaction.fee ? formatMoney(transaction.fee, transaction.currency) : "-"}</td>
          <td>
            <div class="row-actions">
              <button class="text-button" data-delete-transaction="${escapeAttr(transaction.id)}" type="button">${escapeHtml(t("action.delete"))}</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  dom.transactionsTable.querySelectorAll("[data-delete-transaction]").forEach((button) => {
    button.addEventListener("click", () => {
      state.transactions = state.transactions.filter((transaction) => transaction.id !== button.dataset.deleteTransaction);
      saveState();
      render();
    });
  });
}

function renderTargets() {
  const scope = calculateScope();
  dom.targetsForm.innerHTML = getAssetTypeEntries()
    .map(([key, label]) => {
      const value = state.targets[key] ?? 0;
      return `
        <label class="target-row">
          <span class="pill ${key}">${escapeHtml(label)}</span>
          <input data-target-key="${escapeAttr(key)}" type="range" min="0" max="100" step="1" value="${value}" />
          <strong data-target-value="${escapeAttr(key)}">${value}%</strong>
        </label>
      `;
    })
    .join("");

  dom.targetsForm.querySelectorAll("[data-target-key]").forEach((input) => {
    input.addEventListener("input", () => {
      state.targets[input.dataset.targetKey] = Number(input.value);
      const valueLabel = dom.targetsForm.querySelector(`[data-target-value="${escapeAttr(input.dataset.targetKey)}"]`);
      if (valueLabel) valueLabel.textContent = `${input.value}%`;
      saveState();
      renderRebalance(scope);
    });
  });

  renderRebalance(scope);
}

function renderRebalance(scope = calculateScope()) {
  const total = Math.max(scope.totalValueBase, 0.01);
  const actual = scope.allocationByType;
  dom.rebalanceTable.innerHTML = getAssetTypeEntries()
    .map(([key, label]) => {
      const actualValue = actual[key] || 0;
      const actualPct = (actualValue / total) * 100;
      const targetPct = state.targets[key] || 0;
      const deltaPct = targetPct - actualPct;
      const deltaValue = (deltaPct / 100) * total;
      const action = Math.abs(deltaValue) < 1 ? "OK" : deltaValue > 0 ? t("rebalance.buyMore") : t("rebalance.reduce");
      const actionClass = Math.abs(deltaValue) < 1 ? "ok" : deltaValue > 0 ? "buy" : "reduce";
      return `
        <div class="rebalance-row">
          <span class="pill ${key}">${escapeHtml(label)}</span>
          <div>
            <div class="progress"><span style="width:${Math.min(100, actualPct)}%;background:${TYPE_COLORS[key]}"></span></div>
            <small>${escapeHtml(t("rebalance.nowTarget", { actual: formatPercent(actualPct), target: formatPercent(targetPct) }))}</small>
          </div>
          <strong class="rebalance-action ${actionClass}">${action} ${formatMoney(Math.abs(deltaValue), scope.baseCurrency)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderFx() {
  const currencies = Array.from(new Set(["PLN", "EUR", "USD", "GBP", "CHF", ...state.transactions.map((tx) => tx.currency)])).filter(Boolean);
  dom.fxForm.innerHTML = currencies
    .map((currency) => {
      const value = state.fxRates[currency] ?? 1;
      return `
        <label class="fx-row">
          <span class="pill">${escapeHtml(currency)}</span>
          <input data-fx-currency="${escapeAttr(currency)}" type="number" min="0" step="0.0001" value="${roundInput(value)}" ${currency === "PLN" ? "disabled" : ""} />
          <strong>PLN</strong>
        </label>
      `;
    })
    .join("");
  dom.fxForm.querySelectorAll("[data-fx-currency]").forEach((input) => {
    input.addEventListener("change", () => {
      const value = parseNumber(input.value);
      state.fxRates[input.dataset.fxCurrency] = value > 0 ? value : 1;
      state.fxRates.PLN = 1;
      saveState();
      render();
    });
  });
}

function renderImportPreview() {
  if (!importPreview.length) {
    dom.importPreview.innerHTML = emptyRow(6);
    dom.commitImportButton.disabled = true;
    return;
  }
  dom.importPreview.innerHTML = importPreview
    .slice(0, 50)
    .map((transaction) => {
      return `
        <tr>
          <td>${escapeHtml(transaction.date)}</td>
          <td>${operationLabel(transaction.type)}</td>
          <td>${escapeHtml(transaction.symbol || transaction.name || "-")}</td>
          <td>${transaction.quantity ? formatNumber(transaction.quantity) : "-"}</td>
          <td>${transaction.price ? formatMoney(transaction.price, transaction.currency) : "-"}</td>
          <td>${formatMoney(transaction.gross, transaction.currency)}</td>
        </tr>
      `;
    })
    .join("");
  dom.commitImportButton.disabled = false;
}

function calculateScope(scopeId = state.selectedPortfolioId) {
  const scopeMeta = getScopeMeta(scopeId);
  const baseCurrency = scopeMeta.baseCurrency;
  const transactions = getScopedTransactions(scopeId).slice().sort(compareTransactions);
  const hasCashOperations = transactions.some((tx) => ["deposit", "withdrawal", "transfer"].includes(tx.type));
  // Klucze pozycji obligacyjnych (z metadanych ręcznie dodanych obligacji). Pozwala rozpoznać
  // także sprzedaż/wykup obligacji, które same w sobie nie niosą metadanych.
  const bondKeys = new Set();
  transactions.forEach((tx) => {
    if (tx.bond && (tx.symbol || tx.name)) bondKeys.add(`${(tx.symbol || tx.name).toUpperCase()}|${tx.currency || "PLN"}`);
  });
  const isBondTransaction = (tx) => Boolean(tx.bond) || bondKeys.has(`${(tx.symbol || tx.name || "").toUpperCase()}|${tx.currency || "PLN"}`);
  const positions = new Map();
  const cash = new Map();
  const investedTracker = createInvestedTracker(hasCashOperations, isBondTransaction, baseCurrency);
  const timelineRows = [];

  transactions.forEach((transaction) => {
    applyTransaction(transaction, positions, cash);
    investedTracker.apply(transaction);
    const snapshot = summarizePositions(positions, cash, baseCurrency, hasCashOperations, transaction.date);
    timelineRows.push(createTimelineRow(transaction.date, snapshot, investedTracker.value()));
  });

  const summarized = summarizePositions(positions, cash, baseCurrency, hasCashOperations);
  // Punkt „dziś”: wartość rośnie w czasie (narosłe odsetki, bieżące ceny) także po ostatniej
  // operacji, więc domykamy linię wartości do dzisiejszej daty z aktualną wyceną.
  if (timelineRows.length) {
    const today = toDateInput(new Date());
    timelineRows.push(createTimelineRow(today, summarized, investedTracker.value()));
  }
  const openPositions = summarized.positions.filter((position) => Math.abs(position.quantity) > 0.0000001);
  const profitPositions = summarized.positions.filter((position) => {
    return Math.abs(position.quantity) > 0.0000001 || Math.abs(position.totalProfitBase) > 0.0001;
  });
  const totalProfitBase = profitPositions.reduce((sum, position) => sum + position.totalProfitBase, 0);
  const allocationByType = {};
  const allocationByCurrency = {};

  openPositions.forEach((position) => {
    allocationByType[position.assetType] = (allocationByType[position.assetType] || 0) + Math.max(0, position.currentValueBase);
    allocationByCurrency[position.currency] = (allocationByCurrency[position.currency] || 0) + Math.max(0, position.currentValueBase);
  });

  if (hasCashOperations) {
    summarized.cashRows.forEach((cashRow) => {
      if (cashRow.valueBase <= 0) return;
      allocationByType.cash = (allocationByType.cash || 0) + cashRow.valueBase;
      allocationByCurrency[cashRow.currency] = (allocationByCurrency[cashRow.currency] || 0) + cashRow.valueBase;
    });
  }

  const finalInvested = investedTracker.value();
  const returnPct = finalInvested > 0 ? (totalProfitBase / finalInvested) * 100 : 0;
  const currencies = Array.from(new Set([...openPositions.map((position) => position.currency), ...summarized.cashRows.map((row) => row.currency)])).filter(Boolean);
  const dailyTimeline = buildDailyTimeline(transactions, baseCurrency, hasCashOperations, isBondTransaction);

  return {
    baseCurrency,
    transactions,
    hasCashOperations,
    positions: summarized.positions,
    openPositions,
    profitPositions,
    cashRows: summarized.cashRows,
    totalValueBase: summarized.totalValueBase,
    positionValueBase: summarized.positionValueBase,
    cashValueBase: summarized.cashValueBase,
    totalProfitBase,
    netInvestedBase: finalInvested,
    returnPct,
    allocationByType,
    allocationByCurrency,
    timeline: dailyTimeline.length ? dailyTimeline : compressTimeline(timelineRows),
    currencies,
  };
}

function createInvestedTracker(hasCashOperations, isBondTransaction, baseCurrency) {
  let netInvestedBase = 0;
  let explicitCashFlowBase = 0;
  // Ręcznie dodane obligacje są finansowane z zewnątrz (z banku), bez nogi gotówkowej, więc
  // ich koszt liczymy do kapitału netto osobno – w każdym trybie (gotówkowym i kosztowym).
  let bondInvestedBase = 0;

  return {
    apply(transaction) {
      const grossBase = convertAt(transaction.gross, transaction.currency, baseCurrency, transaction.date);
      const feeBase = convertAt(transaction.fee, transaction.currency, baseCurrency, transaction.date);
      if (isBondTransaction(transaction)) {
        if (transaction.type === "buy") bondInvestedBase += grossBase + feeBase;
        if (transaction.type === "sell") bondInvestedBase -= Math.max(0, grossBase - feeBase);
      } else if (hasCashOperations) {
        if (transaction.type === "deposit") explicitCashFlowBase += grossBase;
        if (transaction.type === "withdrawal") explicitCashFlowBase -= grossBase;
        // Przelewy walutowe (currency conversion) przenoszą realną gotówkę, więc dla
        // pojedynczego rachunku liczą się jak wpłata/wypłata kapitału. W widoku zbiorczym
        // obie nogi konwersji (np. -PLN i +EUR) znoszą się, więc kapitał netto pozostaje spójny.
        if (transaction.type === "transfer") {
          const cashDelta = Number.isFinite(transaction.cashDelta) ? transaction.cashDelta : 0;
          explicitCashFlowBase += convertAt(cashDelta, transaction.currency, baseCurrency, transaction.date);
        }
      } else {
        if (transaction.type === "buy") netInvestedBase += grossBase + feeBase;
        if (transaction.type === "sell") netInvestedBase -= Math.max(0, grossBase - feeBase);
        if (["dividend", "interest"].includes(transaction.type)) netInvestedBase -= Math.max(0, grossBase - feeBase);
      }
    },
    value() {
      return (hasCashOperations ? explicitCashFlowBase : netInvestedBase) + bondInvestedBase;
    },
  };
}

function buildDailyTimeline(transactions, baseCurrency, hasCashOperations, isBondTransaction) {
  const ordered = transactions.filter((transaction) => transaction.date).slice().sort(compareTransactions);
  if (!ordered.length) return [];
  const today = toDateInput(new Date());
  const start = ordered[0].date;
  const end = ordered[ordered.length - 1].date > today ? ordered[ordered.length - 1].date : today;
  const positions = new Map();
  const cash = new Map();
  const investedTracker = createInvestedTracker(hasCashOperations, isBondTransaction, baseCurrency);
  const rows = [];
  let txIndex = 0;

  for (const date of isoDateRange(start, end)) {
    while (txIndex < ordered.length && ordered[txIndex].date <= date) {
      const transaction = ordered[txIndex];
      applyTransaction(transaction, positions, cash);
      investedTracker.apply(transaction);
      txIndex += 1;
    }
    const snapshot = summarizePositions(positions, cash, baseCurrency, hasCashOperations, date);
    rows.push(createTimelineRow(date, snapshot, investedTracker.value()));
  }

  return compressTimeline(rows);
}

function applyTransaction(transaction, positions, cash) {
  const currency = transaction.currency || "PLN";
  const fee = Math.abs(transaction.fee || 0);
  const gross = Math.abs(transaction.gross || 0);

  if (transaction.type === "deposit") {
    addCash(cash, currency, gross);
    return;
  }
  if (transaction.type === "withdrawal") {
    addCash(cash, currency, -gross);
    return;
  }
  if (transaction.type === "transfer") {
    addCash(cash, currency, Number.isFinite(transaction.cashDelta) ? transaction.cashDelta : 0);
    return;
  }

  const symbol = transaction.symbol || transaction.name || "";
  if (!symbol && ["dividend", "interest"].includes(transaction.type)) {
    addCash(cash, currency, Number.isFinite(transaction.cashDelta) ? transaction.cashDelta : gross - fee);
    return;
  }
  if (!symbol && ["fee", "tax"].includes(transaction.type)) {
    addCash(cash, currency, Number.isFinite(transaction.cashDelta) ? transaction.cashDelta : -(fee || gross));
    return;
  }
  if (!symbol) return;

  const key = `${symbol.toUpperCase()}|${currency}`;
  const position = positions.get(key) || createPosition(transaction, key);
  positions.set(key, position);
  position.name = transaction.name || position.name || symbol;
  position.portfolios.add(transaction.portfolioId);
  position.txCount += 1;
  position.lastTxDate = transaction.date || position.lastTxDate;

  if (transaction.type === "buy") {
    const quantity = Math.abs(transaction.quantity || 0);
    const value = gross || quantity * Math.abs(transaction.price || 0);
    if (!quantity && !value) return;
    position.quantity += quantity;
    position.costBasis += value + fee;
    position.fees += fee;
    position.lastPrice = Math.abs(quantity ? value / quantity : transaction.price || 0) || position.lastPrice;
    // Obligacje dodane ręcznie są finansowane z zewnątrz – nie ruszają salda gotówki konta.
    if (!position.bond) addCash(cash, currency, -(value + fee));
    return;
  }

  if (transaction.type === "sell") {
    const quantity = Math.abs(transaction.quantity || 0);
    const value = gross || quantity * Math.abs(transaction.price || position.lastPrice || 0);
    const avgCost = position.quantity ? position.costBasis / position.quantity : 0;
    const costSold = avgCost * quantity;
    position.quantity -= quantity;
    position.costBasis -= costSold;
    if (Math.abs(position.quantity) < 0.0000001) {
      position.quantity = 0;
      position.costBasis = 0;
    }
    position.realized += value - fee - costSold;
    position.fees += fee;
    position.lastPrice = Math.abs(quantity ? value / quantity : transaction.price || 0) || position.lastPrice;
    // Wykup obligacji: środki wracają do banku, nie zostają jako gotówka na koncie obligacji.
    if (!position.bond) addCash(cash, currency, value - fee);
    return;
  }

  if (["dividend", "interest"].includes(transaction.type)) {
    position.income += gross - fee;
    position.fees += fee;
    addCash(cash, currency, gross - fee);
    return;
  }

  if (["fee", "tax"].includes(transaction.type)) {
    position.fees += fee || gross;
    position.realized -= fee || gross;
    addCash(cash, currency, -(fee || gross));
  }
}

function createPosition(transaction, key) {
  const assetKey = assetKeyFor(transaction.symbol || transaction.name || "", transaction.currency);
  const detectedType = state.assetTypes[assetKey] || transaction.assetType || detectAssetType(transaction.symbol, transaction.name);
  return {
    key,
    assetKey,
    symbol: transaction.symbol || transaction.name || "",
    name: transaction.name || transaction.symbol || "",
    currency: transaction.currency || "PLN",
    assetType: detectedType,
    quantity: 0,
    costBasis: 0,
    realized: 0,
    income: 0,
    fees: 0,
    lastPrice: 0,
    lastTxDate: transaction.date,
    txCount: 0,
    portfolios: new Set(),
    bond: transaction.bond || null,
  };
}

function summarizePositions(positions, cash, baseCurrency, includeCash, asOf) {
  const positionsList = Array.from(positions.values()).map((position) => {
    const assetType = state.assetTypes[position.assetKey] || position.assetType || "other";
    const currentPrice = getCurrentPrice(position, asOf);
    const currentValue = Math.max(0, position.quantity) * currentPrice;
    const unrealized = currentValue - position.costBasis;
    const totalProfit = unrealized + position.realized + position.income;
    const currentValueBase = convertAt(currentValue, position.currency, baseCurrency, asOf);
    const totalProfitBase = convertAt(totalProfit, position.currency, baseCurrency, asOf);
    const averagePrice = position.quantity ? position.costBasis / position.quantity : currentPrice;
    const returnPct = position.costBasis > 0 ? (totalProfit / position.costBasis) * 100 : 0;
    const portfoliosLabel = Array.from(position.portfolios)
      .map((id) => state.portfolios.find((portfolio) => portfolio.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    return {
      ...position,
      assetType,
      currentPrice,
      currentValue,
      currentValueBase,
      totalProfit,
      totalProfitBase,
      averagePrice,
      returnPct,
      portfoliosLabel,
    };
  });

  const cashRows = Array.from(cash.entries()).map(([currency, value]) => ({
    currency,
    value,
    valueBase: convertAt(value, currency, baseCurrency, asOf),
  }));

  const positionValue = positionsList.reduce((sum, position) => sum + Math.max(0, position.currentValueBase), 0);
  const cashValue = includeCash ? cashRows.reduce((sum, row) => sum + row.valueBase, 0) : 0;
  return {
    positions: positionsList,
    cashRows,
    positionValueBase: positionValue,
    cashValueBase: cashValue,
    totalValueBase: positionValue + cashValue,
  };
}

function createTimelineRow(date, snapshot, invested) {
  return {
    date,
    value: snapshot.totalValueBase,
    invested,
    positions: snapshot.positionValueBase,
    cash: snapshot.cashValueBase,
  };
}

function compareTransactions(a, b) {
  const first = a.timestamp || `${a.date || ""} 00:00:00`;
  const second = b.timestamp || `${b.date || ""} 00:00:00`;
  const byTime = first.localeCompare(second);
  if (byTime !== 0) return byTime;
  const firstId = a.externalId || a.id || "";
  const secondId = b.externalId || b.id || "";
  return firstId.localeCompare(secondId);
}

function getCurrentPrice(position, asOf) {
  // Obligacje wyceniamy na zadaną datę (narosłe odsetki rosną w czasie), domyślnie „dziś”.
  if (position.bond) return bondCurrentPrice(position.bond, asOf ? new Date(asOf) : new Date());
  const historicalPrice = asOf ? getHistoricalPositionPrice(position, asOf) : 0;
  if (historicalPrice > 0) return historicalPrice;
  const override = state.priceOverrides[priceKey(position)];
  if (!asOf && override > 0) return override;
  if (asOf === toDateInput(new Date()) && override > 0) return override;
  return position.lastPrice || (position.quantity ? position.costBasis / position.quantity : 0);
}

function getHistoricalPositionPrice(position, asOf) {
  const entry = state.quoteHistory?.[priceKey(position)];
  const rawPrice = valueAtOrBefore(entry?.prices, asOf);
  if (!rawPrice) return 0;
  const quotePrice = rawPrice * (Number(entry.priceFactor) || 1);
  return convertAt(quotePrice, entry.currency || position.currency, position.currency, asOf);
}

function periodStartDate(period) {
  const today = new Date();
  if (period.ytd) return `${today.getFullYear()}-01-01`;
  const date = new Date(today);
  date.setMonth(date.getMonth() - period.months);
  return toDateInput(date);
}

function positionPeriodReturn(position, period) {
  const startDate = periodStartDate(period);
  const currentPrice = getCurrentPrice(position);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  let startPrice = 0;
  if (position.bond) {
    startPrice = bondCurrentPrice(position.bond, new Date(`${startDate}T12:00:00`));
  } else {
    startPrice = getHistoricalPositionPrice(position, startDate);
  }
  if (!Number.isFinite(startPrice) || startPrice <= 0) return null;
  return ((currentPrice / startPrice) - 1) * 100;
}

function holdingsReturnsHint(positions) {
  const marketPositions = positions.filter((position) => position.symbol && position.quantity > 0 && !position.bond);
  if (!marketPositions.length) return "";
  const missingHistory = marketPositions.some((position) => !Object.keys(state.quoteHistory?.[priceKey(position)]?.prices || {}).length);
  if (!missingHistory) return t("holdings.returnsHint");
  return t("holdings.returnsNeedHistory");
}

function formatPeriodReturn(value) {
  if (value == null || !Number.isFinite(value)) return '<span class="muted">—</span>';
  const tone = value >= 0 ? "positive" : "negative";
  return `<span class="${tone}">${formatPercent(value)}</span>`;
}

function getScopedTransactions(scopeId = state.selectedPortfolioId) {
  if (scopeId === "all") return state.transactions;
  const assetScope = getAssetScope(scopeId);
  if (assetScope) {
    return state.transactions.filter((transaction) => {
      return transaction.symbol && effectiveTransactionAssetType(transaction) === assetScope.assetType;
    });
  }
  if (isGroupScopeId(scopeId)) {
    const portfolioIds = new Set(getScopePortfolioIds(scopeId));
    return state.transactions.filter((transaction) => portfolioIds.has(transaction.portfolioId));
  }
  return state.transactions.filter((transaction) => transaction.portfolioId === scopeId);
}

function getScopeMeta(scopeId = state.selectedPortfolioId) {
  if (scopeId === "all") {
    return { id: "all", name: t("scope.allInvestments"), label: t("scope.aggregateView"), baseCurrency: "PLN" };
  }
  const assetScope = getAssetScope(scopeId);
  if (assetScope) {
    return { ...assetScope, baseCurrency: "PLN" };
  }
  if (isGroupScopeId(scopeId)) {
    const group = getPortfolioGroup(getGroupIdFromScope(scopeId));
    const members = portfoliosInGroup(group?.id);
    const memberLabel =
      members.length === 1 ? t("scope.oneAccount") : `${members.length} ${window.LW_I18N.pluralAccounts(members.length)}`;
    return {
      id: scopeId,
      name: group?.name || t("scope.group"),
      label: t("scope.accountGroup", { label: memberLabel }),
      baseCurrency: "PLN",
      groupId: group?.id,
    };
  }
  const portfolio = state.portfolios.find((item) => item.id === scopeId);
  if (portfolio) {
    const group = portfolio.groupId ? getPortfolioGroup(portfolio.groupId) : null;
    const prefix = group ? `${group.name} · ` : "";
    return {
      ...portfolio,
      name: group ? `${prefix}${portfolio.name}` : portfolio.name,
      label: portfolio.kind === "account" ? t("scope.currencySubaccount") : t("scope.portfolio"),
    };
  }
  return { id: "all", name: t("scope.allInvestments"), label: t("scope.aggregateView"), baseCurrency: "PLN" };
}

function getAssetScope(scopeId) {
  return getAssetScopes().find((scope) => scope.id === scopeId) || null;
}

function isRealPortfolioId(id) {
  return state.portfolios.some((portfolio) => portfolio.id === id);
}

function groupScopeId(groupId) {
  return `group:${groupId}`;
}

function isGroupScopeId(scopeId) {
  return String(scopeId || "").startsWith("group:");
}

function getGroupIdFromScope(scopeId) {
  return String(scopeId || "").replace(/^group:/, "");
}

function isAggregateScopeId(scopeId) {
  return scopeId === "all" || isGroupScopeId(scopeId);
}

function getPortfolioGroup(groupId) {
  return (state.portfolioGroups || []).find((group) => group.id === groupId) || null;
}

function portfoliosInGroup(groupId) {
  return state.portfolios
    .filter((portfolio) => portfolio.groupId === groupId)
    .slice()
    .sort((a, b) => {
      const byCurrency = (a.baseCurrency || "PLN").localeCompare(b.baseCurrency || "PLN");
      if (byCurrency !== 0) return byCurrency;
      return a.name.localeCompare(b.name, "pl");
    });
}

function getScopePortfolioIds(scopeId = state.selectedPortfolioId) {
  if (scopeId === "all") return state.portfolios.map((portfolio) => portfolio.id);
  if (isGroupScopeId(scopeId)) {
    return portfoliosInGroup(getGroupIdFromScope(scopeId)).map((portfolio) => portfolio.id);
  }
  if (isRealPortfolioId(scopeId)) return [scopeId];
  return [];
}

function resolveFormPortfolioId() {
  if (isRealPortfolioId(state.selectedPortfolioId)) return state.selectedPortfolioId;
  if (isGroupScopeId(state.selectedPortfolioId)) {
    return portfoliosInGroup(getGroupIdFromScope(state.selectedPortfolioId))[0]?.id || state.portfolios[0]?.id;
  }
  return state.portfolios[0]?.id;
}

function createPortfolioGroup(name) {
  const group = {
    id: createId("group"),
    name: name.trim(),
    color: nextPortfolioColor(),
    createdAt: new Date().toISOString(),
  };
  state.portfolioGroups.push(group);
  return group;
}

function getOrCreatePortfolioGroup({ key, name, color }) {
  const id = `group-${slugify(key)}`;
  const existing = getPortfolioGroup(id);
  if (existing) return existing;
  const group = {
    id,
    name,
    color: color || "#22577a",
    createdAt: new Date().toISOString(),
  };
  state.portfolioGroups.push(group);
  return group;
}

function inferBrokerGroup() {
  // W XTB każda waluta ma osobny numer rachunku — to podkonta jednego brokera, nie osobne grupy.
  return { key: "xtb", name: "XTB" };
}

function isXtbAccountPortfolio(portfolio) {
  if (!portfolio) return false;
  if (portfolio.kind === "account") return true;
  if (String(portfolio.id).startsWith("account-")) return true;
  if (String(portfolio.groupId || "").startsWith("group-xtb")) return true;
  if (/^(PLN|EUR|USD|GBP|CHF)(\s*[·•\-–—|]\s*|\s+\d)/i.test(String(portfolio.name || "").trim())) return true;
  const group = portfolio.groupId ? getPortfolioGroup(portfolio.groupId) : null;
  if (group && /^XTB\b/i.test(group.name)) return true;
  return false;
}

function accountPortfolioLabel({ currency = "PLN", sourceFile = "" }) {
  const accountKind = inferAccountKindFromSource(sourceFile);
  if (accountKind) return accountKind;
  return cleanCurrency(currency) || "PLN";
}

function inferAccountKindFromSource(sourceFile = "") {
  const fileName = String(sourceFile).split(/[\\/]/).pop() || "";
  if (/^IKE[_-]/i.test(fileName)) return "IKE";
  if (/^IKZE[_-]/i.test(fileName)) return "IKZE";
  return "";
}

function accountPortfolioDisplayName(portfolio) {
  return cleanCurrency(portfolio.baseCurrency) || inferPortfolioCurrency(portfolio);
}

function shortenLegacyAccountName(name, currency) {
  const normalizedCurrency = cleanCurrency(currency) || "PLN";
  const currencyFirst = String(name || "").match(/^([A-Z]{3})\s*(?:[·•\-–—|]\s*)?/i);
  if (currencyFirst && currencyFirst[1].toUpperCase() === normalizedCurrency) return normalizedCurrency;
  const match = String(name || "").match(/^XTB\s+([A-Z]{3})(?:\s+(.+))?$/i);
  if (match) return match[1].toUpperCase();
  if (normalize(name) === normalize(normalizedCurrency)) return normalizedCurrency;
  return normalizedCurrency;
}

function isXtbTransaction(transaction) {
  if (transaction.source === "XTB import") return true;
  const portfolio = state.portfolios.find((item) => item.id === transaction.portfolioId);
  return Boolean(portfolio?.kind === "account" || /^XTB(\s+[A-Z]{3})?/i.test(portfolio?.name || ""));
}

function inferPortfolioCurrency(portfolio, transactions = null) {
  const txs = transactions || state.transactions.filter((transaction) => transaction.portfolioId === portfolio.id);
  const fromName = String(portfolio.name || "").match(/^(?:XTB\s+)?([A-Z]{3})\b/i);
  if (fromName) return fromName[1].toUpperCase();
  const currencies = [...new Set(txs.map((transaction) => cleanCurrency(transaction.currency)).filter(Boolean))];
  if (currencies.length === 1) return currencies[0];
  if (portfolio.baseCurrency) return cleanCurrency(portfolio.baseCurrency) || "PLN";
  return "PLN";
}

function looksLikeLegacyXtbPortfolio(portfolio) {
  if (portfolio.kind === "account") return false;
  const name = String(portfolio.name || "");
  if (/^XTB(\s+[-–]?\s*[A-Z]{3})?$/i.test(name.trim())) return true;
  if (/^(PLN|EUR|USD|GBP|CHF)$/i.test(name.trim())) {
    const txs = state.transactions.filter((transaction) => transaction.portfolioId === portfolio.id);
    return txs.some((transaction) => transaction.source === "XTB import");
  }
  const txs = state.transactions.filter((transaction) => transaction.portfolioId === portfolio.id);
  if (!txs.length) return false;
  const xtbCount = txs.filter((transaction) => transaction.source === "XTB import").length;
  return xtbCount >= Math.max(1, Math.ceil(txs.length * 0.5));
}

function moveTransactionsToAccountPortfolios(portfolio) {
  let moved = 0;
  const txs = state.transactions.filter((transaction) => transaction.portfolioId === portfolio.id);
  txs.forEach((transaction) => {
    const currency = cleanCurrency(transaction.currency) || inferPortfolioCurrency(portfolio, txs) || "PLN";
    const account = transaction.account || inferAccountFromSource(transaction.sourceFile || "") || portfolio.account || "";
    const target = getOrCreateAccountPortfolio({ account, currency, sourceFile: transaction.sourceFile || portfolio.sourceFile || "" });
    if (transaction.portfolioId !== target.id) {
      transaction.portfolioId = target.id;
      moved += 1;
    }
  });
  return moved;
}

function purgeStaleXtbGroups(primaryGroup) {
  if (!primaryGroup) return false;
  const before = state.portfolioGroups.length;
  state.portfolioGroups = (state.portfolioGroups || []).filter((group) => {
    if (group.id === primaryGroup.id) return true;
    if (/^XTB\b/i.test(group.name) || (group.id.startsWith("group-xtb-") && group.id !== primaryGroup.id)) return false;
    return state.portfolios.some((portfolio) => portfolio.groupId === group.id);
  });
  return state.portfolioGroups.length !== before;
}

function consolidateXtbPortfolios() {
  if (!Array.isArray(state.portfolioGroups)) state.portfolioGroups = [];
  let changed = false;
  let removedCount = 0;
  const removedIds = [];

  state.transactions.forEach((transaction) => {
    if (!isXtbTransaction(transaction) || !transaction.currency) return;
    const account = transaction.account || inferAccountFromSource(transaction.sourceFile || "") || "";
    const target = getOrCreateAccountPortfolio({
      account,
      currency: transaction.currency,
      sourceFile: transaction.sourceFile || "",
    });
    if (transaction.portfolioId !== target.id) {
      transaction.portfolioId = target.id;
      changed = true;
    }
  });

  const legacyPortfolios = state.portfolios.filter((portfolio) => looksLikeLegacyXtbPortfolio(portfolio));
  legacyPortfolios.forEach((portfolio) => {
    if (moveTransactionsToAccountPortfolios(portfolio)) changed = true;
  });

  const emptyLegacy = state.portfolios.filter(
    (portfolio) =>
      looksLikeLegacyXtbPortfolio(portfolio) && !state.transactions.some((transaction) => transaction.portfolioId === portfolio.id),
  );
  if (emptyLegacy.length) {
    emptyLegacy.forEach((portfolio) => removedIds.push(portfolio.id));
    state.portfolios = state.portfolios.filter((portfolio) => !removedIds.includes(portfolio.id));
    removedCount = emptyLegacy.length;
    changed = true;
  }

  const accountPortfolios = state.portfolios.filter(isXtbAccountPortfolio);
  let primaryGroup = null;
  if (accountPortfolios.length) {
    const broker = inferBrokerGroup();
    primaryGroup = getOrCreatePortfolioGroup({ key: broker.key, name: broker.name, color: "#22577a" });
    accountPortfolios.forEach((portfolio) => {
      if (portfolio.kind !== "account") {
        portfolio.kind = "account";
        changed = true;
      }
      if (portfolio.groupId !== primaryGroup.id) {
        portfolio.groupId = primaryGroup.id;
        changed = true;
      }
      const displayName = accountPortfolioDisplayName(portfolio);
      if (portfolio.name !== displayName) {
        portfolio.name = displayName;
        changed = true;
      }
      const color = currencyPortfolioColor(displayName);
      if (portfolio.color !== color) {
        portfolio.color = color;
        changed = true;
      }
    });
    if (purgeStaleXtbGroups(primaryGroup)) changed = true;
  }

  cleanupEmptyDefaultPortfolio();
  cleanupEmptyPortfolioGroups();

  if (primaryGroup) {
    if (removedIds.includes(state.selectedPortfolioId)) {
      state.selectedPortfolioId = groupScopeId(primaryGroup.id);
      changed = true;
    }
    if (isGroupScopeId(state.selectedPortfolioId)) {
      const selectedGroupId = getGroupIdFromScope(state.selectedPortfolioId);
      if (selectedGroupId !== primaryGroup.id) {
        const selectedGroup = getPortfolioGroup(selectedGroupId);
        if (selectedGroup?.name?.match(/^XTB\b/i) || selectedGroupId.startsWith("group-xtb-")) {
          state.selectedPortfolioId = groupScopeId(primaryGroup.id);
          changed = true;
        }
      }
    }
  }

  const accountCount = primaryGroup ? portfoliosInGroup(primaryGroup.id).length : accountPortfolios.length;
  if (changed) saveState();
  const result = {
    merged: accountCount >= 2 || (accountCount >= 1 && removedCount > 0),
    accountCount,
    removedCount,
    groupName: primaryGroup?.name || "XTB",
    message:
      accountCount >= 2
        ? ""
        : accountCount === 1
          ? "Jest tylko jeden rachunek XTB — nie ma czego łączyć."
          : "Nie znaleziono operacji XTB ani portfeli do połączenia.",
  };
  return result;
}

function buildPortfolioSelectOptions(selectedId) {
  const groupedIds = new Set();
  const chunks = [];
  (state.portfolioGroups || []).forEach((group) => {
    const members = portfoliosInGroup(group.id);
    if (!members.length) return;
    members.forEach((portfolio) => groupedIds.add(portfolio.id));
    const options = members
      .map((portfolio) => {
        const isSelected = portfolio.id === selectedId ? "selected" : "";
        return `<option value="${escapeAttr(portfolio.id)}" ${isSelected}>${escapeHtml(portfolio.name)}</option>`;
      })
      .join("");
    chunks.push(`<optgroup label="${escapeAttr(group.name)}">${options}</optgroup>`);
  });
  const ungrouped = state.portfolios.filter((portfolio) => !groupedIds.has(portfolio.id));
  if (ungrouped.length) {
    chunks.push(
      ungrouped
        .map((portfolio) => {
          const isSelected = portfolio.id === selectedId ? "selected" : "";
          return `<option value="${escapeAttr(portfolio.id)}" ${isSelected}>${escapeHtml(portfolio.name)}</option>`;
        })
        .join(""),
    );
  }
  return chunks.join("");
}

function renderPortfolioGroupsPanel() {
  if (!dom.portfolioGroupsPanel) return;
  if (!state.portfolios.length) {
    dom.portfolioGroupsPanel.innerHTML = `<p class="muted">${escapeHtml(t("groups.empty"))}</p>`;
    return;
  }
  const groupOptions = (selectedGroupId = "") => {
    const noneSelected = selectedGroupId ? "" : "selected";
    const options = [`<option value="" ${noneSelected}>${escapeHtml(t("groups.noGroup"))}</option>`];
    (state.portfolioGroups || []).forEach((group) => {
      const isSelected = group.id === selectedGroupId ? "selected" : "";
      options.push(`<option value="${escapeAttr(group.id)}" ${isSelected}>${escapeHtml(group.name)}</option>`);
    });
    return options.join("");
  };
  dom.portfolioGroupsPanel.innerHTML = `
    <p class="muted portfolio-groups-copy">${escapeHtml(t("groups.description"))}</p>
    <div class="table-wrap portfolio-groups-table">
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(t("groups.accountCol"))}</th>
            <th>${escapeHtml(t("groups.groupCol"))}</th>
          </tr>
        </thead>
        <tbody>
          ${state.portfolios
            .map((portfolio) => {
              const group = portfolio.groupId ? getPortfolioGroup(portfolio.groupId) : null;
              const kindLabel = portfolio.kind === "account" ? t("groups.subaccount") : t("scope.portfolio");
              return `
                <tr>
                  <td>
                    <strong>${escapeHtml(portfolio.name)}</strong>
                    <small class="muted">${escapeHtml(kindLabel)}${group ? ` · ${escapeHtml(group.name)}` : ""}</small>
                  </td>
                  <td>
                    <select data-portfolio-group="${escapeAttr(portfolio.id)}" aria-label="Grupa dla ${escapeAttr(portfolio.name)}">
                      ${groupOptions(portfolio.groupId || "")}
                    </select>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  dom.portfolioGroupsPanel.querySelectorAll("[data-portfolio-group]").forEach((select) => {
    select.addEventListener("change", () => {
      const portfolio = state.portfolios.find((item) => item.id === select.dataset.portfolioGroup);
      if (!portfolio) return;
      portfolio.groupId = select.value || "";
      cleanupEmptyPortfolioGroups();
      saveState();
      render();
    });
  });
}

function cleanupEmptyPortfolioGroups() {
  const usedGroupIds = new Set(state.portfolios.map((portfolio) => portfolio.groupId).filter(Boolean));
  state.portfolioGroups = (state.portfolioGroups || []).filter((group) => usedGroupIds.has(group.id));
  if (isGroupScopeId(state.selectedPortfolioId) && !getPortfolioGroup(getGroupIdFromScope(state.selectedPortfolioId))) {
    state.selectedPortfolioId = "all";
  }
}

function effectiveTransactionAssetType(transaction) {
  const key = assetKeyFor(transaction.symbol || transaction.name || "", transaction.currency);
  return state.assetTypes[key] || transaction.assetType || detectAssetType(transaction.symbol, transaction.name);
}

async function handleFiles(files, options = {}) {
  const fallbackPortfolioId = dom.importPortfolio.value || state.portfolios[0]?.id;
  const label = files.length === 1 ? files[0].name : `${files.length} pliki`;
  dom.importStatus.innerHTML = `<strong>${escapeHtml(label)}</strong><small> ${escapeHtml(t("import.loading"))}</small>`;
  try {
    if (options.requireZip) {
      const invalid = files.filter((file) => !file.name.toLowerCase().endsWith(".zip"));
      if (invalid.length) throw new Error(t("import.xtb.zipOnly"));
    }
    const rowGroups = await Promise.all(files.map((file) => readRowsFromFile(file, options)));
    const rows = rowGroups.flat();
    const isUniversal = rows.length > 0 && isUniversalImportFormat(rows);
    if (options.requireUniversal && !isUniversal) {
      throw new Error(t("import.universal.invalidFormat"));
    }
    const mapped = rows
      .map((row, index) =>
        isUniversal
          ? mapUniversalRowToTransaction(row, fallbackPortfolioId, index)
          : mapRowToTransaction(row, resolveImportPortfolioId(row, fallbackPortfolioId), index),
      )
      .filter(Boolean);
    const fingerprints = new Set(state.transactions.map(transactionFingerprint));
    const deduped = [];
    let duplicates = 0;
    mapped.forEach((transaction) => {
      const fingerprint = transactionFingerprint(transaction);
      if (fingerprints.has(fingerprint) || deduped.some((item) => transactionFingerprint(item) === fingerprint)) {
        duplicates += 1;
      } else {
        deduped.push(transaction);
      }
    });
    importPreview = deduped;
    const skipped = rows.length - mapped.length;
    dom.importStatus.innerHTML = `
      <strong>${escapeHtml(t("import.preview.ready", { count: deduped.length }))}</strong>
      <small>${escapeHtml(
        t("import.preview.stats", {
          rows: rows.length,
          files: files.length,
          skipped,
          duplicates,
        }),
      )}</small>
    `;
    saveState();
    render();
    setTab("import");
  } catch (error) {
    importPreview = [];
    dom.importStatus.innerHTML = `<strong>${escapeHtml(t("import.error"))}</strong><small>${escapeHtml(error.message)}</small>`;
    renderImportPreview();
  }
}

async function readRowsFromFile(file, options = {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    if (!window.JSZip) throw new Error(t("error.missingZip"));
    if (!window.XLSX) throw new Error(t("error.missingXlsx"));
    const zipData = await file.arrayBuffer();
    const archive = await window.JSZip.loadAsync(zipData);
    const entries = Object.values(archive.files).filter((entry) => {
      return !entry.dir && /\.(xlsx|xls)$/i.test(entry.name) && !/(^|\/)__MACOSX\//.test(entry.name);
    });
    const rowGroups = [];
    for (const entry of entries) {
      const data = await entry.async("arraybuffer");
      rowGroups.push(readRowsFromWorkbook(data, entry.name));
    }
    return rowGroups.flat();
  }
  if (options.requireZip) {
    throw new Error(t("import.xtb.zipOnly"));
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    if (!window.XLSX) throw new Error(t("error.missingXlsx"));
    const data = await file.arrayBuffer();
    return readRowsFromWorkbook(data, file.name);
  }
  const text = await file.text();
  return parseCsv(text).map((row) => withImportMetadata(row, file.name));
}

function findCashOperationsSheetName(workbook) {
  const names = workbook.SheetNames || [];
  const exact = names.find((name) => normalize(name) === "cash operations");
  if (exact) return exact;
  return (
    names.find((name) => {
      const label = normalize(name);
      return (
        label.includes("cash operation") ||
        label.includes("operacje gotowk") ||
        label.includes("operacje pieniez") ||
        label.includes("peniezne operac")
      );
    }) || null
  );
}

function findWorkbookSheetWithCashHeaders(workbook) {
  for (const name of workbook.SheetNames || []) {
    const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false });
    const headerIndex = findHeaderRow(matrix);
    const headers = (matrix[headerIndex] || []).map(normalize);
    const hasType = headers.some((header) => header === "type" || header === "typ" || header === "operacja");
    const hasAmount = headers.some((header) => header.includes("amount") || header.includes("kwota") || header.includes("wartosc"));
    if (hasType && hasAmount) return name;
  }
  return workbook.SheetNames?.[0] || "";
}

function readRowsFromWorkbook(data, sourceName) {
  const workbook = window.XLSX.read(data, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames?.[0];
  if (firstSheetName) {
    const firstMatrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      defval: "",
      raw: false,
    });
    const universalRows = matrixToObjects(firstMatrix);
    if (universalRows.length && isUniversalImportFormat(universalRows)) {
      return universalRows.map((row) => withImportMetadata(row, sourceName, ""));
    }
  }
  const cashSheetName = findCashOperationsSheetName(workbook) || findWorkbookSheetWithCashHeaders(workbook);
  const sheet = workbook.Sheets[cashSheetName];
  if (!sheet) return [];
  const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  return matrixToObjects(matrix).map((row) => withImportMetadata(row, sourceName, cashSheetName));
}

function withImportMetadata(row, sourceName, sheetName = "") {
  const metadata = {
    ...row,
    "Source File": sourceName,
    "Source Sheet": sheetName,
  };
  const currency = inferCurrencyFromSource(sourceName);
  const account = inferAccountFromSource(sourceName);
  if (currency && !metadata.Currency && !metadata.Waluta) metadata.Currency = currency;
  if (account) metadata.Account = account;
  return metadata;
}

function resolveImportPortfolioId(row, fallbackPortfolioId) {
  const normalizedRow = normalizeRow(row);
  const sourceFile = cleanText(pick(normalizedRow, ["source file"]));
  const sourceSheet = cleanText(pick(normalizedRow, ["source sheet"]));
  const account = cleanText(pick(normalizedRow, ["account", "account number", "rachunek"])) || inferAccountFromSource(sourceFile);
  const currency =
    cleanCurrency(pick(normalizedRow, ["currency", "waluta", "ccy"])) ||
    inferCurrencyFromSource(sourceFile) ||
    "PLN";
  const isXtbAccountRow = normalize(sourceSheet) === "cash operations" || Boolean(account && sourceFile);
  if (!isXtbAccountRow) return fallbackPortfolioId;
  return getOrCreateAccountPortfolio({ account, currency, sourceFile }).id;
}

function getOrCreateAccountPortfolio({ account = "", currency = "PLN", sourceFile = "" }) {
  const normalizedCurrency = cleanCurrency(currency) || "PLN";
  const accountLabel = cleanText(account) || inferAccountFromSource(sourceFile) || "";
  const id = `account-${slugify(`${accountLabel || "konto"}-${normalizedCurrency}`)}`;
  const brokerGroup = inferBrokerGroup();
  const group = getOrCreatePortfolioGroup({
    key: brokerGroup.key,
    name: brokerGroup.name,
    color: "#22577a",
  });
  const existing = state.portfolios.find((portfolio) => portfolio.id === id);
  if (existing) {
    const displayName = accountPortfolioLabel({ currency: normalizedCurrency, sourceFile });
    if (existing.groupId !== group.id) existing.groupId = group.id;
    if (existing.name !== displayName) existing.name = displayName;
    if (!existing.account && accountLabel) existing.account = accountLabel;
    return existing;
  }
  const portfolio = {
    id,
    kind: "account",
    groupId: group.id,
    account: accountLabel,
    sourceFile,
    name: accountPortfolioLabel({ currency: normalizedCurrency, sourceFile }),
    baseCurrency: normalizedCurrency,
    color: currencyPortfolioColor(normalizedCurrency),
    createdAt: new Date().toISOString(),
  };
  state.portfolios.push(portfolio);
  cleanupEmptyDefaultPortfolio();
  return portfolio;
}

function migratePortfolioGroups() {
  return consolidateXtbPortfolios();
}

function migrateStoredTransactionsToAccountPortfolios() {
  consolidateXtbPortfolios();
}

function cleanupEmptyDefaultPortfolio() {
  const hasAccountPortfolio = state.portfolios.some(isXtbAccountPortfolio);
  const defaultPortfolio = state.portfolios.find((portfolio) => portfolio.name === "XTB główny" && String(portfolio.id).startsWith("portfolio-"));
  if (!hasAccountPortfolio || !defaultPortfolio || state.transactions.some((transaction) => transaction.portfolioId === defaultPortfolio.id)) return;
  state.portfolios = state.portfolios.filter((portfolio) => portfolio.id !== defaultPortfolio.id);
  if (state.selectedPortfolioId === defaultPortfolio.id) state.selectedPortfolioId = "all";
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return matrixToObjects(rows);
}

function matrixToObjects(matrix) {
  const rows = matrix.filter((row) => row.some((cell) => String(cell).trim()));
  if (!rows.length) return [];
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map((header, index) => String(header || `Kolumna ${index + 1}`).trim());
  return rows.slice(headerIndex + 1).map((cells) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header || `Kolumna ${index + 1}`] = cells[index] ?? "";
    });
    return object;
  });
}

function findHeaderRow(rows) {
  const headerWords = [
    "date",
    "data",
    "czas",
    "type",
    "typ",
    "operacja",
    "symbol",
    "ticker",
    "instrument",
    "walor",
    "price",
    "cena",
    "quantity",
    "ilosc",
    "ilość",
    "volume",
    "wolumen",
    "amount",
    "kwota",
    "value",
    "wartosc",
    "wartość",
  ];
  let bestIndex = 0;
  let bestScore = 0;
  rows.slice(0, 25).forEach((row, index) => {
    const cells = row.map(normalize);
    const score = headerWords.reduce((sum, word) => {
      return sum + (cells.some((cell) => cell === normalize(word) || cell.includes(normalize(word))) ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= 2 ? bestIndex : 0;
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const delimiters = [",", ";", "\t", "|"];
  return delimiters
    .map((delimiter) => ({ delimiter, count: (sample.match(new RegExp(escapeRegExp(delimiter), "g")) || []).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function isUniversalImportFormat(rows) {
  if (!rows.length) return false;
  const headers = Object.keys(normalizeRow(rows[0]));
  const required = ["date", "type", "gross", "currency"];
  if (!required.every((key) => headers.includes(key))) return false;
  if (headers.includes("amount") && !headers.includes("gross")) return false;
  if (headers.includes("operacja") || headers.includes("operation type")) return false;
  if (pick(normalizeRow(rows[0]), ["source sheet"])) return false;
  return true;
}

function resolveUniversalOperationType(value = "") {
  const key = normalize(value);
  if (/bond|oblig/.test(key)) return "";
  if (UNIVERSAL_TYPE_ALIASES[key]) return UNIVERSAL_TYPE_ALIASES[key];
  if (UNIVERSAL_IMPORT_TYPES.has(key)) return key;
  return "";
}

function inferUniversalCashDelta(type, gross, cashDeltaRaw) {
  const parsedCashDelta = parseNumber(cashDeltaRaw);
  if (String(cashDeltaRaw ?? "").trim() !== "") return parsedCashDelta;
  const amount = Math.abs(gross);
  if (["buy", "withdrawal", "fee", "tax"].includes(type)) return -amount;
  if (["sell", "deposit", "dividend", "interest"].includes(type)) return amount;
  return 0;
}

function buildUniversalTemplateRows() {
  return [
    {
      date: "2024-01-15",
      type: "buy",
      symbol: "AAPL",
      name: "Apple Inc.",
      quantity: "10",
      price: "150.00",
      gross: "1500.00",
      fee: "5.00",
      currency: "USD",
      cash_delta: "",
      external_id: "buy-001",
      notes: t("import.universal.example.buy"),
    },
    {
      date: "2024-02-20",
      type: "sell",
      symbol: "AAPL",
      name: "Apple Inc.",
      quantity: "5",
      price: "160.00",
      gross: "800.00",
      fee: "3.00",
      currency: "USD",
      cash_delta: "",
      external_id: "sell-001",
      notes: t("import.universal.example.sell"),
    },
    {
      date: "2024-03-01",
      type: "deposit",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "5000.00",
      fee: "",
      currency: "PLN",
      cash_delta: "",
      external_id: "dep-001",
      notes: t("import.universal.example.deposit"),
    },
    {
      date: "2024-03-10",
      type: "withdrawal",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "1000.00",
      fee: "",
      currency: "PLN",
      cash_delta: "",
      external_id: "wd-001",
      notes: t("import.universal.example.withdrawal"),
    },
    {
      date: "2024-03-15",
      type: "transfer",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "500.00",
      fee: "",
      currency: "EUR",
      cash_delta: "500.00",
      external_id: "tr-001",
      notes: t("import.universal.example.transfer"),
    },
    {
      date: "2024-04-01",
      type: "fee",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "10.00",
      fee: "10.00",
      currency: "PLN",
      cash_delta: "",
      external_id: "fee-001",
      notes: t("import.universal.example.fee"),
    },
    {
      date: "2024-04-05",
      type: "tax",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "45.00",
      fee: "",
      currency: "PLN",
      cash_delta: "",
      external_id: "tax-001",
      notes: t("import.universal.example.tax"),
    },
    {
      date: "2024-05-01",
      type: "interest",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "12.50",
      fee: "",
      currency: "PLN",
      cash_delta: "",
      external_id: "int-001",
      notes: t("import.universal.example.interest"),
    },
    {
      date: "2024-06-01",
      type: "dividend",
      symbol: "VWCE",
      name: "Vanguard FTSE All-World",
      quantity: "",
      price: "",
      gross: "120.00",
      fee: "",
      currency: "EUR",
      cash_delta: "",
      external_id: "div-001",
      notes: t("import.universal.example.dividend"),
    },
    {
      date: "2024-07-01",
      type: "other",
      symbol: "",
      name: "",
      quantity: "",
      price: "",
      gross: "25.00",
      fee: "",
      currency: "PLN",
      cash_delta: "",
      external_id: "oth-001",
      notes: t("import.universal.example.other"),
    },
  ];
}

function downloadUniversalImportTemplate() {
  const rows = buildUniversalTemplateRows();
  const csv = [
    UNIVERSAL_IMPORT_HEADERS.join(","),
    ...rows.map((row) => UNIVERSAL_IMPORT_HEADERS.map((header) => csvEscape(row[header] ?? "")).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    window.LW_I18N.getLocale() === "en" ? "librewallet-import-template.csv" : "librewallet-import-szablon.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function mapUniversalRowToTransaction(row, portfolioId, index) {
  const normalizedRow = normalizeRow(row);
  const rawType = cleanText(pick(normalizedRow, ["type", "typ"]));
  if (!rawType) return null;
  const type = resolveUniversalOperationType(rawType);
  if (!type) return null;

  const date = parseDateValue(pick(normalizedRow, ["date", "data"]));
  if (!date) return null;

  const symbol = cleanSymbol(pick(normalizedRow, ["symbol", "ticker", "walor"]));
  const name = cleanText(pick(normalizedRow, ["name", "nazwa"])) || symbol;
  const quantity = Math.abs(parseNumber(pick(normalizedRow, ["quantity", "ilosc", "qty"])));
  const price = Math.abs(parseNumber(pick(normalizedRow, ["price", "cena"])));
  const grossInput = parseNumber(pick(normalizedRow, ["gross", "kwota", "amount"]));
  const gross = Math.abs(grossInput) || quantity * price || 0;
  const fee = Math.abs(parseNumber(pick(normalizedRow, ["fee", "prowizja", "commission"])));
  const currency = cleanCurrency(pick(normalizedRow, ["currency", "waluta", "ccy"])) || "PLN";
  const cashDelta = inferUniversalCashDelta(type, gross, pick(normalizedRow, ["cash_delta", "cash delta"]));
  const notes = cleanText(pick(normalizedRow, ["notes", "notatki", "opis", "comment"]));

  if (!gross && !(quantity && price)) return null;
  if (!UNIVERSAL_CASH_TYPES.has(type) && !symbol) return null;

  return {
    id: createId(`import-${index}`),
    portfolioId,
    date,
    timestamp: `${date} 00:00:00`,
    externalId: cleanText(pick(normalizedRow, ["external_id", "external id", "id"])),
    account: "",
    type,
    symbol,
    name,
    assetType: detectAssetType(symbol, name),
    quantity,
    price,
    gross,
    fee,
    cashDelta,
    currency,
    source: "Universal import",
    notes,
  };
}

function mapRowToTransaction(row, portfolioId, index) {
  const normalizedRow = normalizeRow(row);
  const rowType = normalize(pick(normalizedRow, ["type", "typ", "operacja", "operation", "transaction type", "rodzaj"]));
  if (/^(total|profit\/loss|profit loss|saldo|suma)$/.test(rowType)) return null;
  const rawDateValue = pick(normalizedRow, [
    "date",
    "data",
    "czas",
    "time",
    "timestamp",
    "open time",
    "close time",
    "open time utc",
    "close time utc",
    "time utc",
    "data operacji",
    "transaction date",
  ]);
  const date = parseDateValue(
    rawDateValue,
  );
  const timestamp = parseDateTimeValue(rawDateValue) || `${date} 00:00:00`;
  const tickerValue = pick(normalizedRow, ["symbol", "ticker", "walor", "isin"]);
  const instrumentValue = pick(normalizedRow, ["instrument", "instrument name", "nazwa instrumentu", "name", "nazwa"]);
  const symbol = cleanSymbol(tickerValue || instrumentValue);
  const name = cleanText(instrumentValue) || symbol;
  const sideText = [
    pick(normalizedRow, ["type", "typ", "operacja", "operation", "side", "action", "transaction type", "rodzaj"]),
    pick(normalizedRow, ["comment", "komentarz", "description", "opis"]),
  ]
    .filter(Boolean)
    .join(" ");
  const quantity = Math.abs(
    parseNumber(pick(normalizedRow, ["quantity", "ilosc", "ilość", "volume", "wolumen", "qty", "shares", "units", "liczba"])),
  );
  const price = Math.abs(
    parseNumber(pick(normalizedRow, ["price", "cena", "open price", "close price", "rate", "kurs", "cena wykonania"])),
  );
  const xtbDeal = parseXtbDealComment(pick(normalizedRow, ["comment", "komentarz", "description", "opis"]));
  const grossRaw = parseNumber(
    pick(normalizedRow, [
      "amount",
      "kwota",
      "value",
      "wartosc",
      "wartość",
      "nominal",
      "turnover",
      "obrót",
      "net amount",
      "transaction value",
      "wartosc transakcji",
      "wartość transakcji",
    ]),
  );
  const fee = Math.abs(
    parseNumber(pick(normalizedRow, ["commission", "prowizja", "fee", "fees", "charge", "charges", "koszty"])),
  );
  const sourceFile = cleanText(pick(normalizedRow, ["source file"]));
  const currency =
    cleanCurrency(pick(normalizedRow, ["currency", "waluta", "ccy"])) ||
    inferCurrencyFromSource(sourceFile) ||
    detectCurrency(Object.values(row).join(" ")) ||
    "PLN";
  const finalQuantity = quantity || xtbDeal.quantity || 0;
  const finalPrice = price || xtbDeal.price || 0;
  const type =
    mapXtbOperationTypeFromRow(pick(normalizedRow, ["type", "typ", "operacja", "operation", "transaction type", "rodzaj"])) ||
    detectOperationType(sideText, grossRaw, symbol, finalQuantity, finalPrice);
  const gross = Math.abs(grossRaw) || finalQuantity * finalPrice || 0;
  if (!date && !symbol && !gross) return null;
  if (!date) return null;
  if (!symbol && !["deposit", "withdrawal", "transfer", "fee", "tax", "interest", "dividend"].includes(type)) return null;

  return {
    id: createId(`import-${index}`),
    portfolioId,
    date,
    timestamp,
    externalId: cleanText(pick(normalizedRow, ["id", "transaction id", "position id", "numer", "identyfikator"])),
    account: cleanText(pick(normalizedRow, ["account", "account number", "rachunek"])),
    type,
    symbol,
    name,
    assetType: detectAssetType(symbol, name),
    quantity: finalQuantity,
    price: finalPrice,
    gross,
    fee,
    cashDelta: grossRaw || 0,
    currency,
    source: "XTB import",
    notes: cleanText(sideText),
  };
}

function normalizeRow(row) {
  const normalizedRow = {};
  Object.entries(row).forEach(([key, value]) => {
    normalizedRow[normalize(key)] = value;
  });
  return normalizedRow;
}

function pick(row, keys) {
  for (const key of keys) {
    const normalizedKey = normalize(key);
    if (row[normalizedKey] !== undefined && String(row[normalizedKey]).trim() !== "") {
      return row[normalizedKey];
    }
  }
  return "";
}

function mapXtbOperationTypeFromRow(rowType = "") {
  const value = normalize(rowType);
  if (!value || /^(total|profit\/loss|profit loss|saldo|suma)$/.test(value)) return "";
  if (/^stock purchase/.test(value) || /^zakup/.test(value)) return "buy";
  if (/^stock sell/.test(value) || /^sprzed/.test(value)) return "sell";
  if (/^ike deposit/.test(value) || /^ikze deposit/.test(value)) return "transfer";
  if (/^deposit/.test(value) || /^wplata/.test(value)) return "deposit";
  if (/^withdrawal/.test(value) || /^wyplata/.test(value)) return "withdrawal";
  if (/^subaccount transfer/.test(value) || /^transfer/.test(value) || /^przelew/.test(value) || /^konwersja/.test(value)) {
    return "transfer";
  }
  if (/^dividend/.test(value) || /^divident/.test(value) || /^dywidenda/.test(value)) return "dividend";
  if (/withholding tax/.test(value) || /free.funds interest tax/.test(value) || /^podatek/.test(value)) return "tax";
  if (/free.funds interest/.test(value) || /^odset/.test(value) || /^interest/.test(value)) return "interest";
  return "";
}

function formatCashBreakdown(scope, baseCurrency = "PLN") {
  if (!scope.hasCashOperations) return t("metric.withoutCash");
  const positive = scope.cashRows.filter((row) => row.value > 0.001);
  if (!positive.length) return t("metric.withCash");
  const parts = positive.map((row) => {
    if (row.currency === baseCurrency) return `${row.currency} ${formatNumber(row.value)}`;
    return `${row.currency} ${formatNumber(row.value)} (≈${formatMoney(row.valueBase, baseCurrency)})`;
  });
  return t("metric.cashBreakdown", { parts: parts.join(", "), total: formatMoney(scope.cashValueBase, baseCurrency) });
}

function parseXtbDealComment(comment) {
  const text = String(comment || "");
  const match = text.match(/\b(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([0-9]+(?:[.,][0-9]+)?)(?:\s*\/\s*[0-9]+(?:[.,][0-9]+)?)?\s*@\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!match) return { quantity: 0, price: 0 };
  return {
    quantity: Math.abs(parseNumber(match[1])),
    price: Math.abs(parseNumber(match[2])),
  };
}

function detectOperationType(text, amount, symbol, quantity, price) {
  const value = normalize(text);
  if (/^(total|profit\/loss|profit loss|saldo|suma)$/.test(value)) return "other";
  if (/(tax|podatek)/.test(value)) return "tax";
  if (/ike deposit|ikze deposit/.test(value)) return "transfer";
  if (/(dywid|dividend)/.test(value)) return "dividend";
  if (/(odset|interest|coupon)/.test(value)) return "interest";
  if (/(wplat|deposit|cash in|zasil)/.test(value)) return "deposit";
  if (/(wyplat|withdraw|cash out)/.test(value)) return "withdrawal";
  if (/(transfer|currency conversion|conversion|subaccount transfer|konwersja|przelew miedzy|przelew)/.test(value) && !symbol) {
    return "transfer";
  }
  if (/^(divident|dywidenda)\b/.test(value)) return "dividend";
  if (/(prowiz|commission|fee|charge)/.test(value) && !symbol) return "fee";
  if (/(stock sell|sprzed|sell|market sell|close buy|close sell)/.test(value)) return "sell";
  if (/(stock purchase|purchase|kup|buy|market buy|open buy)/.test(value)) return "buy";
  if (symbol && quantity && price) return amount > 0 ? "sell" : "buy";
  if (!symbol && amount < 0) return "withdrawal";
  if (!symbol && amount > 0) return "deposit";
  return "other";
}

function detectAssetType(symbol = "", name = "") {
  const text = normalize(`${symbol} ${name}`);
  if (/\b(vwce|vuaa|vusa|cspx|iwda|eimi|sxr8|swda|vwrl|acwi|qdve|is3n|iusq|eunl|emim|lcuw|meud|spyl|sppw|pr1w|vhyl|vgeg|veur|zprv|zprx|aggu|iuit|eqac)\b/.test(text)) {
    return "etf";
  }
  if (/\b(etf|ucits|ishares|vanguard|xtrackers|amundi|lyxor|invesco|spdr|wisdomtree)\b/.test(text)) return "etf";
  if (/\b(bond|oblig|treasury|skarb|edo|coi|tos|rod|rso|catalyst)\b/.test(text)) return "bond";
  if (!symbol && /cash|gotow/.test(text)) return "cash";
  if (symbol) return "stock";
  return "other";
}

function commitImport() {
  if (!importPreview.length) return;
  const fingerprints = new Set(state.transactions.map(transactionFingerprint));
  const accepted = [];
  importPreview.forEach((transaction) => {
    const fingerprint = transactionFingerprint(transaction);
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    accepted.push({ ...transaction, id: createId("tx") });
  });
  state.transactions.push(...accepted);
  importPreview = [];
  const scope = calculateScope();
  const cashNote = scope.hasCashOperations ? `<small>${escapeHtml(formatCashBreakdown(scope, scope.baseCurrency))}</small>` : "";
  dom.importStatus.innerHTML = `<strong>${escapeHtml(t("import.saved", { count: accepted.length }))}</strong><small>${escapeHtml(t("import.savedHint"))}</small>${cashNote}`;
  saveState();
  render();
}

function addManualTransaction(event) {
  event.preventDefault();
  const form = new FormData(dom.manualForm);
  const symbol = cleanSymbol(form.get("symbol"));
  const type = form.get("type");
  const quantity = Math.abs(parseNumber(form.get("quantity")));
  const price = Math.abs(parseNumber(form.get("price")));
  const gross = Math.abs(parseNumber(form.get("gross"))) || quantity * price;
  const currency = cleanCurrency(form.get("currency")) || "PLN";
  const transaction = {
    id: createId("manual"),
    portfolioId: form.get("portfolioId") || state.portfolios[0].id,
    date: form.get("date") || toDateInput(new Date()),
    type,
    symbol,
    name: symbol,
    assetType: detectAssetType(symbol, symbol),
    quantity,
    price,
    gross,
    fee: Math.abs(parseNumber(form.get("fee"))),
    currency,
    source: "manual",
    notes: "",
  };
  state.transactions.push(transaction);
  saveState();
  dom.manualForm.reset();
  dom.manualForm.elements.date.value = toDateInput(new Date());
  render();
}

function addBondTransaction(event) {
  event.preventDefault();
  const form = new FormData(dom.bondForm);
  const code = String(form.get("bondType") || "").toUpperCase();
  const preset = BOND_PRESETS[code];
  if (!preset) return;
  const quantity = Math.abs(parseNumber(form.get("quantity")));
  if (!quantity) {
    window.alert(t("bond.enterQuantity"));
    return;
  }
  const purchaseDate = form.get("date") || toDateInput(new Date());
  const firstYearRate = parseNumber(form.get("firstYearRate")) || preset.firstYearRate;
  const margin = parseNumber(form.get("margin"));
  const maturityDate = form.get("maturity") || addMonthsToDate(purchaseDate, preset.termMonths);
  const series = String(form.get("series") || "").trim().toUpperCase() || bondSeriesCode(code, maturityDate);
  const bond = {
    code,
    presetName: preset.name,
    termMonths: preset.termMonths,
    firstYearRate,
    margin: Number.isFinite(margin) ? margin : preset.margin,
    indexation: preset.indexation,
    capitalization: preset.capitalization,
    nominal: BOND_NOMINAL,
    purchaseDate,
    maturityDate,
  };
  const transaction = {
    id: createId("bond"),
    portfolioId: form.get("portfolioId") || state.portfolios[0].id,
    date: purchaseDate,
    type: "buy",
    symbol: series,
    name: `Obligacje skarbowe ${code} ${series}`,
    assetType: "bond",
    quantity,
    price: BOND_NOMINAL,
    gross: quantity * BOND_NOMINAL,
    fee: 0,
    currency: "PLN",
    bond,
    source: "bond-manual",
    notes: bondHintText(preset),
  };
  state.transactions.push(transaction);
  saveState();
  dom.bondForm.reset();
  applyBondPreset();
  render();
}

function addMonthsToDate(dateStr, months) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() + Number(months || 0));
  return toDateInput(date);
}

function bondSeriesCode(code, maturityDate) {
  const date = new Date(maturityDate);
  if (Number.isNaN(date.getTime())) return code;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${code}${month}${year}`;
}

// Szacowana bieżąca wartość 1 sztuki obligacji = nominał + narosłe odsetki od daty zakupu.
// Dla obligacji indeksowanych inflacją brak danych CPI, więc używamy oprocentowania I roku
// jako przybliżenia (zgodnie z wyborem trybu wyceny).
function bondCurrentPrice(bond, asOf = new Date()) {
  const nominal = Number(bond.nominal) || BOND_NOMINAL;
  const start = new Date(bond.purchaseDate);
  if (Number.isNaN(start.getTime())) return nominal;
  const maturity = bond.maturityDate ? new Date(bond.maturityDate) : null;
  const reference = maturity && !Number.isNaN(maturity.getTime()) && asOf > maturity ? maturity : asOf;
  const years = Math.max(0, (reference - start) / (365.25 * 24 * 60 * 60 * 1000));
  const rate = (Number(bond.firstYearRate) || 0) / 100;
  if (!rate || !years) return nominal;
  if (bond.capitalization) {
    // Odsetki kapitalizowane rocznie – wartość rośnie składanie aż do wykupu.
    return nominal * Math.pow(1 + rate, years);
  }
  // Odsetki wypłacane okresowo – w danym okresie naliczają się liniowo i "wracają" do
  // nominału po wypłacie kuponu, więc liczymy tylko bieżący, nierozliczony rok.
  const fractionOfYear = years - Math.floor(years);
  return nominal * (1 + rate * fractionOfYear);
}

function clearData() {
  if (!window.confirm(t("confirm.clearAll"))) return;
  const locale = state.locale;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  state.locale = locale;
  importPreview = [];
  historyZoom = null;
  ensurePortfolio();
  saveState();
  render();
}

function buildBackupPayload() {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "librewallet-investment-tracker",
    data: { ...state },
  };
}

function parseBackupPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t("error.invalidJson"));
  }
  if (parsed?.format === BACKUP_FORMAT) {
    if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new Error(`Nieobsługiwana wersja kopii: ${parsed.formatVersion}.`);
    }
    return {
      exportedAt: parsed.exportedAt || "",
      state: normalizeStoredState(parsed.data),
    };
  }
  if (parsed?.version === 1 && Array.isArray(parsed.transactions)) {
    return { exportedAt: "", state: normalizeStoredState(parsed) };
  }
  throw new Error(t("error.backupFormat"));
}

function backupSummary(snapshot) {
  const quoteCount = Object.keys(snapshot.quoteHistory || {}).length;
  const parts = [
    `${snapshot.portfolios.length} portfeli`,
    `${snapshot.transactions.length} operacji`,
    `${quoteCount} historii cen`,
  ];
  return parts.join(", ");
}

function exportBackup() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `librewallet-backup-${toDateInput(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  if (dom.backupStatus) {
    dom.backupStatus.innerHTML = `<strong>${escapeHtml(t("backup.downloaded"))}</strong><small> ${escapeHtml(backupSummary(state))}</small>`;
  }
}

async function restoreBackup(file) {
  if (!dom.backupStatus) return;
  dom.backupStatus.innerHTML = `<strong>${escapeHtml(file.name)}</strong><small> Wczytywanie...</small>`;
  try {
    const raw = await file.text();
    const { exportedAt, state: restored } = parseBackupPayload(raw);
    const exportedLabel = exportedAt ? formatDateTime(exportedAt) : "nieznana data";
    const message = `Przywrócić kopię z ${exportedLabel}?\n\nZastąpi to obecne dane: ${backupSummary(state)}.\n\nNowa kopia: ${backupSummary(restored)}.`;
    if (!window.confirm(message)) {
      dom.backupStatus.innerHTML = `<strong>${escapeHtml(t("backup.cancelled"))}</strong>`;
      return;
    }
    state = restored;
    importPreview = [];
    historyZoom = null;
    if (!state.portfolios.length) ensurePortfolio();
    saveState();
    migratePortfolioGroups();
    render();
    setTab("import");
    dom.backupStatus.innerHTML = `<strong>${escapeHtml(t("backup.restored"))}</strong><small> ${escapeHtml(backupSummary(state))}</small>`;
  } catch (error) {
    dom.backupStatus.innerHTML = `<strong>${escapeHtml(t("backup.error"))}</strong><small> ${escapeHtml(error instanceof Error ? error.message : t("error.loadFile"))}</small>`;
  }
}

function exportTransactions() {
  const transactions = getScopedTransactions();
  const headers = [
    "date",
    "timestamp",
    "portfolio",
    "account",
    "externalId",
    "type",
    "symbol",
    "name",
    "assetType",
    "quantity",
    "price",
    "gross",
    "fee",
    "cashDelta",
    "currency",
    "source",
    "notes",
  ];
  const portfolioNames = new Map(state.portfolios.map((portfolio) => [portfolio.id, portfolio.name]));
  const csv = [
    headers.join(","),
    ...transactions.map((transaction) => {
      const row = {
        ...transaction,
        portfolio: portfolioNames.get(transaction.portfolioId) || "",
      };
      return headers.map((header) => csvEscape(row[header] ?? "")).join(",");
    }),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `librewallet-portfel-${toDateInput(new Date())}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function primaryMarkerType(transactions) {
  const types = new Set(transactions.map((transaction) => transaction.type || "other"));
  for (const type of MARKER_TYPE_PRIORITY) {
    if (types.has(type)) return type;
  }
  return "other";
}

function operationMarkerColor(type) {
  return OPERATION_MARKER_COLORS[type || "other"] || OPERATION_MARKER_COLORS.other;
}

function buildHistoryMarkers(transactions, visibleRows, enabled = true) {
  if (!enabled || !visibleRows?.length) return [];
  const rangeStart = visibleRows[0].date;
  const rangeEnd = visibleRows[visibleRows.length - 1].date;
  const grouped = new Map();
  transactions.forEach((transaction) => {
    if (!transaction.date || transaction.date < rangeStart || transaction.date > rangeEnd) return;
    if (!grouped.has(transaction.date)) grouped.set(transaction.date, []);
    grouped.get(transaction.date).push(transaction);
  });
  return Array.from(grouped.entries())
    .map(([date, dayTransactions]) => {
      const primaryType = primaryMarkerType(dayTransactions);
      return {
        date,
        timeMs: dateMs(date),
        transactions: dayTransactions.slice().sort(compareTransactions),
        primaryType,
        color: operationMarkerColor(primaryType),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function filterMarkersForDisplay(markers, plotWidth) {
  const denseThreshold = Math.max(14, Math.floor(plotWidth / 16));
  if (markers.length <= denseThreshold) return { markers, filtered: false };
  const significant = markers
    .map((marker) => {
      const transactions = marker.transactions.filter((transaction) =>
        SIGNIFICANT_MARKER_TYPES.has(transaction.type || "other"),
      );
      const primaryType = primaryMarkerType(transactions);
      return {
        ...marker,
        transactions,
        primaryType,
        color: operationMarkerColor(primaryType),
      };
    })
    .filter((marker) => marker.transactions.length);
  if (significant.length >= Math.min(markers.length * 0.3, 10)) {
    return { markers: significant, filtered: true };
  }
  return { markers, filtered: false };
}

function clusterMarkerDrawItems(markers, markerX, clusterGap) {
  const items = markers
    .map((marker, markerIndex) => ({ marker, markerIndex, x: markerX(marker.timeMs) }))
    .sort((a, b) => a.x - b.x);
  const clusters = [];
  let cluster = null;
  items.forEach((item) => {
    if (!cluster || item.x - cluster.x > clusterGap) {
      cluster = {
        x: item.x,
        markerIndices: [item.markerIndex],
        markers: [item.marker],
        transactions: [...item.marker.transactions],
        dates: [item.marker.date],
      };
      clusters.push(cluster);
    } else {
      const count = cluster.markerIndices.length;
      cluster.x = (cluster.x * count + item.x) / (count + 1);
      cluster.markerIndices.push(item.markerIndex);
      cluster.markers.push(item.marker);
      cluster.transactions.push(...item.marker.transactions);
      if (!cluster.dates.includes(item.marker.date)) cluster.dates.push(item.marker.date);
    }
  });
  return clusters.map((cluster) => {
    const primaryType = primaryMarkerType(cluster.transactions);
    return {
      ...cluster,
      primaryType,
      color: operationMarkerColor(primaryType),
      isCluster: cluster.markerIndices.length > 1,
      count: cluster.transactions.length,
    };
  });
}

function layoutMarkerDrawItems(drawItems, minGap) {
  const laneEnds = [];
  return drawItems.map((item, drawIndex) => {
    let lane = 0;
    while (lane < laneEnds.length && Math.abs(item.x - laneEnds[lane]) < minGap) lane += 1;
    if (lane >= MARKER_MAX_LANES) lane = MARKER_MAX_LANES - 1;
    if (lane === laneEnds.length) laneEnds.push(item.x);
    else laneEnds[lane] = item.x;
    return { ...item, drawIndex, lane };
  });
}

function prepareHistoryMarkerDrawItems(markers, markerX, plotWidth) {
  const { markers: visibleMarkers, filtered } = filterMarkersForDisplay(markers, plotWidth);
  const compact = visibleMarkers.length > Math.max(12, Math.floor(plotWidth / 14));
  const clusterGap = compact ? 8 : 12;
  const drawItems = clusterMarkerDrawItems(visibleMarkers, markerX, clusterGap);
  const laneGap = compact ? 7 : 11;
  const layout = layoutMarkerDrawItems(drawItems, laneGap);
  return { layout, compact, filtered };
}

function formatHistoryMarkerTooltip(drawItem) {
  const showPortfolio = state.selectedPortfolioId === "all";
  const portfolioNames = new Map(state.portfolios.map((portfolio) => [portfolio.id, portfolio.name]));
  const transactions = drawItem.transactions || [];
  const dates = (drawItem.dates || []).slice().sort();
  let title = "";
  if (dates.length > 1) {
    title = `${formatAxisDate(dateMs(dates[0]))} – ${formatAxisDate(dateMs(dates[dates.length - 1]))}`;
  } else if (dates.length === 1) {
    title = formatAxisDate(dateMs(dates[0]));
  } else if (drawItem.marker?.date) {
    title = formatAxisDate(dateMs(drawItem.marker.date));
  }
  const summary =
    transactions.length > 1 ? `<div class="chart-tooltip-more">${transactions.length} operacji</div>` : "";
  const rows = transactions
    .slice(0, 10)
    .map((transaction) => {
      const label = operationLabel(transaction.type);
      const symbol = transaction.symbol || transaction.name || "";
      const portfolio = showPortfolio ? portfolioNames.get(transaction.portfolioId) || "" : "";
      const detail = [label, symbol, portfolio].filter(Boolean).join(" · ");
      return chartTooltipRow(detail, formatMoney(transaction.gross, transaction.currency), operationMarkerColor(transaction.type));
    })
    .join("");
  const more =
    transactions.length > 10
      ? `<div class="chart-tooltip-more">+${transactions.length - 10} kolejnych operacji</div>`
      : "";
  return `<strong>${escapeHtml(title)}</strong>${summary}${rows}${more}`;
}

function historyMarkerAtPosition(plot, localX, localY) {
  if (!plot?.markerHits?.length) return -1;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  plot.markerHits.forEach((hit) => {
    const halfW = hit.width / 2 + 3;
    const halfH = hit.height / 2 + 3;
    if (Math.abs(localX - hit.x) > halfW || Math.abs(localY - hit.y) > halfH) return;
    const distance = Math.hypot(localX - hit.x, localY - hit.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = hit.drawIndex;
    }
  });
  return bestIndex;
}

function drawMarkerPill(context, x, y, color, width, height, highlighted) {
  const w = Math.max(3, width);
  const h = Math.max(8, height);
  const radius = Math.min(w / 2, h / 2);
  context.save();
  context.fillStyle = highlighted ? color : `${color}d9`;
  context.strokeStyle = highlighted ? "#202124" : color;
  context.lineWidth = highlighted ? 1.5 : 1;
  context.beginPath();
  context.moveTo(x - w / 2 + radius, y - h / 2);
  context.lineTo(x + w / 2 - radius, y - h / 2);
  context.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + radius);
  context.lineTo(x + w / 2, y + h / 2 - radius);
  context.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - radius, y + h / 2);
  context.lineTo(x - w / 2 + radius, y + h / 2);
  context.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - radius);
  context.lineTo(x - w / 2, y - h / 2 + radius);
  context.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + radius, y - h / 2);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawHistoryOperationMarkers(context, markers, markerX, padding, plotWidth, plotHeight, options) {
  const plotBottom = padding.top + plotHeight;
  const stripTop = plotBottom + 5;
  const { layout, compact, filtered } = prepareHistoryMarkerDrawItems(markers, markerX, plotWidth);
  const hits = [];
  const hoverDrawIndex = Number.isInteger(options.hoverMarkerIndex) ? options.hoverMarkerIndex : -1;

  context.save();
  context.strokeStyle = "#e8e5dc";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding.left, plotBottom + 1);
  context.lineTo(padding.left + plotWidth, plotBottom + 1);
  context.stroke();
  context.restore();

  layout.forEach((item) => {
    if (item.x < padding.left - 8 || item.x > padding.left + plotWidth + 8) return;
    const isHover = hoverDrawIndex === item.drawIndex;
    const laneY = stripTop + 8 + item.lane * MARKER_LANE_HEIGHT;
    const pillWidth = item.isCluster ? Math.min(22, 8 + item.count * 2) : compact ? 4 : 6;
    const pillHeight = compact ? 10 : 13;

    if (isHover) {
      context.save();
      context.strokeStyle = "rgba(32, 33, 36, 0.18)";
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(item.x, padding.top);
      context.lineTo(item.x, plotBottom);
      context.stroke();
      context.restore();
    }

    drawMarkerPill(context, item.x, laneY, item.color, pillWidth, pillHeight, isHover);

    if ((item.isCluster || item.count > 1) && pillWidth >= 10) {
      context.save();
      context.fillStyle = "#fff";
      context.font = `700 ${compact ? 8 : 9}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(item.count), item.x, laneY + 0.5);
      context.restore();
    }

    hits.push({
      drawIndex: item.drawIndex,
      x: item.x,
      y: laneY,
      width: Math.max(pillWidth, 12),
      height: pillHeight + 6,
      item,
    });
  });

  return {
    hits,
    drawItems: layout,
    markerStripHeight: MARKER_STRIP_HEIGHT,
    markerFiltered: filtered,
    markerCompact: compact,
  };
}

function drawLineChart(canvas, data, options) {
  const context = prepareCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  clearCanvas(context, width, height);
  if (!data.length) {
    drawEmptyChart(context, width, height, "Brak historii");
    return null;
  }

  const values = data.flatMap((item) => {
    const rowValues = [item[options.primaryKey], item[options.secondaryKey]];
    if (options.tertiaryKey) {
      const tertiary = Number(item[options.tertiaryKey]);
      if (Number.isFinite(tertiary) && tertiary > 0) rowValues.push(tertiary);
    }
    return rowValues;
  });
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  context.font = "12px system-ui";
  const yLabels = Array.from({ length: 5 }, (_, index) => {
    const value = max - ((max - min) * index) / 4;
    return compactMoney(value, options.currency);
  });
  const labelWidth = Math.max(...yLabels.map((label) => context.measureText(label).width));
  const hasMarkers = options.showMarkers && options.markers?.length;
  const padding = {
    top: 22,
    right: 18,
    bottom: 48 + (hasMarkers ? MARKER_STRIP_HEIGHT : 0),
    left: Math.min(112, Math.max(74, Math.ceil(labelWidth) + 14)),
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const y = (value) => padding.top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;
  // Oś X proporcjonalna do czasu, żeby przerwy między operacjami były widoczne, a kapitał
  // mógł stać płasko przez realny czas między wpłatami.
  const times = data.map((item) => {
    const parsed = Date.parse(item.date);
    return Number.isNaN(parsed) ? null : parsed;
  });
  const valid = times.filter((time) => time !== null);
  const tMin = valid.length ? Math.min(...valid) : 0;
  const tMax = valid.length ? Math.max(...valid) : 0;
  const x = (index) => {
    const time = times[index];
    if (data.length === 1) return padding.left;
    if (time === null || tMax === tMin) return padding.left + (index / (data.length - 1)) * plotWidth;
    return padding.left + ((time - tMin) / (tMax - tMin)) * plotWidth;
  };

  context.strokeStyle = "#dedbd2";
  context.lineWidth = 1;
  context.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const lineY = padding.top + (i / 4) * plotHeight;
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
  }
  context.stroke();

  context.strokeStyle = "#f0eee6";
  context.fillStyle = "#686b6f";
  context.font = "12px system-ui";
  context.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const tickX = padding.left + (i / 4) * plotWidth;
    context.moveTo(tickX, padding.top);
    context.lineTo(tickX, padding.top + plotHeight);
  }
  context.stroke();

  // Wkład własny zmienia się tylko przy wpłatach/wypłatach – stąd linia schodkowa (płaska
  // między operacjami, pionowy skok w dniu wpłaty).
  drawLine(context, steppedPoints(data.map((item, index) => [x(index), y(item[options.secondaryKey])])), "#a56b13", 2);
  if (options.tertiaryKey) {
    const benchmarkPath = portfolioValuePath(data, x, y, options.tertiaryKey, options.secondaryKey).filter(
      ([, pointY]) => Number.isFinite(pointY),
    );
    if (benchmarkPath.length) {
      drawDashedLine(context, benchmarkPath, options.tertiaryColor || "#22577a", 2.5);
    }
  }
  // Wartość portfela: między operacjami liniowa (dryf rynkowy/odsetki), a w dniu zmiany wkładu
  // (wpłata/wypłata/zakup obligacji) pionowy skok o kwotę tej zmiany – wpłata od razu podnosi
  // zarówno wkład, jak i wartość portfela.
  drawLine(context, portfolioValuePath(data, x, y, options.primaryKey, options.secondaryKey), "#176b4d", 3);

  context.fillStyle = "#686b6f";
  context.font = "12px system-ui";
  context.textAlign = "right";
  yLabels.forEach((label, index) => {
    context.fillText(label, padding.left - 8, padding.top + (index / 4) * plotHeight + 4);
  });
  for (let i = 0; i <= 4; i += 1) {
    const tickX = padding.left + (i / 4) * plotWidth;
    const tickTime = tMin + ((tMax - tMin) * i) / 4;
    context.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
    context.fillText(formatAxisDate(tickTime), tickX, height - 18);
  }

  const markerX = (timeMs) => {
    if (tMax === tMin) return padding.left;
    return padding.left + ((timeMs - tMin) / (tMax - tMin)) * plotWidth;
  };
  let markerHits = [];
  let markerDrawItems = [];
  let markerStripHeight = 0;
  let markerFiltered = false;
  if (hasMarkers) {
    const markerLayer = drawHistoryOperationMarkers(context, options.markers, markerX, padding, plotWidth, plotHeight, options);
    markerHits = markerLayer.hits;
    markerDrawItems = markerLayer.drawItems;
    markerStripHeight = markerLayer.markerStripHeight;
    markerFiltered = markerLayer.markerFiltered;
  }

  const hoverIndex = Number.isInteger(options.hoverIndex) ? options.hoverIndex : -1;
  const hoverMarkerIndex = Number.isInteger(options.hoverMarkerIndex) ? options.hoverMarkerIndex : -1;
  if (hoverIndex >= 0 && hoverMarkerIndex < 0 && data[hoverIndex]) {
    const hoverRow = data[hoverIndex];
    const crossX = x(hoverIndex);
    context.save();
    context.strokeStyle = "rgba(32, 33, 36, 0.22)";
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(crossX, padding.top);
    context.lineTo(crossX, padding.top + plotHeight);
    context.stroke();
    context.restore();
    drawChartMarker(context, crossX, y(hoverRow[options.primaryKey]), "#176b4d");
    drawChartMarker(context, crossX, y(hoverRow[options.secondaryKey]), "#a56b13");
    if (options.tertiaryKey) {
      const benchmarkValue = Number(hoverRow[options.tertiaryKey]);
      if (Number.isFinite(benchmarkValue) && benchmarkValue > 0) {
        drawChartMarker(context, crossX, y(benchmarkValue), options.tertiaryColor || "#22577a");
      }
    }
  }

  return {
    padding,
    plotWidth,
    plotHeight,
    tMin,
    tMax,
    times,
    data,
    markerHits,
    markerDrawItems,
    markerStripHeight,
    markerFiltered,
  };
}

// Ścieżka linii wartości portfela: liniowo między operacjami (dryf rynkowy/odsetki), a w dniu
// zmiany wkładu (wpłata/wypłata/zakup obligacji) pionowy skok o kwotę tej zmiany. Skok jest
// rysowany jako odcinek pionowy, więc wartość „doskakuje” jak wkład, zamiast piąć się ukośnie.
function portfolioValuePath(data, x, y, valueKey, investedKey) {
  const points = [];
  data.forEach((item, index) => {
    if (index === 0) {
      points.push([x(index), y(item[valueKey])]);
      return;
    }
    const contributionJump = (item[investedKey] || 0) - (data[index - 1][investedKey] || 0);
    if (Math.abs(contributionJump) > 0.005) {
      const preValue = item[valueKey] - contributionJump; // wartość tuż przed operacją (sam dryf)
      points.push([x(index), y(preValue)]);
      points.push([x(index), y(item[valueKey])]);
    } else {
      points.push([x(index), y(item[valueKey])]);
    }
  });
  return points;
}

// Zamienia punkty na ścieżkę schodkową (step-after): trzyma poprzednią wartość aż do
// kolejnej daty, potem pionowy skok do nowej wartości.
function steppedPoints(points) {
  const stepped = [];
  points.forEach((point, index) => {
    if (index === 0) {
      stepped.push(point);
      return;
    }
    const previousY = points[index - 1][1];
    stepped.push([point[0], previousY]);
    stepped.push(point);
  });
  return stepped;
}

function drawLine(context, points, color, width) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function drawDashedLine(context, points, color, width) {
  context.save();
  context.setLineDash([7, 5]);
  drawLine(context, points, color, width);
  context.restore();
}

function drawChartMarker(context, x, y, color) {
  context.fillStyle = "#fff";
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, 5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawDoughnutChart(canvas, items, currency, options = {}) {
  const context = prepareCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  clearCanvas(context, width, height);
  const filtered = items.filter((item) => item.value > 0);
  if (!filtered.length) {
    drawEmptyChart(context, width, height, "Brak alokacji");
    return null;
  }

  const total = filtered.reduce((sum, item) => sum + item.value, 0);
  const radius = Math.min(width * 0.44, height * 0.44, 124);
  const innerRadius = radius * 0.58;
  const centerX = width / 2;
  const centerY = height / 2;
  let start = -Math.PI / 2;
  let cursorFraction = 0;
  const segments = [];

  filtered.forEach((item, index) => {
    const angle = (item.value / total) * Math.PI * 2;
    const isHover = options.hoverIndex === index;
    const outerRadius = isHover ? radius + 6 : radius;
    segments.push({
      index,
      startFraction: cursorFraction,
      endFraction: cursorFraction + item.value / total,
    });
    cursorFraction += item.value / total;
    context.beginPath();
    context.arc(centerX, centerY, outerRadius, start, start + angle);
    context.arc(centerX, centerY, innerRadius, start + angle, start, true);
    context.closePath();
    context.fillStyle = item.color;
    context.fill();
    if (isHover) {
      context.strokeStyle = "#202124";
      context.lineWidth = 2;
      context.stroke();
    }
    start += angle;
  });

  return { centerX, centerY, radius, innerRadius, segments };
}

function drawBarChart(canvas, items, currency, options = {}) {
  const context = prepareCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  clearCanvas(context, width, height);
  const filtered = items.filter((item) => Math.abs(item.value) > 0.001);
  if (!filtered.length) {
    drawEmptyChart(context, width, height, "Brak wyniku");
    return null;
  }

  const padding = { top: 20, right: 22, bottom: 20, left: 94 };
  const max = Math.max(1, ...filtered.map((item) => Math.abs(item.value)));
  const rowHeight = (height - padding.top - padding.bottom) / filtered.length;
  const zeroX = padding.left + (width - padding.left - padding.right) / 2;
  context.strokeStyle = "#dedbd2";
  context.beginPath();
  context.moveTo(zeroX, padding.top);
  context.lineTo(zeroX, height - padding.bottom);
  context.stroke();

  filtered.forEach((item, index) => {
    const y = padding.top + index * rowHeight + rowHeight * 0.25;
    const barWidth = (Math.abs(item.value) / max) * ((width - padding.left - padding.right) / 2 - 8);
    const x = item.value >= 0 ? zeroX : zeroX - barWidth;
    const isHover = options.hoverIndex === index;
    context.fillStyle = item.value >= 0 ? "#176b4d" : "#af3636";
    context.globalAlpha = isHover ? 1 : options.hoverIndex == null || options.hoverIndex < 0 ? 1 : 0.45;
    context.fillRect(x, y, barWidth, Math.max(8, rowHeight * 0.46));
    context.globalAlpha = 1;
    if (isHover) {
      context.strokeStyle = "#202124";
      context.lineWidth = 1.5;
      context.strokeRect(x, y, barWidth, Math.max(8, rowHeight * 0.46));
    }
    context.fillStyle = "#202124";
    context.font = "700 12px system-ui";
    context.textAlign = "right";
    context.fillText(item.label, padding.left - 10, y + rowHeight * 0.32);
    context.textAlign = item.value >= 0 ? "left" : "right";
    context.fillStyle = "#686b6f";
    context.fillText(compactMoney(item.value, currency), item.value >= 0 ? x + barWidth + 6 : x - 6, y + rowHeight * 0.32);
  });

  return { padding, rowHeight };
}

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function isCanvasDrawable(canvas) {
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  return rect.width > 20 && rect.height > 20;
}

function clearCanvas(context, width, height) {
  context.clearRect(0, 0, width, height);
}

function drawEmptyChart(context, width, height, text) {
  context.fillStyle = "#f0eee6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#686b6f";
  context.font = "700 14px system-ui";
  context.textAlign = "center";
  context.fillText(text, width / 2, height / 2);
}

function drawLegend(context, x, y, items) {
  context.textAlign = "left";
  items.forEach((item, index) => {
    const offset = index * 88;
    context.fillStyle = item.color;
    context.fillRect(x + offset, y, 10, 10);
    context.fillStyle = "#686b6f";
    context.font = "12px system-ui";
    context.fillText(item.label, x + offset + 16, y + 10);
  });
}

function addCash(cash, currency, amount) {
  cash.set(currency, (cash.get(currency) || 0) + amount);
}

function convert(amount, fromCurrency = "PLN", toCurrency = "PLN") {
  return convertAt(amount, fromCurrency, toCurrency);
}

function convertAt(amount, fromCurrency = "PLN", toCurrency = "PLN", asOf = "") {
  const from = fxRateAt(fromCurrency, asOf);
  const to = fxRateAt(toCurrency, asOf);
  return (amount * from) / to;
}

function fxRateAt(currency = "PLN", asOf = "") {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "PLN") return 1;
  const historicalRate = asOf ? valueAtOrBefore(state.fxHistory?.[normalized]?.rates, asOf) : 0;
  if (historicalRate > 0) return historicalRate;
  return state.fxRates[normalized] || DEFAULT_FX[normalized] || 1;
}

function normalizeCurrencyCode(currency = "PLN") {
  const normalized = String(currency || "PLN").trim().toUpperCase();
  if (normalized === "GBP" || normalized === "GBX" || normalized === "GBP=X") return "GBP";
  return normalized || "PLN";
}

function normalizeQuotedPrice(price, currency = "PLN") {
  const normalized = String(currency || "PLN").trim();
  if (/^(GBp|GBX)$/i.test(normalized)) {
    return { price: Number(price) / 100, currency: "GBP" };
  }
  return { price: Number(price), currency: normalizeCurrencyCode(normalized) };
}

function rowsToValueMap(rows, field = "close") {
  return rows.reduce((map, row) => {
    const date = String(row.date || "").slice(0, 10);
    const value = Number(row[field]);
    if (date && Number.isFinite(value) && value > 0) map[date] = value;
    return map;
  }, {});
}

function valueAtOrBefore(values, asOf) {
  if (!values || !asOf) return 0;
  const direct = Number(values[asOf]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  let bestDate = "";
  Object.keys(values).forEach((date) => {
    if (date <= asOf && date > bestDate) bestDate = date;
  });
  const value = Number(values[bestDate]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function dateMs(dateText) {
  const parsed = Date.parse(`${dateText}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Date.parse(dateText);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function earliestTransactionDate(transactions) {
  return transactions
    .map((transaction) => transaction.date)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0] || "";
}

function isoDateRange(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = addIsoDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function addIsoDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compressTimeline(rows) {
  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function filterHistory(rows, mode) {
  if (mode === "all" || rows.length < 2) return rows;
  const days = mode === "year" ? 365 : 92;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffText = toDateInput(cutoff);
  return rows.filter((row) => row.date >= cutoffText);
}

function groupValue(position, groupBy) {
  if (groupBy === "currency") return position.currency;
  if (groupBy === "portfolio") return position.portfoliosLabel || "";
  return assetTypeLabel(position.assetType);
}

function assetTypeOptions(selected) {
  return getAssetTypeEntries()
    .filter(([key]) => key !== "cash")
    .map(([key, label]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function operationLabel(type) {
  const key = type && t(`tx.${type}`) !== `tx.${type}` ? type : "other";
  return t(`tx.${key}`);
}

function assetKeyFor(symbol, currency) {
  return `${String(symbol || "").toUpperCase()}|${currency || "PLN"}`;
}

function priceKey(position) {
  return assetKeyFor(position.symbol, position.currency);
}

function transactionFingerprint(transaction) {
  if (transaction.source === "XTB import" && transaction.account && transaction.externalId) {
    return ["xtb", transaction.account, transaction.externalId, transaction.currency].join("|");
  }
  return [
    transaction.portfolioId,
    transaction.date,
    transaction.timestamp,
    transaction.externalId,
    transaction.type,
    transaction.symbol,
    roundInput(transaction.quantity),
    roundInput(transaction.price),
    roundInput(transaction.gross),
    roundInput(transaction.fee),
    roundInput(transaction.cashDelta),
    transaction.currency,
  ].join("|");
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function nextPortfolioColor() {
  const colors = ["#176b4d", "#22577a", "#a56b13", "#5c4f82", "#af3636"];
  return colors[state.portfolios.length % colors.length];
}

function currencyPortfolioColor(currency) {
  return {
    PLN: "#176b4d",
    EUR: "#22577a",
    USD: "#a56b13",
    GBP: "#5c4f82",
    CHF: "#af3636",
  }[currency] || nextPortfolioColor();
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "portfolio";
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value ?? "").trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || text.includes("-");
  text = text.replace(/\s|%|PLN|EUR|USD|GBP|CHF/gi, "");
  text = text.replace(/[^\d,.-]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    text = text.replace(",", ".");
  }
  text = text.replace(/(?!^)-/g, "");
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
}

function parseExcelSerial(value) {
  const serial = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(serial) || serial <= 20000 || serial >= 100000) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  excelEpoch.setUTCDate(excelEpoch.getUTCDate() + wholeDays);
  excelEpoch.setUTCMilliseconds(excelEpoch.getUTCMilliseconds() + Math.round(fraction * 86400000));
  return Number.isNaN(excelEpoch.valueOf()) ? null : excelEpoch;
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return toDateInput(value);
  const excelDate = parseExcelSerial(value);
  if (excelDate) return toDateInput(excelDate);
  const text = String(value ?? "").trim();
  if (!text) return "";
  const isoMatch = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const dotMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const excelFromText = parseExcelSerial(text);
  if (excelFromText) return toDateInput(excelFromText);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) return toDateInput(parsed);
  return "";
}

function parseDateTimeValue(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${toDateInput(value)} ${toTimeInput(value)}`;
  }
  const excelDateTime = parseExcelSerial(value);
  if (excelDateTime) {
    return `${toDateInput(excelDateTime)} ${toTimeInput(excelDateTime)}`;
  }
  const text = String(value ?? "").trim();
  if (!text) return "";
  const isoMatch = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const [, year, month, day, hour = "0", minute = "0", second = "0"] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`;
  }
  const dotMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dotMatch) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = dotMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`;
  }
  const excelFromText = parseExcelSerial(text);
  if (excelFromText) {
    return `${toDateInput(excelFromText)} ${toTimeInput(excelFromText)}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) return `${toDateInput(parsed)} ${toTimeInput(parsed)}`;
  return "";
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeInput(date) {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${hour}:${minute}:${second}`;
}

function cleanSymbol(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[-–]+$/, "")
    .toUpperCase();
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function cleanCurrency(value) {
  const text = String(value ?? "").trim().toUpperCase();
  const match = text.match(/\b(PLN|EUR|USD|GBP|CHF|CZK|SEK|NOK|DKK)\b/);
  return match ? match[1] : "";
}

function detectCurrency(text) {
  return cleanCurrency(text);
}

function inferCurrencyFromSource(sourceName = "") {
  const fileName = String(sourceName).split(/[\\/]/).pop() || "";
  const prefix = fileName.match(/^([A-Z]{3})[_-]/i);
  if (prefix) return cleanCurrency(prefix[1]);
  if (/^IKE[_-]/i.test(fileName) || /^IKZE[_-]/i.test(fileName)) return "PLN";
  const embedded = fileName.match(/[_-](PLN|EUR|USD|GBP|CHF)[_-]/i);
  if (embedded) return cleanCurrency(embedded[1]);
  return cleanCurrency(fileName);
}

function inferAccountFromSource(sourceName = "") {
  const fileName = String(sourceName).split(/[\\/]/).pop() || "";
  const typedPrefix = fileName.match(/^(?:PLN|EUR|USD|GBP|CHF|IKE|IKZE)_(\d{6,})/i);
  if (typedPrefix) return typedPrefix[1];
  const leading = fileName.match(/^(\d{6,})[_-]/);
  if (leading) return leading[1];
  const embedded = fileName.match(/[_-](\d{6,})[_-]/);
  return embedded ? embedded[1] : "";
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ");
}

function formatMoney(value, currency = "PLN") {
  const formatter = new Intl.NumberFormat(window.LW_I18N.intlLocale(), {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  });
  return formatter.format(value || 0);
}

function compactMoney(value, currency = "PLN") {
  const abs = Math.abs(value || 0);
  const suffix = abs >= 1_000_000 ? t("number.million") : abs >= 1_000 ? t("number.thousand") : "";
  const scaled = abs >= 1_000_000 ? value / 1_000_000 : abs >= 1_000 ? value / 1_000 : value;
  return `${new Intl.NumberFormat(window.LW_I18N.intlLocale(), { maximumFractionDigits: 1 }).format(scaled)}${suffix} ${currency}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat(window.LW_I18N.intlLocale(), { maximumFractionDigits: 4 }).format(value || 0);
}

function formatPercent(value) {
  return `${new Intl.NumberFormat(window.LW_I18N.intlLocale(), { maximumFractionDigits: 1 }).format(value || 0)}%`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value || "");
  return new Intl.DateTimeFormat(window.LW_I18N.intlLocale(), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatAxisDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(window.LW_I18N.intlLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function roundInput(value) {
  return Number(value || 0).toFixed(4).replace(/\.?0+$/, "");
}

function emptyRow(colspan) {
  return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(t("empty.noData"))}</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function currencyColor(currency) {
  return {
    PLN: "#176b4d",
    EUR: "#22577a",
    USD: "#a56b13",
    GBP: "#5c4f82",
    CHF: "#af3636",
  }[currency] || "#686b6f";
}
