import { api } from "../api.js";
import { h } from "../dom.js";
import { dateShort, money, signed, tone } from "../format.js";
import { t, typeLabel } from "../i18n.js";
import { empty, panel, select, table } from "../widgets.js";

const state = { year: "" };

export async function render(root, app) {
  const d = await api.get(`/api/cashflow?scope=${encodeURIComponent(app.scope)}${state.year ? `&year=${state.year}` : ""}`);
  root.append(h("header", { class: "top" }, h("h1", {}, `${t("cashflow.title")} · ${app.scopeTitle()}`), h("span", { class: "spacer" }),
    h("label", { class: "muted" }, `${t("cashflow.year")} `, select([{ value: "", label: t("cashflow.allYears") }, ...d.years.map((y) => ({ value: y, label: y }))], state.year, (v) => { state.year = v; app.refresh(); }))));
  root.append(h("div", { class: "kpis" }, Object.entries(d.totals).map(([ccy, v]) => h("div", { class: "kpi" }, h("div", { class: "label" }, `${t("cashflow.net")} ${ccy}`), h("div", { class: `value ${tone(v)}` }, signed(v, (x) => money(x, ccy)))))));
  root.append(panel(null, d.events.length === 0 ? empty(t("cashflow.empty")) : table({
    cols: [
      { label: t("ui.date"), render: (e) => dateShort(e.date) },
      { label: t("ui.type"), render: (e) => typeLabel(e.type) },
      { label: t("col.symbol"), render: (e) => e.symbol ?? "" },
      { label: t("col.portfolio"), render: (e) => e.portfolioName },
      { label: t("col.amount"), num: true, cls: (e) => tone(e.amount), render: (e) => signed(e.amount, (v) => money(v, e.currency)) },
    ],
    rows: d.events,
  })));
}
