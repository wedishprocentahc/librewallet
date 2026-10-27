import { api } from "../api.js";
import { download, h } from "../dom.js";
import { t } from "../i18n.js";
import { confirmDialog, guarded, panel, select, table, toast } from "../widgets.js";
import { mapTicker } from "./positions.js";

export async function render(root, app) {
  const b = app.boot;
  const s = b.settings;
  const save = async (patch, msg) => { if (await guarded(() => api.put("/api/settings", patch), msg)) await app.refresh(); };
  const apiUrl = `${location.origin}/api`;
  const updateStatus = h("p", { class: "muted" });

  root.append(h("header", { class: "top" }, h("h1", {}, t("nav.settings"))));
  root.append(panel(t("settings.about"),
    h("dl", { class: "kv" },
      h("dt", {}, t("settings.version")), h("dd", {}, `LibreWallet Web ${b.version}`),
      h("dt", {}, t("settings.api")), h("dd", {}, h("code", { class: "path" }, apiUrl)),
      h("dt", {}, t("settings.agentFeed")), h("dd", {}, h("code", { class: "path" }, b.agentFeedPath)),
      h("dt", {}, t("settings.dataDir")), h("dd", {}, h("code", { class: "path" }, b.dataDir)),
      h("dt", {}, t("settings.rates")), h("dd", {}, Object.entries(b.fxRates).filter(([k]) => k !== "PLN").slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" · ") || "—")),
    h("div", { class: "toolbar" },
      h("button", { class: "btn", onclick: async (e) => {
        e.target.disabled = true;
        updateStatus.className = "muted";
        updateStatus.textContent = t("settings.checkingUpdates");
        const r = await guarded(() => api.get("/api/updates/check"));
        e.target.disabled = false;
        if (!r) { updateStatus.textContent = ""; return; }
        if (r.status === "upToDate") {
          updateStatus.className = "pos";
          updateStatus.textContent = t("settings.upToDate", { version: r.current });
        } else if (r.status === "updateAvailable") {
          updateStatus.className = "warn";
          updateStatus.replaceChildren(
            document.createTextNode(`${t("settings.updateAvailable", { version: r.latest })} `),
            h("a", { href: r.downloadURL || r.releaseURL, target: "_blank", rel: "noopener" }, t("settings.downloadUpdate")),
            document.createTextNode(" · "),
            h("a", { href: r.releaseURL, target: "_blank", rel: "noopener" }, "GitHub"));
        } else {
          updateStatus.className = "neg";
          updateStatus.textContent = t("settings.updateFailed", { error: r.error || "?" });
        }
      } }, t("settings.checkUpdates")),
      h("a", { class: "btn", href: "https://wedishprocentahc.github.io/librewallet/", target: "_blank", rel: "noopener" }, t("settings.downloadPage")),
      h("a", { class: "btn", href: "https://github.com/wedishprocentahc/librewallet/releases", target: "_blank", rel: "noopener" }, t("settings.releases"))),
    updateStatus,
    h("p", { class: "muted" }, t("settings.privacy"))));

  root.append(panel(t("settings.language"), h("div", { class: "toolbar" },
    select([{ value: "pl", label: "Polski" }, { value: "en", label: "English" }], s.language, (v) => save({ language: v })),
    h("label", { class: "muted" }, `${t("settings.autoRefresh")} `, select([[0, "settings.autoRefresh.off"], [15, "settings.autoRefresh.15"], [30, "settings.autoRefresh.30"], [60, "settings.autoRefresh.60"]].map(([value, k]) => ({ value, label: t(k) })), s.autoRefreshMinutes, (v) => save({ autoRefreshMinutes: Number(v) }))),
    h("button", { class: "btn", onclick: async () => { if (await guarded(() => api.post("/api/refresh/rates"), t("feedback.pricesRefreshed"))) await app.refresh(); } }, t("settings.refreshRates")))));

  const code = h("input", { placeholder: "USD", style: { width: "90px" } });
  const rate = h("input", { type: "number", step: "any", placeholder: "4.00", style: { width: "110px" } });
  root.append(panel(t("settings.fx"), h("p", { class: "muted" }, t("settings.fx.hint")),
    Object.keys(s.fxOverrides).length ? table({ cols: [
      { label: t("settings.fx.code"), render: ([k]) => k }, { label: t("settings.fx.rate"), num: true, render: ([, v]) => v },
      { label: "", render: ([k]) => h("button", { class: "icon-btn", onclick: () => { const { [k]: _, ...rest } = s.fxOverrides; save({ fxOverrides: rest }, t("feedback.fxDeleted")); } }, "✕") },
    ], rows: Object.entries(s.fxOverrides) }) : null,
    h("div", { class: "toolbar" }, code, rate, h("button", { class: "btn", onclick: () => { if (code.value && rate.value) save({ fxOverrides: { ...s.fxOverrides, [code.value.toUpperCase()]: Number(rate.value) } }, t("feedback.fxSaved")); } }, t("settings.fx.add")))));

  const xtb = h("input", { placeholder: "DIA.PL", style: { width: "130px" } });
  const yahoo = h("input", { placeholder: "DIA.WA", style: { width: "130px" } });
  root.append(panel(t("settings.mappings"), h("p", { class: "muted" }, t("settings.mappings.hint")),
    s.symbolMappings.length ? table({ cols: [
      { label: t("settings.mappings.xtb"), render: (m) => m.id },
      { label: t("settings.mappings.yahoo"), render: (m) => m.providerSymbol },
      { label: t("mapping.note"), render: (m) => m.note || "" },
      { label: "", render: (m) => h("span", { class: "actions-inline" },
        h("button", { class: "icon-btn", title: t("ui.edit"), onclick: () => mapTicker(app, { symbol: m.id, currency: "PLN", resolution: "ok", meta: null }) }, "✎"),
        h("button", { class: "icon-btn", onclick: () => save({ symbolMappings: s.symbolMappings.filter((x) => x.id !== m.id) }, t("feedback.mappingDeleted")) }, "✕")) },
    ], rows: s.symbolMappings }) : null,
    h("div", { class: "toolbar" }, xtb, yahoo, h("button", { class: "btn", onclick: () => { if (xtb.value && yahoo.value) save({ symbolMappings: [...s.symbolMappings.filter((m) => m.id !== xtb.value.toUpperCase()), { id: xtb.value, provider: "yahoo", providerSymbol: yahoo.value }] }, t("feedback.mappingSaved")); } }, t("settings.mappings.add")))));

  const file = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" }, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmDialog(t("settings.restoreConfirm"), { danger: true, label: t("settings.importBackup") }))) return;
    const r = await guarded(async () => api.postText("/api/backup/restore", await f.text()));
    if (r) { toast(t("settings.restored", r)); await app.refresh(); }
  } });
  root.append(panel(t("settings.backup"), h("div", { class: "toolbar" },
    h("button", { class: "btn", onclick: async () => { const text = await guarded(() => api.text("/api/backup")); if (text) { download(`librewallet-backup-${new Date().toISOString().slice(0, 10)}.json`, text, "application/json"); toast(t("feedback.exportBackup")); } } }, t("settings.exportBackup")),
    h("button", { class: "btn", onclick: () => file.click() }, t("settings.importBackup")), file,
    h("button", { class: "btn", onclick: async () => { const text = await guarded(() => api.text("/api/export/transactions.csv")); if (text) { download("librewallet-transactions.csv", text, "text/csv"); toast(t("feedback.exportCSV")); } } }, t("settings.exportCSV")),
    h("span", { class: "grow" }),
    h("button", { class: "btn danger", onclick: async () => {
      if (!(await confirmDialog(t("settings.clearConfirm"), { label: t("settings.clearData") }))) return;
      if (await guarded(() => api.post("/api/clear"), t("feedback.clearData"))) await app.refresh();
    } }, t("settings.clearData")))));
}
