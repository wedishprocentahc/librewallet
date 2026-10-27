import { api } from "../api.js";
import { h } from "../dom.js";
import { dateShort, money, number } from "../format.js";
import { t, typeLabel } from "../i18n.js";
import { download } from "../dom.js";
import { empty, guarded, panel, select, table, toast } from "../widgets.js";

const state = { kind: "", preview: null, target: "" };

export async function render(root, app) {
  const reload = () => app.refresh();
  const choose = h("input", { type: "file", accept: ".zip,.csv,.xlsx,.xls,.tsv,.txt", style: { display: "none" }, onchange: (e) => e.target.files[0] && load(e.target.files[0]) });
  const drop = h("div", { class: "drop" }, h("p", {}, t("import.dropHint")), h("button", { class: "btn primary", onclick: () => choose.click() }, t("import.chooseFile")), choose);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });

  async function load(file) {
    const headers = { "X-Filename": encodeURIComponent(file.name), ...(state.kind ? { "X-Import-Kind": state.kind } : {}) };
    const r = await guarded(async () => api.upload("/api/import/preview", await file.arrayBuffer(), headers));
    if (r) { state.preview = r; state.target = app.scope.startsWith("portfolio:") ? app.scope.slice(10) : (app.boot.portfolios[0]?.id ?? ""); await reload(); }
  }

  root.append(h("header", { class: "top" }, h("h1", {}, t("import.title")), h("span", { class: "spacer" }),
    h("button", { class: "btn", onclick: async () => { download("librewallet-template.csv", await api.text("/api/export/template.csv"), "text/csv"); toast(t("feedback.exportTemplate")); } }, t("import.template"))));
  root.append(panel(null,
    h("div", { class: "toolbar" }, h("label", { class: "muted" }, `${t("ui.type")} `, select([["", "import.kind.auto"], ["xtb", "import.kind.xtb"], ["universal", "import.kind.universal"], ["ibkr", "import.kind.ibkr"]].map(([value, k]) => ({ value, label: t(k) })), state.kind, (v) => { state.kind = v; }))),
    drop));

  const p = state.preview;
  if (!p) return;
  const commitBtn = h("button", { class: "btn primary", disabled: p.newCount === 0 && p.duplicates === 0, onclick: async () => {
    const r = await guarded(() => api.post("/api/import/commit", { token: p.token, portfolioId: p.autoPortfolios ? null : state.target }));
    if (!r) return;
    state.preview = null;
    toast(r.saved === 0 && r.skipped > 0 ? t("feedback.importAllDuplicates", { skipped: r.skipped }) : r.skipped > 0 ? t("feedback.importSavedWithSkipped", { count: r.saved, skipped: r.skipped }) : t("feedback.importSaved", { count: r.saved }));
    if (r.portfolioId) { app.scope = `portfolio:${r.portfolioId}`; localStorage.setItem("lw.scope", app.scope); }
    await app.refresh({ view: false });
    app.navigate("transactions");
  } }, t("import.commit", { count: p.newCount }));

  root.append(panel(`${t("import.preview")} · ${p.source ?? ""}`,
    h("div", { class: "toolbar" },
      h("span", {}, t("import.newOps", { count: p.newCount })), p.duplicates ? h("span", { class: "badge warn" }, t("import.duplicates", { count: p.duplicates })) : null,
      p.accounts.length ? h("span", { class: "muted" }, t("import.accounts", { accounts: p.accounts.join(", ") })) : null,
      (p.currencies?.length ?? 0) > 1 ? h("span", { class: "muted" }, t("import.currencies", { currencies: p.currencies.join(", ") })) : null,
      h("span", { class: "grow" }),
      p.autoPortfolios ? h("span", { class: "muted" }, t("import.autoPortfolios")) : h("label", { class: "muted" }, `${t("import.targetPortfolio")} `, select(app.boot.portfolios.map((x) => ({ value: x.id, label: x.name })), state.target, (v) => { state.target = v; })),
      h("button", { class: "btn", onclick: async () => { state.preview = null; await reload(); } }, t("import.cancel")), commitBtn),
    p.items.length ? table({
      cols: [
        { label: t("ui.date"), render: (r) => dateShort(r.date) },
        { label: t("ui.type"), render: (r) => typeLabel(r.type) },
        { label: t("col.symbol"), render: (r) => r.symbol ?? "" },
        { label: t("col.qty"), num: true, render: (r) => (r.quantity === null ? "" : number(r.quantity, 6)) },
        { label: t("col.price"), num: true, render: (r) => (r.price === null ? "" : number(r.price, 4)) },
        { label: t("col.gross"), num: true, render: (r) => money(r.gross, r.currency.length === 3 && !["IKE"].includes(r.currency) ? r.currency : "PLN") },
        { label: t("col.currency"), render: (r) => r.currency },
        { label: t("col.portfolio"), render: (r) => r.account ?? "" },
      ],
      rows: p.items,
    }) : empty(t("tx.empty")),
    p.total > p.items.length ? h("p", { class: "muted" }, t("tx.shown", { shown: p.items.length, total: p.total })) : null));
}
