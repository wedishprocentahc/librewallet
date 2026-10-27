import { getLang } from "./i18n.js";

const locale = () => (getLang() === "en" ? "en-US" : "pl-PL");

export function money(v, currency = "PLN") {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat(locale(), { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${number(v, 2)} ${currency}`; // non-ISO label (e.g. unknown account product)
  }
}
export const number = (v, digits = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(v));
export const pct = (v, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)}%`);
export const signed = (v, fmt) => (v > 0 ? `+${fmt(v)}` : fmt(v));
export const dateShort = (iso) => (iso ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(iso)) : "—");
export const dateTime = (iso) => (iso ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—");
export const tone = (v) => (v > 0.005 ? "pos" : v < -0.005 ? "neg" : "");
export const toDateInput = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
