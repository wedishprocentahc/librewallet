import { h, clear } from "./dom.js";
import { t } from "./i18n.js";

export function toast(message, kind = "info") {
  const el = h("div", { class: `toast ${kind === "error" ? "error" : ""}` }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), kind === "error" ? 7000 : 3500);
}

/** Modal form. fields: [{ name, label, type, value, options, wide, required, step }]; resolves with values or null. */
export function formDialog({ title, fields, submitLabel = t("common.save"), danger = false }) {
  return new Promise((resolve) => {
    const dlg = h("dialog");
    const inputs = {};
    const form = h("form", { method: "dialog", class: "form" });
    for (const f of fields) {
      let input;
      if (f.type === "select") {
        input = h("select", { name: f.name }, f.options.map((o) => h("option", { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      } else if (f.type === "textarea") {
        input = h("textarea", { name: f.name, rows: 3, value: f.value ?? "" });
      } else if (f.type === "checkbox") {
        input = h("input", { type: "checkbox", name: f.name, checked: !!f.value });
      } else {
        input = h("input", { type: f.type ?? "text", name: f.name, value: f.value ?? "", step: f.step, required: f.required, autocomplete: "off" });
      }
      inputs[f.name] = input;
      form.append(h("label", { class: f.wide ? "wide" : "" }, f.label, input));
    }
    const cancel = h("button", { type: "button", class: "btn", onclick: () => { dlg.close(); resolve(null); } }, t("common.cancel"));
    const ok = h("button", { type: "submit", class: `btn ${danger ? "danger" : "primary"}` }, submitLabel);
    dlg.append(h("h3", {}, title), form, h("div", { class: "footer" }, cancel, ok));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const values = {};
      for (const f of fields) values[f.name] = f.type === "checkbox" ? inputs[f.name].checked : inputs[f.name].value;
      dlg.close();
      resolve(values);
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
    document.body.append(dlg);
    dlg.showModal();
    inputs[fields[0]?.name]?.focus();
  });
}

export async function confirmDialog(message, { danger = true, label } = {}) {
  return new Promise((resolve) => {
    const dlg = h("dialog");
    dlg.append(h("p", {}, message), h("div", { class: "footer" },
      h("button", { class: "btn", onclick: () => { dlg.close(); resolve(false); } }, t("common.cancel")),
      h("button", { class: `btn ${danger ? "danger" : "primary"}`, onclick: () => { dlg.close(); resolve(true); } }, label ?? t("common.delete"))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export const kpi = (label, value, cls = "") => h("div", { class: "kpi" }, h("div", { class: "label" }, label), h("div", { class: `value ${cls}` }, value));
export const panel = (title, ...body) => h("section", { class: "panel" }, title ? h("h2", {}, title) : null, ...body);
export const empty = (msg) => h("div", { class: "empty" }, msg);

/** table({ cols: [{ label, num?, render(row) }], rows, empty }) */
export function table({ cols, rows, emptyText }) {
  if (rows.length === 0) return empty(emptyText ?? t("dashboard.noData"));
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : "" }, c.label)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, cols.map((c) => h("td", { class: `${c.num ? "num" : ""} ${c.wrap ? "wrap" : ""} ${c.cls?.(r) ?? ""}` }, c.render(r))))))));
}

export function select(options, value, onchange, attrs = {}) {
  return h("select", { onchange: (e) => onchange(e.target.value), ...attrs }, options.map((o) => h("option", { value: o.value, selected: String(o.value) === String(value) }, o.label)));
}

export async function guarded(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  }
}

export { clear };
