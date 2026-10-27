import { api } from "./api.js";
import { clear, h } from "./dom.js";
import { getLang, setLang, t } from "./i18n.js";
import { COLOR_PRESETS, confirmDialog, formDialog, guarded, toast } from "./widgets.js";

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

const currencyOptions = () => ["PLN", "EUR", "USD"].map((c) => ({ value: c, label: c }));

async function addPortfolio() {
  const v = await formDialog({
    title: t("ui.newPortfolio"),
    fields: [
      { name: "name", label: t("ui.name"), required: true },
      { name: "baseCurrency", label: t("ui.currency"), type: "select", options: currencyOptions(), value: "PLN" },
      { name: "groupId", label: t("ui.group"), type: "select", options: groupOptions(), value: app.scope.startsWith("group:") ? app.scope.slice(6) : "" },
      { name: "colorHex", label: t("ui.color"), type: "color", value: COLOR_PRESETS[0] },
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
      { name: "baseCurrency", label: t("ui.currency"), type: "select", options: currencyOptions(), value: p.baseCurrency },
      { name: "groupId", label: t("ui.group"), type: "select", options: groupOptions(), value: p.groupId ?? "" },
      { name: "colorHex", label: t("ui.color"), type: "color", value: p.colorHex || COLOR_PRESETS[0] },
    ],
  });
  if (v && (await guarded(() => api.put(`/api/portfolios/${p.id}`, { ...v, groupId: v.groupId || null }), t("feedback.portfolioUpdated")))) await app.refresh();
}

async function removePortfolio(p) {
  if (!(await confirmDialog(t("ui.deletePortfolioConfirm", { name: p.name })))) return;
  if (await guarded(() => api.del(`/api/portfolios/${p.id}`), t("feedback.portfolioDeleted"))) await app.refresh();
}

async function addGroup() {
  const result = await createGroupDialog();
  if (!result) return;
  const g = await guarded(() => api.post("/api/groups", { name: result.name, colorHex: result.colorHex }), t("feedback.groupCreated"));
  if (!g) return;
  for (const p of result.portfolios) {
    if (!p.name.trim()) continue;
    await guarded(() => api.post("/api/portfolios", { name: p.name.trim(), baseCurrency: p.baseCurrency || "PLN", colorHex: p.colorHex, groupId: g.id, kind: p.kind || "account" }));
  }
  await app.refresh();
}

/** Sheet matching native CreateGroupSheet: group name/color + optional draft portfolios. */
function createGroupDialog() {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "wide-dialog" });
    const name = h("input", { required: true, autocomplete: "off" });
    const color = h("input", { type: "color", value: COLOR_PRESETS[0] });
    const drafts = [{ name: "", currency: "PLN", kind: "account", colorHex: COLOR_PRESETS[0] }];
    const list = h("div", { class: "draft-list" });
    const redraw = () => {
      list.replaceChildren(...drafts.map((d, i) => h("div", { class: "draft-row form" },
        h("label", { class: "wide" }, t("ui.name"), h("input", { value: d.name, oninput: (e) => { d.name = e.target.value; } })),
        h("label", {}, t("ui.currency"), h("select", { onchange: (e) => { d.currency = e.target.value; } }, currencyOptions().map((o) => h("option", { value: o.value, selected: o.value === d.currency }, o.label)))),
        h("label", {}, t("ui.kind"), h("select", { onchange: (e) => { d.kind = e.target.value; } }, [{ value: "account", label: t("ui.kind.account") }, { value: "manual", label: t("ui.kind.manual") }].map((o) => h("option", { value: o.value, selected: o.value === d.kind }, o.label)))),
        h("label", {}, t("ui.color"), h("input", { type: "color", value: d.colorHex, oninput: (e) => { d.colorHex = e.target.value; } })),
        h("button", { type: "button", class: "icon-btn", title: t("common.delete"), onclick: () => { drafts.splice(i, 1); if (!drafts.length) drafts.push({ name: "", currency: "PLN", kind: "account", colorHex: COLOR_PRESETS[0] }); redraw(); } }, "✕"))));
    };
    redraw();
    const close = (v) => { dlg.close(); resolve(v); };
    dlg.append(
      h("h3", {}, t("ui.newGroup")),
      h("div", { class: "form" }, h("label", { class: "wide" }, t("ui.name"), name), h("label", {}, t("ui.color"), color)),
      h("h4", {}, t("ui.groupPortfolios")),
      list,
      h("button", { type: "button", class: "btn", onclick: () => { drafts.push({ name: "", currency: "PLN", kind: "account", colorHex: COLOR_PRESETS[0] }); redraw(); } }, t("ui.addPortfolio")),
      h("div", { class: "footer" },
        h("button", { class: "btn", onclick: () => close(null) }, t("common.cancel")),
        h("button", { class: "btn primary", onclick: () => {
          if (!name.value.trim()) return;
          close({ name: name.value.trim(), colorHex: color.value, portfolios: drafts.map((d) => ({ name: d.name, baseCurrency: d.currency, kind: d.kind, colorHex: d.colorHex })) });
        } }, t("ui.create"))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
    document.body.append(dlg);
    dlg.showModal();
    name.focus();
  });
}

async function renameGroup(g) {
  const v = await formDialog({
    title: t("ui.rename"),
    fields: [
      { name: "name", label: t("ui.name"), value: g.name, required: true },
      { name: "colorHex", label: t("ui.color"), type: "color", value: g.colorHex || COLOR_PRESETS[0] },
    ],
  });
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
