import { api } from "../api.js";
import { h } from "../dom.js";
import { money, pct, tone } from "../format.js";
import { assetLabel, t } from "../i18n.js";
import { empty, guarded, panel } from "../widgets.js";

export async function render(root, app) {
  const d = await api.get(`/api/rebalance?scope=${encodeURIComponent(app.scope)}`);
  const ccy = d.scope.baseCurrency;
  root.append(h("header", { class: "top" }, h("h1", {}, `${t("nav.rebalance")} · ${app.scopeTitle()}`)));
  const caption = app.scope === "all" ? "Wszystkie portfele — wspólne cele globalne" : app.scope.startsWith("group:") ? "Agregat grupy — cele zapisywane w każdym portfelu grupy" : "";
  if (caption) root.append(h("p", { class: "muted" }, caption));

  root.append(panel(t("rebalance.targets"), d.rows.map((r) => {
    const value = h("span", { class: "num" }, `${r.targetPct}%`);
    const slider = h("input", { type: "range", min: 0, max: 100, step: 1, value: r.targetPct,
      oninput: (e) => { value.textContent = `${e.target.value}%`; },
      onchange: async (e) => { if (await guarded(() => api.put("/api/targets", { scope: app.scope, assetType: r.assetType, pct: Number(e.target.value) }))) await app.refresh(); } });
    return h("div", { class: "slider-row" }, h("span", {}, assetLabel(r.assetType)), slider, value, h("span", { class: "muted" }, `${t("rebalance.actual")}: ${pct(r.actualPct)}`));
  })));

  root.append(panel(t("rebalance.suggestions"), d.suggestions.length === 0 ? empty(t("rebalance.noSuggestions")) : h("div", {}, d.suggestions.map((s) =>
    h("div", { class: "toolbar", style: { borderBottom: "1px solid var(--line)", padding: "8px 0", margin: 0 } },
      h("strong", {}, assetLabel(s.assetType)), h("span", { class: "muted" }, s.deltaValue >= 0 ? t("rebalance.buy") : t("rebalance.reduce")), h("span", { class: "grow" }),
      h("span", { class: tone(s.deltaValue) }, money(s.deltaValue, ccy)),
      h("span", { class: "muted" }, `${t("rebalance.actual")} ${pct(s.actualPct)} → ${t("rebalance.target")} ${pct(s.targetPct, 0)}`))))));
}
