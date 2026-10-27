import { api } from "../api.js";
import { bars, donut, lineChart, PALETTE } from "../charts.js";
import { h } from "../dom.js";
import { dateTime, money, pct, signed, tone } from "../format.js";
import { assetLabel, t } from "../i18n.js";
import { empty, guarded, kpi, panel, select, table } from "../widgets.js";

const RANGES = [["all", "history.all"], ["1y", "history.1y"], ["quarter", "history.quarter"], ["ytd", "history.ytd"]];
const state = { range: "all", showOps: true, zoom: null };

function sliceByPreset(rows, preset) {
  if (preset === "all" || rows.length === 0) return rows;
  const last = new Date(rows[rows.length - 1].dayKey + "T00:00:00");
  const start = preset === "ytd" ? new Date(last.getFullYear(), 0, 1) : new Date(last.getFullYear(), last.getMonth() - (preset === "1y" ? 12 : 3), last.getDate());
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return rows.filter((r) => r.dayKey >= key);
}

function sliceByZoom(rows, zoom) {
  if (!zoom || rows.length === 0) return rows;
  return rows.filter((r) => r.dayKey >= zoom.start && r.dayKey <= zoom.end);
}

function dayMs(key) {
  return new Date(key + "T00:00:00").getTime();
}

function zoomAround(rows, factor) {
  if (rows.length < 2) return null;
  const fullStart = rows[0].dayKey, fullEnd = rows[rows.length - 1].dayKey;
  const current = state.zoom ?? { start: fullStart, end: fullEnd };
  const c0 = dayMs(current.start), c1 = dayMs(current.end);
  const center = (c0 + c1) / 2;
  const half = Math.max(86400_000 * 7, ((c1 - c0) / 2) * factor);
  const f0 = dayMs(fullStart), f1 = dayMs(fullEnd);
  const start = Math.min(f1, Math.max(f0, center - half));
  const end = Math.min(f1, Math.max(f0, center + half));
  const toKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return { start: toKey(start), end: toKey(end) };
}

