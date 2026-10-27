import { api } from "../api.js";
import { h } from "../dom.js";
import { dateTime, number, pct } from "../format.js";
import { assetLabel, t } from "../i18n.js";
import { empty, guarded, panel, select, table, toast } from "../widgets.js";

const state = { symbol: "", currency: "PLN", targetPrice: "", above: true };

export async function render(root, app) {
  const d = await api.get("/api/alerts");
  const reload = () => app.refresh();
  root.append(h("header", { class: "top" }, h("h1", {}, t("alerts.title")), h("span", { class: "spacer" }),
    h("button", { class: "btn", onclick: async () => {
      const r = await guarded(() => api.post("/api/alerts/check", { force: true }));
      if (r) { toast(t("alerts.checked", { count: r.fired.length })); }
    } }, t("alerts.checkNow"))));
  root.append(h("p", { class: "muted" }, t("alerts.liveHint")));

  // ---- price alerts
  const symbolInput = h("input", { list: "symbols", value: state.symbol, placeholder: "AAPL.US", oninput: (e) => { state.symbol = e.target.value; } });
  root.append(panel(t("alerts.priceHeader"),
    h("datalist", { id: "symbols" }, d.symbols.map((s) => h("option", { value: s }))),
    h("div", { class: "form" },
      h("label", {}, t("alerts.symbol"), symbolInput),
      h("label", {}, t("alerts.currency"), h("input", { value: state.currency, oninput: (e) => { state.currency = e.target.value; } })),
      h("label", {}, t("alerts.targetPrice"), h("input", { type: "number", step: "any", value: state.targetPrice, oninput: (e) => { state.targetPrice = e.target.value; } })),
      h("label", {}, t("alerts.scope"), select([{ value: "1", label: t("alerts.above") }, { value: "0", label: t("alerts.below") }], state.above ? "1" : "0", (v) => { state.above = v === "1"; })),
      h("button", { class: "btn primary", onclick: async () => {
        if (await guarded(() => api.post("/api/alerts", { symbol: state.symbol, currency: state.currency, targetPrice: state.targetPrice, above: state.above }), t("feedback.alertAdded"))) { state.symbol = ""; state.targetPrice = ""; await reload(); }
      } }, t("alerts.add"))),
    h("h3", {}, t("alerts.priceList")),
    d.alerts.length === 0 ? empty(t("alerts.empty")) : table({
      cols: [
        { label: t("col.symbol"), render: (a) => h("strong", {}, a.symbol) },
        { label: t("alerts.targetPrice"), num: true, render: (a) => `${a.above ? "≥" : "≤"} ${number(a.targetPrice, 4)} ${a.currency}` },
        { label: t("alerts.lastPrice"), num: true, render: (a) => (a.lastPrice === null ? "—" : number(a.lastPrice, 4)) },
        { label: t("col.status"), render: (a) => (a.breached ? h("span", { class: "badge warn" }, t("alerts.breached")) : "") },
        { label: t("col.lastTriggered"), render: (a) => (a.lastTriggeredAt ? dateTime(a.lastTriggeredAt) : "—") },
        { label: t("alerts.enabled"), render: (a) => h("input", { type: "checkbox", checked: a.enabled, onchange: async (e) => { await guarded(() => api.put(`/api/alerts/${a.id}`, { enabled: e.target.checked })); } }) },
        { label: "", render: (a) => h("button", { class: "icon-btn", title: t("alerts.delete"), onclick: async () => { if (await guarded(() => api.del(`/api/alerts/${a.id}`), t("feedback.alertDeleted"))) await reload(); } }, "✕") },
      ],
      rows: d.alerts,
    })));

  // ---- allocation drift
  const scopes = [{ value: "all", label: t("common.all") }, ...app.boot.groups.map((g) => ({ value: `group:${g.id}`, label: `${t("nav.groups")}: ${g.name}` })), ...app.boot.portfolios.map((p) => ({ value: `portfolio:${p.id}`, label: p.name }))];
  root.append(panel(t("alerts.driftHeader"),
    h("div", { class: "toolbar" },
      h("label", { class: "muted" }, `${t("alerts.drift")} `, h("input", { type: "number", min: 0, step: 0.5, value: d.driftThreshold, style: { width: "80px" }, onchange: async (e) => { if (await guarded(() => api.put("/api/settings", { allocationDriftPct: Number(e.target.value) }))) await reload(); } })),
      h("label", { class: "muted" }, `${t("alerts.driftScope")} `, select(scopes, d.driftScope, async (v) => { if (await guarded(() => api.put("/api/settings", { alertDriftScope: v }))) await reload(); }))),
    d.drift.length === 0 ? h("p", { class: "pos" }, `${t("alerts.driftStatus.ok")} — ${t("alerts.noDrift")}`) : h("div", {},
      h("p", { class: "warn" }, t("alerts.driftStatus.alert", { count: d.drift.length })),
      table({ cols: [
        { label: t("ui.type"), render: (i) => assetLabel(i.assetType) },
        { label: t("rebalance.actual"), num: true, render: (i) => pct(i.actualPct) },
        { label: t("rebalance.target"), num: true, render: (i) => pct(i.targetPct, 0) },
        { label: "Δ", num: true, render: (i) => pct(i.driftPct) },
      ], rows: d.drift }))));

  // ---- browser notifications
  const supported = "Notification" in window;
  const status = !supported ? "—" : Notification.permission === "granted" ? t("alerts.notifications.status.authorized") : Notification.permission === "denied" ? t("alerts.notifications.status.denied") : t("alerts.notifications.status.notDetermined");
  root.append(panel(t("alerts.notifications"), h("div", { class: "toolbar" },
    h("button", { class: "btn", onclick: async () => { await guarded(() => api.post("/api/notifications/test"), t("alerts.notifications.test")); } }, t("alerts.notifications.test")), h("span", { class: "muted" }, t("alerts.systemHint"))),
    h("div", { class: "toolbar" }, h("strong", {}, `${t("alerts.browserNotifications")}: `), h("span", {}, status),
    supported && Notification.permission !== "granted" ? h("button", { class: "btn", onclick: async () => { await Notification.requestPermission(); await reload(); } }, t("alerts.browserNotifications.enable")) : null,
    null)));
}
