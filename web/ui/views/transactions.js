import { api } from "../api.js";
import { h } from "../dom.js";
import { dateShort, money, number, toDateInput } from "../format.js";
import { t, typeLabel } from "../i18n.js";
import { confirmDialog, empty, formDialog, guarded, panel, select, table } from "../widgets.js";

const state = { search: "", type: "", limit: 300, selected: new Set() };

export async function openTransactionDialog(app, tx) {
  const portfolios = app.boot.portfolios;
  if (portfolios.length === 0) { await guarded(async () => { throw new Error(t("ui.noPortfolios")); }); return false; }
  const defaultPortfolio = tx?.portfolioId ?? (app.scope.startsWith("portfolio:") ? app.scope.slice(10) : portfolios[0].id);
  const v = await formDialog({
    title: tx ? t("tx.edit") : t("tx.add"),
    fields: [
      { name: "portfolioId", label: t("ui.portfolio"), type: "select", options: portfolios.map((p) => ({ value: p.id, label: p.name })), value: defaultPortfolio },
      { name: "type", label: t("ui.type"), type: "select", options: app.boot.transactionTypes.map((k) => ({ value: k, label: typeLabel(k) })), value: tx?.typeRaw ?? "buy" },
      { name: "date", label: t("ui.date"), type: "date", value: tx ? toDateInput(new Date(tx.date)) : toDateInput(), required: true },
      { name: "symbol", label: t("col.symbol"), value: tx?.symbol ?? "" },
      { name: "name", label: t("col.name"), value: tx?.name ?? "" },
      { name: "quantity", label: t("tx.quantity"), type: "number", step: "any", value: tx?.quantity ?? "" },
      { name: "price", label: t("tx.price"), type: "number", step: "any", value: tx?.price ?? "" },
      { name: "gross", label: t("tx.gross"), type: "number", step: "any", value: tx?.gross ?? "" },
      { name: "fee", label: t("tx.fee"), type: "number", step: "any", value: tx?.fee ?? "" },
      { name: "currency", label: t("ui.currency"), value: tx?.currency ?? app.boot.portfolios.find((p) => p.id === defaultPortfolio)?.baseCurrency ?? "PLN" },
      { name: "cashDelta", label: t("tx.cashDelta"), type: "number", step: "any", value: tx?.cashDelta ?? "" },
      { name: "notes", label: t("ui.notes"), type: "textarea", value: tx?.notes ?? "", wide: true },
    ],
  });
  if (!v) return false;
  // Quantity × price fills in the amount when it was left empty.
  if (v.gross === "" && v.quantity !== "" && v.price !== "") v.gross = String(Number(v.quantity) * Number(v.price));
  const ok = tx
    ? await guarded(() => api.put(`/api/transactions/${tx.id}`, v), t("feedback.txAdded"))
    : await guarded(() => api.post("/api/transactions", v), t("feedback.txAdded"));
  return ok !== undefined;
}

export async function render(root, app) {
  const qs = new URLSearchParams({ scope: app.scope, q: state.search, type: state.type, limit: String(state.limit) });
  const d = await api.get(`/api/transactions?${qs}`);
  state.selected = new Set([...state.selected].filter((id) => d.rows.some((r) => r.id === id)));

  const reload = () => app.refresh();
  const search = h("input", { type: "search", placeholder: t("tx.searchPlaceholder"), value: state.search, class: "grow", onkeydown: (e) => { if (e.key === "Enter") { state.search = e.target.value; reload(); } } });
  root.append(h("header", { class: "top" }, h("h1", {}, `${t("tx.title")} · ${app.scopeTitle()}`), h("span", { class: "spacer" }),
    h("button", { class: "btn primary", onclick: async () => { if (await openTransactionDialog(app)) reload(); } }, `＋ ${t("tx.add")}`)));

  const bulk = h("button", { class: "btn danger", disabled: state.selected.size === 0, onclick: async () => {
    if (!(await confirmDialog(t("ui.confirmDeleteTx", { count: state.selected.size })))) return;
    const r = await guarded(() => api.post("/api/transactions/delete", { ids: [...state.selected] }));
    if (r) { state.selected.clear(); await guarded(async () => r, t("feedback.txDeleted", { count: r.deleted })); reload(); }
  } }, state.selected.size ? `${t("tx.deleteSelected")} (${state.selected.size})` : t("tx.deleteSelected"));

  root.append(panel(null,
    h("div", { class: "toolbar" }, search,
      select([{ value: "", label: t("tx.allTypes") }, ...app.boot.transactionTypes.map((k) => ({ value: k, label: typeLabel(k) }))], state.type, (v) => { state.type = v; reload(); }),
      h("button", { class: "btn", onclick: () => { state.search = search.value; reload(); } }, t("common.search")), bulk),
    d.rows.length === 0 ? empty(t("tx.empty")) : table({
      cols: [
        { label: "", render: (r) => h("input", { type: "checkbox", checked: state.selected.has(r.id), onchange: (e) => { e.target.checked ? state.selected.add(r.id) : state.selected.delete(r.id); bulk.disabled = state.selected.size === 0; bulk.textContent = state.selected.size ? `${t("tx.deleteSelected")} (${state.selected.size})` : t("tx.deleteSelected"); } }) },
        { label: t("ui.date"), render: (r) => dateShort(r.date) },
        { label: t("ui.type"), render: (r) => h("span", { class: "badge" }, typeLabel(r.typeRaw)) },
        { label: t("col.symbol"), render: (r) => r.symbol ?? "" },
        { label: t("col.name"), wrap: true, render: (r) => r.name ?? "" },
        { label: t("col.qty"), num: true, render: (r) => (r.quantity === null ? "" : number(r.quantity, 6)) },
        { label: t("col.price"), num: true, render: (r) => (r.price === null ? "" : money(r.price, r.currency)) },
        { label: t("col.gross"), num: true, render: (r) => money(r.gross, r.currency) },
        { label: t("col.fee"), num: true, render: (r) => (r.fee ? money(r.fee, r.currency) : "") },
        { label: t("col.currency"), render: (r) => r.currency },
        { label: t("col.portfolio"), render: (r) => r.portfolioName },
        { label: t("ui.notes"), wrap: true, cls: () => "muted", render: (r) => r.notes ?? "" },
        { label: "", render: (r) => h("button", { class: "icon-btn", title: t("ui.edit"), onclick: async () => { if (await openTransactionDialog(app, r)) reload(); } }, "✎") },
      ],
      rows: d.rows,
    }),
    d.total > d.rows.length ? h("div", { class: "toolbar", style: { marginTop: "8px" } }, h("span", { class: "muted" }, t("tx.shown", { shown: d.rows.length, total: d.total })),
      h("button", { class: "btn", onclick: () => { state.limit += 500; reload(); } }, "＋")) : null));
}