export async function render(root, app) {
  const benchId = app.boot.settings.selectedBenchmark;
  const d = await api.get(`/api/dashboard?scope=${encodeURIComponent(app.scope)}&benchmark=${encodeURIComponent(benchId)}`);
  const s = d.scope;
  const ccy = s.baseCurrency;

  const reload = () => app.refresh();
  root.append(
    h("header", { class: "top" }, h("h1", {}, app.scopeTitle()), h("span", { class: "muted" }, d.quoteStatus.newest ? t("dash.quotesAt", { when: dateTime(d.quoteStatus.newest) }) : t("dash.noQuotes")),
      h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: () => app.refreshPrices() }, t("ui.refresh"))));

  if (app.boot.portfolios.length === 0) {
    root.append(panel(null, empty(t("ui.noPortfolios")), h("div", { style: { textAlign: "center" } }, h("button", { class: "btn primary", onclick: () => app.navigate("import") }, t("nav.import")))));
    return;
  }

  root.append(h("div", { class: "kpis" },
    kpi(t("kpi.value"), money(s.totalValue, ccy)),
    kpi(t("kpi.profit"), signed(s.totalProfit, (v) => money(v, ccy)), tone(s.totalProfit)),
    kpi(t("kpi.return"), signed(s.returnPct, (v) => pct(v, 2)), tone(s.returnPct)),
    kpi(t("kpi.invested"), money(s.netInvested, ccy)),
    s.hasCashOperations ? kpi(t("dash.cash"), money(s.cashValue, ccy)) : null));

  const chartHost = h("div");
  const domainLabel = h("span", { class: "muted" });
  const draw = () => {
    const base = sliceByPreset(d.history, state.range);
    const rows = sliceByZoom(base, state.zoom);
    chartHost.replaceChildren();
    if (rows.length < 2) { chartHost.append(empty(t("dash.noHistory"))); domainLabel.textContent = ""; return; }
    domainLabel.textContent = `${rows[0].dayKey} – ${rows[rows.length - 1].dayKey}`;
    const series = [
      { key: "value", label: t("dash.valueLine"), color: "#2e7d5b", area: true },
      { key: "invested", label: t("dash.investedLine"), color: "#b8731c" },
      ...(d.hasBenchmark ? [{ key: "benchmark", label: t("dash.benchmarkLine"), color: "#7f8c8d", dashed: true }] : []),
    ];
    const markers = state.showOps ? d.markers : [];
    chartHost.append(lineChart({ rows, series, currency: ccy, markers }),
      h("div", { class: "legend-inline" }, series.map((x) => h("span", {}, h("span", { class: "dot", style: { background: x.color } }), x.label)),
        state.showOps ? h("span", {}, h("span", { class: "dot", style: { background: "#3b6fb6" } }), t("dash.operations")) : null));
  };
  const chips = h("div", { class: "chips" }, RANGES.map(([id, key]) => h("button", { class: `chip ${state.range === id ? "active" : ""}`, onclick: (e) => {
    state.range = id;
    state.zoom = null;
    e.target.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    e.target.classList.add("active");
    draw();
  } }, t(key))));
  const benchSelect = select(app.boot.benchmarks.map((b) => ({ value: b.id, label: b.id === "" ? t("ui.none") : b.label })), benchId, async (v) => {
    if (await guarded(() => api.put("/api/settings", { selectedBenchmark: v }))) await app.refresh();
  });
  const histBtn = h("button", { class: "btn", onclick: async (e) => {
    e.target.disabled = true;
    if (await guarded(() => api.post("/api/refresh/histories"), t("feedback.chartRefreshed"))) await reload();
    e.target.disabled = false;
  } }, t("dashboard.chartRefresh"));
  root.append(panel(t("dashboard.history"),
    h("div", { class: "toolbar" }, chips, h("span", { class: "grow" }),
      h("label", { class: "muted" }, h("input", { type: "checkbox", checked: state.showOps, onchange: (e) => { state.showOps = e.target.checked; draw(); } }), ` ${t("dash.operations")}`),
      h("label", { class: "muted" }, `${t("dash.benchmark")} `, benchSelect),
      domainLabel,
      h("button", { class: "btn", title: t("dash.zoomOut"), onclick: () => { state.zoom = zoomAround(sliceByPreset(d.history, state.range), 1.4); draw(); } }, "−"),
      h("button", { class: "btn", title: t("dash.zoomIn"), onclick: () => { state.zoom = zoomAround(sliceByPreset(d.history, state.range), 0.7); draw(); } }, "+"),
      histBtn),
    d.benchmarkError ? h("div", { class: "warn" }, t("dash.benchmarkError", { error: d.benchmarkError })) : null,
    chartHost));
  draw();

  const typeSlices = Object.entries(s.allocationByType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: assetLabel(k), value: v, color: PALETTE[i % PALETTE.length] }));
  const ccySlices = Object.entries(s.allocationByCurrency).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: PALETTE[(i + 3) % PALETTE.length] }));
  root.append(h("div", { class: "grid2" },
    panel(t("dashboard.allocation"), typeSlices.length ? donut({ slices: typeSlices, currency: ccy }) : empty(t("dashboard.noData"))),
    panel(t("dashboard.fx"), ccySlices.length ? donut({ slices: ccySlices }) : empty(t("dashboard.noData")))));

  root.append(h("div", { class: "grid2" },
    panel(t("dashboard.profitChart"), d.profitBars.length ? bars({ items: d.profitBars.map((p) => ({ label: p.symbol, value: p.profit })), currency: ccy }) : empty(t("dashboard.noData"))),
    panel(t("dashboard.portfolioCompare"), table({
      cols: [
        { label: t("ui.portfolio"), render: (r) => h("span", {}, h("span", { class: "dot", style: { background: r.colorHex } }), r.name) },
        { label: t("kpi.value"), num: true, render: (r) => money(r.value, r.currency) },
        { label: t("kpi.return"), num: true, cls: (r) => tone(r.returnPct), render: (r) => signed(r.returnPct, (v) => pct(v, 2)) },
      ],
      rows: d.comparison,
    }))));
}
