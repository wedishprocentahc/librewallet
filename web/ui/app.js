import { api } from "./api.js";
import { clear, h } from "./dom.js";
import { getLang, setLang, t } from "./i18n.js";
import { confirmDialog, formDialog, guarded, toast } from "./widgets.js";

const VIEWS = [
  { id: "dashboard", key: "nav.dashboard", load: () => import("./views/dashboard.js") },
  { id: "positions", key: "nav.positions", load: () => import("./views/positions.js") },
  { id: "transactions", key: "nav.transactions", load: () => import("./views/transactions.js") },
  { id: "import", key: "nav.import", load: () => import("./views/importer.js") },
  { id: "rebalance", key: "nav.rebalance", load: () => import("./views/rebalance.js") },
  { id: "bonds", key: "nav.bonds", load: () => import("./views/bonds.js") },
  { id: "cashflow", key: "nav.cashflow", load: () => import("./views/cashflow.js") },
  { id: "tax", key: "nav.tax", load: () => import("./views/tax.js") },
  { id: "alerts", key: "nav.alerts", load: () => import("./views/alerts.js") },
  { id: "settings", key: "nav.settings", load: () => import("./views/settings.js") },
];

export const app = {
  boot: null,
  scope: localStorage.getItem("lw.scope") ?? "all",
  view: "dashboard",

  setScope(scope) {
    this.scope = scope;
    localStorage.setItem("lw.scope", scope);
    renderSidebar();
    renderView();
  },
  scopeTitle() {
    const [kind, id] = this.scope.split(":");
    if (kind === "group") return `${t("nav.groups")}: ${this.boot.groups.find((g) => g.id === id)?.name ?? "?"}`;
    if (kind === "portfolio") return this.boot.portfolios.find((p) => p.id === id)?.name ?? "?";
    return t("common.all");
  },
  /** Reload bootstrap data (portfolios, settings) and redraw everything. */
  async refresh(opts = {}) {
    this.boot = await api.get("/api/bootstrap");
    setLang(this.boot.settings.language);
    if (!this.validScope()) this.scope = "all";
    renderSidebar();
    if (opts.view !== false) await renderView();
  },
  validScope() {
    const [kind, id] = this.scope.split(":");
    if (kind === "group") return this.boot.groups.some((g) => g.id === id);
    if (kind === "portfolio") return this.boot.portfolios.some((p) => p.id === id);
    return true;
  },
  navigate(view) {
    location.hash = `#/${view}`;
  },
  async refreshPrices() {
    toast(t("ui.refreshing"));
    const r = await guarded(() => api.post("/api/refresh"));
    if (r) {
      const failed = r.quotes.failed.length;
      toast(`${t("feedback.pricesRefreshed")}${failed ? ` (${failed} ✗)` : ""}`, failed ? "error" : "info");
      await this.refresh();
    }
  },
};

