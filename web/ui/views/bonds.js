import { api } from "../api.js";
import { h } from "../dom.js";
import { dateShort, money, number, toDateInput } from "../format.js";
import { t } from "../i18n.js";
import { empty, guarded, kpi, panel, select, table } from "../widgets.js";

const state = {
  preset: "OTS", portfolioId: "", count: "1", date: toDateInput(), symbol: "", rate: "", margin: "", term: "",
  useCustomMaturity: false, maturity: "",
  redeemKey: "", redeemQty: "", redeemPrice: "", redeemFee: "0", redeemDate: toDateInput(),
};

function estimate(preset, count, dateStr, rate, termMonths, capitalization) {
  const start = new Date(`${dateStr}T00:00:00`);
  const maturity = new Date(start.getFullYear(), start.getMonth() + termMonths, start.getDate());
  const ref = new Date(Math.min(Date.now(), maturity.getTime()));
  const years = Math.max(0, (ref - start) / (365.25 * 86400_000));
  const r = rate / 100;
  const unit = !(r > 0) || !(years > 0) ? 100 : capitalization ? 100 * (1 + r) ** years : 100 * (1 + r * (years - Math.floor(years)));
  return unit * count;
}

export async function render(root, app) {
  const d = await api.get("/api/bonds");
  const preset = d.presets.find((p) => p.code === state.preset) ?? d.presets[0];
  if (!state.portfolioId || !app.boot.portfolios.some((p) => p.id === state.portfolioId)) {
    state.portfolioId = app.scope.startsWith("portfolio:") ? app.scope.slice(10) : (app.boot.portfolios[0]?.id ?? "");
  }
  const reload = () => app.refresh();
  root.append(h("header", { class: "top" }, h("h1", {}, t("bonds.title"))));

  const input = (key, type = "text", extra = {}) => h("input", { type, value: state[key], oninput: (e) => { state[key] = e.target.value; updateEstimate(); }, ...extra });
  const estimateEl = h("p", { class: "muted" });
  function updateEstimate() {
    const count = Math.trunc(Number(state.count));
    if (!(count > 0)) { estimateEl.textContent = ""; return; }
    const rate = state.rate === "" ? preset.firstYearRate : Number(state.rate.replace(",", "."));
    const term = state.term === "" ? preset.termMonths : Number(state.term);
    const value = estimate(preset, count, state.date, rate, term, preset.capitalization);
    estimateEl.textContent = t("bonds.estimate", { value: money(value, "PLN"), profit: money(value - count * d.nominal, "PLN") });
  }

  const maturityToggle = h("label", { class: "muted" }, h("input", {
    type: "checkbox", checked: state.useCustomMaturity,
    onchange: (e) => {
      state.useCustomMaturity = e.target.checked;
      if (state.useCustomMaturity && !state.maturity) {
        const start = new Date(`${state.date}T00:00:00`);
        const m = new Date(start.getFullYear(), start.getMonth() + (state.term === "" ? preset.termMonths : Number(state.term)), start.getDate());
        state.maturity = toDateInput(m);
      }
      reload();
    },
  }), ` ${t("bonds.maturity")}`);

  root.append(panel(t("bonds.add"),
    h("div", { class: "form" },
      h("label", {}, t("bonds.portfolio"), select(app.boot.portfolios.map((p) => ({ value: p.id, label: p.name })), state.portfolioId, (v) => { state.portfolioId = v; })),
      h("label", {}, t("bonds.preset"), select(d.presets.map((p) => ({ value: p.code, label: p.code })), state.preset, (v) => { state.preset = v; state.symbol = state.rate = state.margin = state.term = state.maturity = ""; state.useCustomMaturity = false; reload(); })),
      h("label", {}, t("bonds.date"), input("date", "date")),
      h("label", {}, t("bonds.count"), input("count", "number", { min: 1, step: 1 }))),
    h("p", { class: "muted" }, preset.name),
    h("details", { open: state.useCustomMaturity || !!(state.symbol || state.rate || state.margin || state.term) }, h("summary", {}, t("bonds.overrides")), h("div", { class: "form", style: { marginTop: "8px" } },
      h("label", {}, t("bonds.series"), input("symbol", "text", { placeholder: preset.code })),
      h("label", {}, t("bonds.rate"), input("rate", "text", { placeholder: String(preset.firstYearRate) })),
      h("label", {}, t("bonds.margin"), input("margin", "text", { placeholder: String(preset.margin) })),
      h("label", {}, t("bonds.term"), input("term", "number", { placeholder: String(preset.termMonths) })),
      maturityToggle,
      state.useCustomMaturity ? h("label", {}, t("bonds.maturity"), input("maturity", "date")) : null)),
    estimateEl,
    h("button", { class: "btn primary", onclick: async () => {
      const body = { portfolioId: state.portfolioId, preset: state.preset, count: state.count, date: state.date, symbol: state.symbol, rate: state.rate, margin: state.margin, termMonths: state.term };
      if (state.useCustomMaturity && state.maturity) body.maturity = state.maturity;
      if (await guarded(() => api.post("/api/bonds", body), t("feedback.bondAdded"))) await reload();
    } }, t("bonds.addButton"))));
  updateEstimate();

  const label = (l) => `${l.symbol} · ${dateShort(l.purchaseDate)} · ${number(l.quantity, 2)} × (${l.portfolioName})`;
  root.append(panel(t("bonds.redeem"), d.held.length === 0 ? empty(t("bonds.noHeld")) : h("div", { class: "form" },
    h("label", { class: "wide" }, t("bonds.redeemKey"), select([{ value: "", label: "—" }, ...d.held.map((l) => ({ value: l.key, label: label(l) }))], state.redeemKey, (v) => { state.redeemKey = v; })),
    h("label", {}, t("bonds.redeemQty"), h("input", { type: "number", step: "any", value: state.redeemQty, oninput: (e) => { state.redeemQty = e.target.value; } })),
    h("label", {}, t("bonds.redeemPrice"), h("input", { type: "number", step: "any", value: state.redeemPrice, oninput: (e) => { state.redeemPrice = e.target.value; } })),
    h("label", {}, t("bonds.redeemFee"), h("input", { type: "number", step: "any", value: state.redeemFee, oninput: (e) => { state.redeemFee = e.target.value; } })),
    h("label", {}, t("bonds.redeemDate"), h("input", { type: "date", value: state.redeemDate, oninput: (e) => { state.redeemDate = e.target.value; } })),
    h("button", { class: "btn primary", onclick: async () => {
      if (await guarded(() => api.post("/api/bonds/redeem", { key: state.redeemKey, quantity: state.redeemQty, price: state.redeemPrice, fee: state.redeemFee, date: state.redeemDate }), t("feedback.bondRedeemed"))) { state.redeemQty = state.redeemPrice = ""; await reload(); }
    } }, t("bonds.redeemButton")))));

  const sum = d.summary;
  root.append(panel(t("bonds.calendar"),
    d.held.length === 0 ? empty(t("bonds.noHeld")) : h("div", {},
      h("div", { class: "kpis" },
        kpi(t("bonds.seriesCount"), String(sum.series)),
        kpi(t("bonds.qtyTotal"), number(sum.quantity, 2)),
        kpi(t("bonds.valueToday"), money(sum.value, "PLN"))),
      sum.overdue ? h("p", { class: "neg" }, t("bonds.overdue", { count: sum.overdue })) : null,
      ...d.byYear.map((g) =>
        h("div", {}, h("h3", {}, `${g.year} · ${money(g.items.reduce((s, l) => s + l.totalValue, 0), "PLN")}`), table({
          cols: [
            { label: t("col.series"), render: (l) => h("strong", {}, l.symbol) },
            { label: t("ui.portfolio"), render: (l) => l.portfolioName },
            { label: t("col.purchase"), render: (l) => dateShort(l.purchaseDate) },
            { label: t("col.maturity"), render: (l) => h("span", { class: l.isPast ? "neg" : "" }, dateShort(l.maturityDate), l.isPast ? ` (${t("bonds.past")})` : "") },
            { label: t("col.qty"), num: true, render: (l) => number(l.quantity, 2) },
            { label: t("col.unitValue"), num: true, render: (l) => money(l.unitValue, l.currency) },
            { label: t("col.value"), num: true, render: (l) => money(l.totalValue, l.currency) },
          ],
          rows: g.items,
        }))))));
}
