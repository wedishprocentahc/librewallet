import { api } from "../api.js";
import { h } from "../dom.js";
import { dateTime, money, number, pct, signed, tone } from "../format.js";
import { assetLabel, t } from "../i18n.js";
import { confirmDialog, empty, guarded, kpi, panel, select, table, toast } from "../widgets.js";

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
    { label: t("col.price"), num: true, render: (p) => h("span", { title: priceTitle(p) }, money(p.currentPrice, p.currency), p.priceSource === "cost" ? h("span", { class: "badge warn", title: t("pos.priceSource.cost") }, "≈") : null,
      p.resolution === "unresolved" || p.resolution === "ignored" ? h("div", { class: "warn", style: { fontSize: "11px" } }, p.resolution === "ignored" ? t("mapping.ignored") : t("mapping.unresolved")) : null) },
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

export async function mapTicker(app, p) {
  const current = app.boot.settings.symbolMappings.find((m) => m.id === p.symbol);
  const dlg = h("dialog");
  const yahoo = h("input", { value: current?.providerSymbol ?? p.meta?.providerSymbol ?? "", placeholder: "DIA.WA", autocomplete: "off" });
  const note = h("input", { value: current?.note ?? "", autocomplete: "off" });
  const status = h("p", { class: "muted" });
  const info = p.resolution === "unresolved" ? t("mapping.unresolved") : p.resolution === "ignored" ? t("mapping.ignored") : current ? t("mapping.override") : t("mapping.auto");
  const close = () => { dlg.close(); dlg.remove(); };
  const save = async (mapping) => {
    const rest = app.boot.settings.symbolMappings.filter((m) => m.id !== p.symbol);
    const next = mapping ? [...rest, mapping] : rest;
    if (!(await guarded(() => api.put("/api/settings", { symbolMappings: next })))) return;
    if (mapping) {
      const r = await guarded(() => api.post("/api/refresh/quotes"));
      const fail = r?.failed.find((f) => f.symbol === p.symbol);
      if (fail) { status.className = "neg"; status.textContent = fail.error; await app.refresh({ view: false }); return; }
      toast(t("feedback.mappingSaved"));
    } else toast(t("feedback.mappingCleared"));
    close();
    await app.refresh();
  };
  dlg.append(
    h("h3", {}, `${t("mapping.title")} · ${p.symbol}`),
    h("dl", { class: "kv" }, h("dt", {}, t("mapping.currency")), h("dd", {}, p.currency), h("dt", {}, t("mapping.override")), h("dd", {}, info),
      p.meta ? [h("dt", {}, t("mapping.last")), h("dd", {}, `${p.meta.providerSymbol} · ${p.meta.currency} · ${dateTime(p.meta.asOf)}`)] : null),
    h("div", { class: "form" }, h("label", { class: "wide" }, t("mapping.yahoo"), yahoo), h("label", { class: "wide" }, t("mapping.note"), note)),
    status,
    h("div", { class: "footer" },
      current ? h("button", { class: "btn danger", onclick: () => save(null) }, t("mapping.clear")) : null,
      h("span", { class: "grow" }),
      h("button", { class: "btn", onclick: async (e) => {
        e.target.disabled = true;
        const r = await guarded(() => api.post("/api/quotes/test", { symbol: p.symbol, providerSymbol: yahoo.value, currency: p.currency }));
        e.target.disabled = false;
        if (!r) return;
        status.className = r.ok ? "pos" : "neg";
        status.textContent = r.ok ? `${number(r.price)} ${r.currency} ← ${r.providerSymbol}` : r.error;
      } }, t("mapping.test")),
      h("button", { class: "btn", onclick: close }, t("common.cancel")),
      h("button", { class: "btn primary", onclick: () => yahoo.value.trim() && save({ id: p.symbol, provider: "yahoo", providerSymbol: yahoo.value.trim().toUpperCase(), note: note.value.trim() || undefined }) }, t("mapping.save"))));
  document.body.append(dlg);
  dlg.showModal();
}
