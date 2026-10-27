import { api } from "../api.js";
import { h } from "../dom.js";
import { dateTime, money, number, pct, signed, tone } from "../format.js";
import { assetLabel, t } from "../i18n.js";
import { confirmDialog, empty, formDialog, guarded, kpi, panel, select, table } from "../widgets.js";

const state = { groupBy: "none", showClosed: false };
const PERIODS = ["1M", "3M", "6M", "1Y", "YTD"];

export async function render(root, app) {
  const d = await api.get(`/api/positions?scope=${encodeURIComponent(app.scope)}`);
  const s = d.scope;
  const open = d.positions.filter((p) => Math.abs(p.quantity) > 1e-7);
  const rows = state.showClosed ? d.positions : open;

  const keyOf = {
    none: () => "",
    type: (p) => assetLabel(p.assetType),
    currency: (p) => p.currency,
    portfolio: (p) => p.portfolioName,
    group: (p) => p.groupName || t("positions.group.ungrouped"),
  }[state.groupBy];

  const redraw = () => app.refresh();
  root.append(
    h("header", { class: "top" }, h("h1", {}, `${t("positions.title")} · ${app.scopeTitle()}`), h("span", { class: "spacer" }),
      h("label", { class: "muted" }, `${t("positions.groupBy")} `, select([["none", "positions.group.none"], ["type", "positions.group.type"], ["currency", "positions.group.currency"], ["portfolio", "positions.group.portfolio"], ["group", "positions.group.group"]].map(([value, k]) => ({ value, label: t(k) })), state.groupBy, (v) => { state.groupBy = v; redraw(); })),
      h("label", { class: "muted" }, h("input", { type: "checkbox", checked: state.showClosed, onchange: (e) => { state.showClosed = e.target.checked; redraw(); } }), ` ${t("pos.showClosed")}`),
      h("button", { class: "btn primary", onclick: () => app.refreshPrices() }, t("ui.refresh"))),
    h("div", { class: "kpis" },
      kpi(t("kpi.value"), money(s.totalValue, s.baseCurrency)),
      kpi(t("kpi.profit"), signed(s.totalProfit, (v) => money(v, s.baseCurrency)), tone(s.totalProfit)),
      kpi(t("kpi.return"), signed(s.returnPct, (v) => pct(v, 2)), tone(s.returnPct))));

  const cols = [
    { label: t("col.symbol"), render: (p) => h("span", {}, h("strong", {}, p.symbol), p.quantity === 0 ? h("span", { class: "badge" }, ` ${t("positions.closed")}`) : null,
      !app.scope.startsWith("portfolio:") && p.portfolioName ? h("div", { class: "muted", style: { fontSize: "11px" } }, p.portfolioName) : null) },
    { label: t("col.name"), wrap: true, render: (p) => p.name },
    { label: t("col.qty"), num: true, render: (p) => number(p.quantity, 6) },
    { label: t("col.avgCost"), num: true, render: (p) => money(p.avgCost, p.currency) },
    { label: t("col.price"), num: true, render: (p) => h("span", { title: priceTitle(p) }, money(p.currentPrice, p.currency), p.priceSource === "cost" ? h("span", { class: "badge warn", title: t("pos.priceSource.cost") }, "≈") : null) },
    { label: t("col.value"), num: true, render: (p) => money(p.currentValue, p.currency) },
    { label: t("col.profit"), num: true, cls: (p) => tone(p.profit), render: (p) => `${signed(p.profit, (v) => money(v, p.currency))} (${pct(p.profitPct, 1)})` },
    { label: t("col.realized"), num: true, cls: (p) => tone(p.realized), render: (p) => money(p.realized, p.currency) },
    { label: t("col.income"), num: true, render: (p) => money(p.income, p.currency) },
    ...PERIODS.map((k) => ({ label: k, num: true, cls: (p) => tone(p.returns[k] ?? 0), render: (p) => (p.returns[k] === undefined ? "—" : signed(p.returns[k], (v) => pct(v, 1))) })),
    { label: "", render: (p) => h("span", { class: "actions-inline" },
      h("button", { class: "icon-btn", title: t("pos.mapTicker"), onclick: () => mapTicker(app, p) }, "⇄"),
      h("button", { class: "icon-btn", title: t("pos.delete"), onclick: () => removePosition(app, p) }, "✕")) },
  ];

  if (rows.length === 0) { root.append(panel(null, empty(t("pos.empty")))); return; }
  if (state.groupBy === "none") { root.append(panel(null, table({ cols, rows }))); return; }
  const groups = new Map();
  for (const p of rows) groups.set(keyOf(p), [...(groups.get(keyOf(p)) ?? []), p]);
  for (const [name, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = list.reduce((sum, p) => sum + p.currentValue, 0);
    root.append(panel(`${name} · ${money(total, list[0].currency)}`, table({ cols, rows: list })));
  }
}

function priceTitle(p) {
  const src = t(`pos.priceSource.${p.priceSource}`);
  return p.quoteAsOf ? `${src} · ${dateTime(p.quoteAsOf)}${p.meta ? ` · ${p.meta.providerSymbol}` : ""}` : src;
}

async function removePosition(app, p) {
  if (!(await confirmDialog(t("ui.confirmDeletePosition", { symbol: p.symbol })))) return;
  if (await guarded(() => api.post("/api/positions/delete", { symbol: p.symbol, currency: p.currency, scope: app.scope, portfolioId: p.portfolioId }), t("feedback.positionDeleted", { symbol: p.symbol }))) await app.refresh();
}

async function mapTicker(app, p) {
  const current = app.boot.settings.symbolMappings.find((m) => m.id === p.symbol);
  const v = await formDialog({
    title: t("mapping.title"),
    fields: [
      { name: "yahoo", label: `${t("mapping.yahoo")} (${p.symbol})`, value: current?.providerSymbol ?? p.meta?.providerSymbol ?? "", wide: true },
    ],
    submitLabel: t("mapping.save"),
  });
  if (v === null) return;
  const rest = app.boot.settings.symbolMappings.filter((m) => m.id !== p.symbol);
  const next = v.yahoo.trim() ? [...rest, { id: p.symbol, provider: "yahoo", providerSymbol: v.yahoo.trim() }] : rest;
  if (await guarded(() => api.put("/api/settings", { symbolMappings: next }), v.yahoo.trim() ? t("feedback.mappingSaved") : t("feedback.mappingCleared"))) {
    await guarded(() => api.post("/api/refresh/quotes"));
    await app.refresh();
  }
}