function currentViewId() {
  const id = location.hash.replace(/^#\//, "") || "dashboard";
  return VIEWS.some((v) => v.id === id) ? id : "dashboard";
}

function renderSidebar() {
  const side = document.getElementById("sidebar");
  const b = app.boot;
  const scopeBtn = (scope, label, extra = {}) =>
    h("div", { class: "row" },
      h("button", { class: `${app.scope === scope ? "active" : ""} ${extra.sub ? "sub" : ""}`, onclick: () => app.setScope(scope) },
        extra.color ? h("span", { class: "dotc", style: { background: extra.color } }) : null, h("span", { class: "grow" }, label), extra.hint ? h("span", { class: "muted" }, extra.hint) : null),
      extra.actions ? h("span", { class: "actions" }, extra.actions) : null);

  const portfolioRow = (p, sub) => scopeBtn(`portfolio:${p.id}`, p.name, {
    sub, color: p.colorHex, hint: p.baseCurrency,
    actions: [
      h("button", { class: "icon-btn", title: t("ui.edit"), onclick: (e) => { e.stopPropagation(); editPortfolio(p); } }, "✎"),
      h("button", { class: "icon-btn", title: t("common.delete"), onclick: (e) => { e.stopPropagation(); removePortfolio(p); } }, "✕"),
    ],
  });
  const grouped = new Set();
  const tree = [scopeBtn("all", t("common.all"))];
  for (const g of b.groups) {
    tree.push(scopeBtn(`group:${g.id}`, g.name, {
      color: g.colorHex,
      actions: [
        h("button", { class: "icon-btn", title: t("ui.rename"), onclick: (e) => { e.stopPropagation(); renameGroup(g); } }, "✎"),
        h("button", { class: "icon-btn", title: t("common.delete"), onclick: (e) => { e.stopPropagation(); removeGroup(g); } }, "✕"),
      ],
    }));
    for (const p of b.portfolios.filter((x) => x.groupId === g.id)) { grouped.add(p.id); tree.push(portfolioRow(p, true)); }
  }
  for (const p of b.portfolios.filter((x) => !grouped.has(x.id))) tree.push(portfolioRow(p, false));

  clear(side,
    h("div", { class: "brand" }, "LibreWallet"),
    h("nav", { class: "nav" }, VIEWS.map((v) => h("a", { href: `#/${v.id}`, class: app.view === v.id ? "active" : "" }, t(v.key)))),
    h("div", { class: "section-title" }, h("span", {}, t("ui.sidebar.portfolios")),
      h("span", {}, h("button", { class: "icon-btn", title: t("ui.newPortfolio"), onclick: addPortfolio }, "＋"), h("button", { class: "icon-btn", title: t("ui.newGroup"), onclick: addGroup }, "▤"))),
    h("div", { class: "tree" }, tree),
    h("div", { class: "grow" }),
    h("div", { class: "muted", style: { padding: "8px 10px", fontSize: "11px" } }, `v${b.version} · `, h("a", { href: "#/settings" }, getLang().toUpperCase())));
}

const groupOptions = () => [{ value: "", label: t("ui.none") }, ...app.boot.groups.map((g) => ({ value: g.id, label: g.name }))];

async function addPortfolio() {
  const v = await formDialog({
    title: t("ui.newPortfolio"),
    fields: [
      { name: "name", label: t("ui.name"), required: true },
      { name: "baseCurrency", label: t("ui.currency"), value: "PLN" },
      { name: "groupId", label: t("ui.group"), type: "select", options: groupOptions(), value: app.scope.startsWith("group:") ? app.scope.slice(6) : "" },
    ],
  });
  if (!v) return;
  const p = await guarded(() => api.post("/api/portfolios", { ...v, groupId: v.groupId || null }), t("feedback.portfolioCreated"));
  if (p) { app.scope = `portfolio:${p.id}`; localStorage.setItem("lw.scope", app.scope); await app.refresh(); }
}

async function editPortfolio(p) {
  const v = await formDialog({
    title: t("ui.edit"),
    fields: [
      { name: "name", label: t("ui.name"), value: p.name, required: true },
      { name: "baseCurrency", label: t("ui.currency"), value: p.baseCurrency },
      { name: "groupId", label: t("ui.group"), type: "select", options: groupOptions(), value: p.groupId ?? "" },
    ],
  });
  if (v && (await guarded(() => api.put(`/api/portfolios/${p.id}`, { ...v, groupId: v.groupId || null }), t("feedback.portfolioUpdated")))) await app.refresh();
}

async function removePortfolio(p) {
  if (!(await confirmDialog(t("ui.deletePortfolioConfirm", { name: p.name })))) return;
  if (await guarded(() => api.del(`/api/portfolios/${p.id}`), t("feedback.portfolioDeleted"))) await app.refresh();
}

async function addGroup() {
  const v = await formDialog({ title: t("ui.newGroup"), fields: [{ name: "name", label: t("ui.name"), required: true }] });
  if (v && (await guarded(() => api.post("/api/groups", v), t("feedback.groupCreated")))) await app.refresh();
}

async function renameGroup(g) {
  const v = await formDialog({ title: t("ui.rename"), fields: [{ name: "name", label: t("ui.name"), value: g.name, required: true }] });
  if (v && (await guarded(() => api.put(`/api/groups/${g.id}`, v), t("feedback.groupUpdated")))) await app.refresh();
}

async function removeGroup(g) {
  if (!(await confirmDialog(t("ui.deleteGroupConfirm", { name: g.name })))) return;
  if (await guarded(() => api.del(`/api/groups/${g.id}`), t("feedback.groupDeleted"))) await app.refresh();
}

let renderToken = 0;
async function renderView() {
  const token = ++renderToken;
  app.view = currentViewId();
  renderSidebar();
  const main = document.getElementById("main");
  clear(main, h("div", { class: "empty" }, t("ui.loading")));
  const view = VIEWS.find((v) => v.id === app.view);
  try {
    const mod = await view.load();
    if (token !== renderToken) return;
    const root = h("div");
    await mod.render(root, app);
    if (token === renderToken) clear(main, root);
  } catch (e) {
    if (token === renderToken) clear(main, h("div", { class: "empty neg" }, `${t("ui.error")}: ${e instanceof Error ? e.message : e}`));
  }
}

/** Alerts fire on the server; the UI drains them and shows toasts + (if allowed) browser notifications. */
async function pollNotifications() {
  try {
    const { notifications } = await api.get("/api/notifications");
    for (const n of notifications) {
      const title = n.kind === "price" ? t("alerts.notify.priceTitle") : t("alerts.notify.driftTitle");
      toast(`${title}: ${n.body}`);
      if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body: n.body });
    }
  } catch { /* offline/backend restarting */ }
}

window.addEventListener("hashchange", renderView);
await app.refresh({ view: false });
await renderView();
setInterval(pollNotifications, 30_000);
pollNotifications();
