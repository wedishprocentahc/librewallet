import { api } from "../api.js";
import { download, h } from "../dom.js";
import { dateShort, money, number, tone } from "../format.js";
import { t } from "../i18n.js";
import { guarded, kpi, panel, select, table, toast } from "../widgets.js";

const state = { year: String(new Date().getFullYear()), includeExempt: false };

export async function render(root, app) {
  const q = () => `year=${state.year}&scope=${encodeURIComponent(app.scope)}&includeExempt=${state.includeExempt ? 1 : 0}`;
  const d = await api.get(`/api/tax?${q()}`);
  const s = d.summary;
  const years = [...new Set([...d.years, Number(state.year)])].sort((a, b) => b - a);

  root.append(h("header", { class: "top" }, h("h1", {}, `${t("tax.title")} · ${app.scopeTitle()}`), h("span", { class: "spacer" }),
    h("button", { class: "btn", onclick: async () => { download(`librewallet-tax-${state.year}.csv`, await guarded(() => api.text(`/api/tax.csv?${q()}`)) ?? "", "text/csv"); toast(t("feedback.exportTax")); } }, t("tax.export"))));
  root.append(h("p", { class: "muted" }, t("tax.hint")));
  root.append(panel(t("tax.filters"), h("div", { class: "toolbar" },
    h("label", { class: "muted" }, `${t("tax.year")} `, select(years.map((y) => ({ value: y, label: y })), state.year, (v) => { state.year = v; app.refresh(); })),
    h("label", { class: "muted" }, h("input", { type: "checkbox", checked: state.includeExempt, onchange: (e) => { state.includeExempt = e.target.checked; app.refresh(); } }), ` ${t("tax.includeIKE")}`),
    !state.includeExempt && s.excludedTaxExemptCount > 0 ? h("span", { class: "badge warn" }, t("tax.ikeExcluded", { count: s.excludedTaxExemptCount })) : null)));

  const c = s.currency;
  root.append(panel(t("tax.pit38"), h("p", { class: "muted" }, t("tax.pit38.hint")), h("div", { class: "kpis" },
    kpi(t("tax.proceeds"), money(s.capitalProceeds, c)), kpi(t("tax.costs"), money(s.capitalCosts, c)),
    kpi(t("tax.pit38.income"), money(s.capitalProceeds - s.capitalCosts, c), tone(s.capitalProceeds - s.capitalCosts)), kpi(t("tax.belka"), money(s.estimatedBelkaTax, c)))));
  root.append(h("div", { class: "grid2" },
    panel(t("tax.capital"), h("dl", { class: "kv" }, h("dt", {}, t("tax.gains")), h("dd", { class: "pos" }, money(s.realizedGains, c)), h("dt", {}, t("tax.losses")), h("dd", { class: "neg" }, money(s.realizedLosses, c)), h("dt", {}, t("tax.net")), h("dd", { class: tone(s.netCapital) }, money(s.netCapital, c)))),
    panel(t("tax.income"), h("dl", { class: "kv" }, h("dt", {}, t("tax.dividends")), h("dd", {}, money(s.dividends, c)), h("dt", {}, t("tax.interest")), h("dd", {}, money(s.interest, c)), h("dt", {}, t("tax.fees")), h("dd", {}, money(s.fees, c))))));
  root.append(panel(t("tax.sells"), table({
    cols: [
      { label: t("ui.date"), render: (r) => dateShort(r.date) }, { label: t("col.symbol"), render: (r) => r.symbol }, { label: t("col.portfolio"), render: (r) => r.portfolioName },
      { label: t("col.qty"), num: true, render: (r) => number(r.quantity, 6) }, { label: t("col.proceeds"), num: true, render: (r) => money(r.proceeds, r.currency) },
      { label: t("col.cost"), num: true, render: (r) => money(r.cost, r.currency) }, { label: t("col.pnl"), num: true, cls: (r) => tone(r.pnl), render: (r) => money(r.pnl, r.currency) },
    ],
    rows: d.sells, emptyText: t("tax.noSells"),
  })));
  root.append(panel(t("tax.incomeLines"), table({
    cols: [
      { label: t("ui.date"), render: (r) => dateShort(r.date) }, { label: t("ui.type"), render: (r) => t(`type.${r.kind}`) }, { label: t("col.symbol"), render: (r) => r.symbol },
      { label: t("col.portfolio"), render: (r) => r.portfolioName }, { label: t("col.amount"), num: true, render: (r) => money(r.amount, r.currency) },
    ],
    rows: d.incomeLines, emptyText: t("tax.noIncome"),
  })));
}
