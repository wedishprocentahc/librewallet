import { api } from "../api.js";
import { download, h } from "../dom.js";
import { t } from "../i18n.js";
import { confirmDialog, guarded, panel, select, table, toast } from "../widgets.js";

export async function render(root, app) {
  const b = app.boot;
  const s = b.settings;
  const save = async (patch, msg) => { if (await guarded(() => api.put("/api/settings", patch), msg)) await app.refresh(); };

  root.append(h("header", { class: "top" }, h("h1", {}, t("nav.settings"))));
  root.append(panel(t("settings.about"), h("dl", { class: "kv" },
    h("dt", {}, t("settings.version")), h("dd", {}, `LibreWallet Web ${b.version}`),
    h("dt", {}, t("settings.dataDir")), h("dd", {}, h("code", { class: "path" }, b.dataDir)),
    h("dt", {}, t("settings.rates")), h("dd", {}, Object.entries(b.fxRates).filter(([k]) => k !== "PLN").slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" · ") || "—")),
    h("p", { class: "muted" }, t("settings.privacy"))));

  root.append(panel(t("settings.language"), h("div", { class: "toolbar" },
    select([{ value: "pl", label: "Polski" }, { value: "en", label: "English" }], s.language, (v) => save({ language: v })),
    h("label", { class: "muted" }, `${t("settings.autoRefresh")} `, select([[0, "settings.autoRefresh.off"], [15, "settings.autoRefresh.15"], [30, "settings.autoRefresh.30"], [60, "settings.autoRefresh.60"]].map(([value, k]) => ({ value, label: t(k) })), s.autoRefreshMinutes, (v) => save({ autoRefreshMinutes: Number(v) }))),
    h("button", { class: "btn", onclick: async () => { if (await guarded(() => api.post("/api/refresh/rates"), t("feedback.pricesRefreshed"))) await app.refresh(); } }, t("settings.refreshRates")))));

  // ---- FX overrides
  const code = h("input", { placeholder: "USD", style: { width: "90px" } });
  const rate = h("input", { type: "number", step: "any", placeholder: "4.00", style: { width: "110px" } });
  root.append(panel(t("settings.fx"), h("p", { class: "muted" }, t("settings.fx.hint")),
    Object.keys(s.fxOverrides).length ? table({ cols: [
      { label: t("settings.fx.code"), render: ([k]) => k }, { label: t("settings.fx.rate"), num: true, render: ([, v]) => v },
      { label: "", render: ([k]) => h("button", { class: "icon-btn", onclick: () => { const { [k]: _, ...rest } = s.fxOverrides; save({ fxOverrides: rest }, t("feedback.fxDeleted")); } }, "✕") },
    ], rows: Object.entries(s.fxOverrides) }) : null,
    h("div", { class: "toolbar" }, code, rate, h("button", { class: "btn", onclick: () => { if (code.value && rate.value) save({ fxOverrides: { ...s.fxOverrides, [code.value.toUpperCase()]: Number(rate.value) } }, t("feedback.fxSaved")); } }, t("settings.fx.add")))));

  // ---- symbol mappings
  const xtb = h("input", { placeholder: "DIA.PL", style: { width: "130px" } });
  const yahoo = h("input", { placeholder: "DIA.WA", style: { width: "130px" } });
  root.append(panel(t("settings.mappings"), h("p", { class: "muted" }, t("settings.mappings.hint")),
    s.symbolMappings.length ? table({ cols: [
      { label: t("settings.mappings.xtb"), render: (m) => m.id }, { label: t("settings.mappings.yahoo"), render: (m) => m.providerSymbol },
      { label: "", render: (m) => h("button", { class: "icon-btn", onclick: () => save({ symbolMappings: s.symbolMappings.filter((x) => x.id !== m.id) }, t("feedback.mappingDeleted")) }, "✕") },
    ], rows: s.symbolMappings }) : null,
    h("div", { class: "toolbar" }, xtb, yahoo, h("button", { class: "btn", onclick: () => { if (xtb.value && yahoo.value) save({ symbolMappings: [...s.symbolMappings.filter((m) => m.id !== xtb.value.toUpperCase()), { id: xtb.value, provider: "yahoo", providerSymbol: yahoo.value }] }, t("feedback.mappingSaved")); } }, t("settings.mappings.add")))));

  // ---- backup
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
